import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp, type AppOptions } from '../web_app.js';
import { GeneratedMapStore } from '../generated_map_store.js';
import { PublicResponseCache } from '../http_cache.js';
import { HttpError, RenderQueue, RenderRateLimiter } from '../server_policy.js';

async function withApp(run: (base: string, dir: string) => Promise<void>, options?: AppOptions) {
  const dir = await mkdtemp(join(tmpdir(), 'gunnmap-security-'));
  const server = createApp(dir, options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try { await run(`http://127.0.0.1:${address.port}`, dir); }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}
const statusError = (status: number) => (error: unknown) => error instanceof HttpError && error.status === status;
const validPeriods = Array.from({ length: 7 }, (_, index) => ({ building: index ? '' : 'A', room: index ? '' : 'A101', color: '#ff0000' }));
const post = (base: string, headers: Record<string, string> = {}, body = '{}') => fetch(`${base}/api/render`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

test('render boundary rejects cross-site/simple requests and accepts same-origin JSON without writing invalid input', async () => {
  await withApp(async (base, dir) => {
    assert.equal((await post(base, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post(base, { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await post(base, { Origin: 'null' })).status, 403);
    assert.equal((await post(base, { Origin: base, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await post(base, { Origin: base, 'Sec-Fetch-Site': 'same-site' })).status, 403);
    assert.equal((await post(base, { Origin: base, 'Sec-Fetch-Site': 'same-origin' })).status, 400);
    assert.equal((await post(base)).status, 400, 'CLI clients without an Origin can submit JSON');
    assert.equal((await post(base, {}, 'x'.repeat(16001))).status, 400);
    const streamedStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(base + '/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, response => {
        response.resume();
        response.on('end', () => resolve(response.statusCode!));
        response.on('error', reject);
      });
      request.on('error', reject);
      request.write('x'.repeat(8000));
      request.end('x'.repeat(8001));
    });
    assert.equal(streamedStatus, 400, 'unknown-length bodies obey the same cap');
    assert.deepEqual(await readdir(dir), []);
  });
  await withApp(async base => {
    assert.equal((await post(base, { Origin: 'https://map.example' })).status, 400);
    assert.equal((await post(base, { Origin: 'https://attacker.example', 'X-Forwarded-Host': 'attacker.example', 'X-Forwarded-Proto': 'https' })).status, 403);
    assert.equal((await post(base, { Origin: base })).status, 403);
  }, { publicOrigin: 'https://map.example' });
});

test('render rate limits ignore forged forwarded identities and include a retry interval', async () => {
  await withApp(async base => {
    assert.equal((await post(base, { 'X-Forwarded-For': '192.0.2.1' })).status, 400);
    const limited = await post(base, { 'X-Forwarded-For': '192.0.2.2' });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('Retry-After')) >= 1);
    assert.equal(limited.headers.get('Cache-Control'), 'no-store');
    assert.equal((await fetch(base + '/api/rooms')).status, 200, 'public browsing is unaffected');
  }, { renderRateLimit: 1 });
  const limiter = new RenderRateLimiter(2, 1000, 2);
  limiter.consume('a', 1000); limiter.consume('a', 1001); limiter.consume('b', 1002);
  assert.throws(() => limiter.consume('a', 1003), statusError(429));
  assert.throws(() => limiter.consume('c', 1004), statusError(503));
  limiter.consume('c', 2000);
  limiter.consume('a', 2002);
});

test('global admission bounds active renders, pending requests, timeout, cancellation and recovers after failures', async () => {
  const queue = new RenderQueue(1, 1, 50);
  let release!: () => void;
  const first = queue.run(() => new Promise<string>(resolve => { release = () => resolve('first'); }));
  await delay(0);
  let timedOutStarted = false;
  const pending = queue.run(async () => { timedOutStarted = true; return 'never'; });
  await assert.rejects(queue.run(async () => 'full'), statusError(503));
  await assert.rejects(pending, statusError(503));
  assert.equal(timedOutStarted, false);
  const controller = new AbortController();
  const aborted = queue.run(async () => 'aborted', controller.signal);
  controller.abort();
  await assert.rejects(aborted, statusError(503));
  const second = queue.run(async () => 'second');
  release();
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  await assert.rejects(queue.run(async () => { throw new Error('renderer failed'); }), /renderer failed/);
  assert.equal(await queue.run(async () => 'recovered'), 'recovered');
});

test('disk reservations reject oversubscription and preserve earlier maps through capacity and render failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gunnmap-budget-'));
  try {
    const old = `period_map_${'a'.repeat(32)}.png`;
    await writeFile(join(dir, old), 'old');
    const store = new GeneratedMapStore(dir, 11, 4, 60000);
    const first = await store.reserve();
    const second = await store.reserve();
    await assert.rejects(store.reserve(), statusError(503));
    await assert.rejects(first.write(Buffer.from('12345')), statusError(503));
    first.release();
    const replacement = await store.reserve();
    const filename = await second.write(Buffer.from('1234'));
    second.release();
    replacement.release();
    assert.equal(await readFile(join(dir, old), 'utf8'), 'old');
    assert.equal(await readFile(join(dir, filename), 'utf8'), '1234');
    const after = await store.reserve();
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(after.write(Buffer.from('1234'), aborted.signal), statusError(503));
    after.release();
    assert.deepEqual((await readdir(dir)).sort(), [old, filename].sort());
  } finally { await rm(dir, { recursive: true, force: true }); }
  await withApp(async (base, dir) => {
    const old = `period_map_${'a'.repeat(32)}.png`;
    await writeFile(join(dir, old), '12345678');
    const response = await post(base, {}, JSON.stringify({ periods: validPeriods }));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /storage is full/);
    assert.deepEqual(await readdir(dir), [old]);
  }, { mapStorageBytes: 10, mapMaxBytes: 4 });
});

test('CSP and browser safety headers survive errors and 304; HTTPS policy is explicit', async () => {
  await withApp(async base => {
    const first = await fetch(base + '/api/rooms');
    const responses = [first, await fetch(base + '/missing'), await fetch(base + '/api/rooms', { headers: { 'If-None-Match': first.headers.get('etag')! } })];
    assert.equal(responses[2].status, 304);
    for (const response of responses) {
      const policy = response.headers.get('content-security-policy')!;
      assert.match(policy, /script-src 'self';/);
      assert.match(policy, /object-src 'none'/);
      assert.match(policy, /base-uri 'none'/);
      assert.match(policy, /frame-ancestors 'none'/);
      assert.match(policy, /img-src 'self' data: blob:/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(response.headers.get('strict-transport-security'), null);
    }
  });
  assert.throws(() => createApp(undefined, { hsts: true }), /HTTPS/);
  assert.throws(() => createApp(undefined, { publicOrigin: 'https://map.example/path' }), /PUBLIC_ORIGIN/);
  await withApp(async base => {
    assert.equal((await fetch(base + '/api/rooms')).headers.get('strict-transport-security'), 'max-age=31536000');
  }, { publicOrigin: 'https://map.example', hsts: true });
});

test('public file cache reuses bytes and validators while respecting replacement, eviction and deletion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gunnmap-public-cache-'));
  const cache = new PublicResponseCache(1024, 1);
  const firstPath = join(dir, 'first.js'), secondPath = join(dir, 'second.js');
  try {
    await writeFile(firstPath, 'version1'); await writeFile(secondPath, 'second');
    const first = await cache.file(firstPath);
    assert.equal(await cache.file(firstPath), first, 'warm cache returns the same buffer and already-computed ETag');
    await writeFile(firstPath, 'version2');
    const replacement = await cache.file(firstPath);
    assert.notEqual(replacement, first);
    assert.notEqual(replacement.plain.etag, first.plain.etag);
    await cache.file(secondPath);
    assert.notEqual(await cache.file(firstPath), replacement, 'entry limit evicts the older representation');
    await rm(firstPath);
    await assert.rejects(cache.file(firstPath), { code: 'ENOENT' });
    const large = Buffer.alloc(1025);
    assert.notEqual(cache.buffer('large', large), cache.buffer('large', large), 'oversize representations are not retained');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
