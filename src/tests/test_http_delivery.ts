import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, type IncomingHttpHeaders } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import { createApp, type AppOptions } from '../web_app.js';
import { evacuationForRoom, evacuationOverview } from '../evacuation.js';
import { rooms, roomData, ROOT } from '../project.js';

interface Response { status: number; headers: IncomingHttpHeaders; body: Buffer }
function request(url: string, headers: Record<string, string> = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    get(url, { headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function withApp(run: (base: string, dir: string) => Promise<void>, options?: AppOptions) {
  const dir = await mkdtemp(join(tmpdir(), 'gunnmap-delivery-'));
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

test('public routes revalidate unchanged bytes and private errors stay uncached', async () => {
  await withApp(async base => {
    for (const path of ['/', '/evacuation', '/evacuation/', '/find-room', '/generate-map/', '/main.js', '/ui.css', '/style.css', '/map.png', '/evacuation-map.png', '/manifest.webmanifest', '/assets/campus-map.svg', '/api/rooms', '/api/offline-rooms', '/api/evacuation-data']) {
      const first = await request(base + path);
      assert.equal(first.status, 200, path);
      assert.equal(first.headers['cache-control'], 'no-cache', path);
      const etag = first.headers.etag;
      assert.ok(etag);
      for (const validator of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
        const cached = await request(base + path, { 'If-None-Match': validator });
        assert.equal(cached.status, 304, path);
        assert.equal(cached.headers.etag, etag);
        assert.equal(cached.body.length, 0);
      }
      assert.equal((await request(base + path, { 'If-None-Match': '"older-version"' })).status, 200);
    }
    const missing = await request(base + '/missing', { 'If-None-Match': '*' });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers['cache-control'], 'no-store');
  });
});

test('text compression honors encoding negotiation and representation validators', async () => {
  await withApp(async base => {
    for (const path of ['/main.js', '/ui.css', '/api/rooms', '/api/offline-rooms']) {
      const plain = await request(base + path, { 'Accept-Encoding': 'identity' });
      const compressed = await request(base + path, { 'Accept-Encoding': 'gzip' });
      assert.equal(compressed.status, 200);
      assert.equal(compressed.headers['content-encoding'], 'gzip', path);
      assert.equal(compressed.headers.vary, 'Accept-Encoding');
      assert.equal(plain.headers.vary, 'Accept-Encoding');
      assert.equal(Number(compressed.headers['content-length']), compressed.body.length);
      assert.deepEqual(gunzipSync(compressed.body), plain.body);
      assert.ok(compressed.body.length < plain.body.length);
      assert.notEqual(compressed.headers.etag, plain.headers.etag);
      const cached = await request(base + path, { 'Accept-Encoding': 'gzip', 'If-None-Match': `W/${compressed.headers.etag}` });
      assert.equal(cached.status, 304);
      assert.equal(cached.headers.vary, 'Accept-Encoding');
      assert.equal(cached.headers['content-encoding'], 'gzip');
      assert.equal(cached.body.length, 0);
      assert.equal((await request(base + path, { 'Accept-Encoding': 'identity', 'If-None-Match': compressed.headers.etag! })).status, 200);
    }
    for (const value of ['gzip;q=0', 'gzip;q=0, *;q=1', 'gzip;q=0.5, identity;q=1', 'br']) {
      const response = await request(base + '/api/rooms', { 'Accept-Encoding': value });
      assert.equal(response.status, 200, value);
      assert.equal(response.headers['content-encoding'], undefined, value);
    }
    for (const value of ['GZip; q=1', '*;q=1', 'gzip;q=0.5, identity;q=0']) {
      assert.equal((await request(base + '/api/rooms', { 'Accept-Encoding': value })).headers['content-encoding'], 'gzip', value);
    }
    assert.equal((await request(base + '/api/rooms', { 'Accept-Encoding': 'br, identity;q=0' })).status, 406);
    const png = await request(base + '/map.png', { 'Accept-Encoding': 'gzip' });
    assert.equal(png.headers['content-encoding'], undefined);
  });
});

test('content hashed assets stay immutable and changed bytes get a new ETag', async () => {
  const name = `cache-test-${randomUUID().replaceAll('-', '')}.js`;
  const asset = join(ROOT, 'dist', 'web', 'assets', name);
  await mkdir(join(ROOT, 'dist', 'web', 'assets'), { recursive: true });
  try {
    await writeFile(asset, 'export const version = 1;');
    await withApp(async base => {
      const first = await request(`${base}/assets/${name}`);
      assert.equal(first.headers['cache-control'], 'public, max-age=31536000, immutable');
      await writeFile(asset, 'export const version = 2;');
      const changed = await request(`${base}/assets/${name}`, { 'If-None-Match': first.headers.etag! });
      assert.equal(changed.status, 200);
      assert.notEqual(changed.headers.etag, first.headers.etag);
    });
  } finally { await rm(asset, { force: true }); }
});

test('service worker has root scope and always revalidates', async () => {
  await withApp(async base => {
    const first = await request(base + '/sw.js');
    assert.equal(first.status, 200);
    assert.match(first.headers['content-type']!, /^text\/javascript/);
    assert.equal(first.headers['cache-control'], 'no-cache');
    assert.equal(first.headers['service-worker-allowed'], '/');
    assert.deepEqual(first.body, await readFile(join(ROOT, 'dist', 'web', 'sw.js')));
    const cached = await request(base + '/sw.js', { 'If-None-Match': first.headers.etag! });
    assert.equal(cached.status, 304);
    assert.equal(cached.headers['service-worker-allowed'], '/');
    assert.equal(cached.headers['cache-control'], 'no-cache');
  });
});

test('room lookup and offline inventory preserve the React SPA API contracts', async () => {
  await withApp(async (base, dir) => {
    const offline = JSON.parse((await request(base + '/api/offline-rooms')).body.toString());
    assert.equal(offline.rooms.length, rooms.length);
    assert.deepEqual(offline.map_size, roomData.image_size);
    for (const query of ['N-214', 'Ｎ－２１４', 'n—214', 'R 148', 'N214 （R 148）']) {
      const response = await request(`${base}/api/room-lookup?q=${encodeURIComponent(query)}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      const result = JSON.parse(response.body.toString());
      assert.equal(result.rooms.length, 1);
      assert.equal(result.rooms[0].id, 'R148');
      assert.equal(result.rooms[0].floor, 2);
      assert.equal(result.rooms[0].evacuation.group, null);
      assert.deepEqual(result.map_size, roomData.image_size);
      assert.deepEqual(result.rooms[0], offline.rooms.find((room: { id: string }) => room.id === 'R148'));
    }
    const k6 = JSON.parse((await request(base + '/api/room-lookup?q=K6')).body.toString());
    assert.deepEqual(k6.rooms.map((room: {id: string}) => room.id), ['R070']);
    const merged = JSON.parse((await request(base + '/api/room-lookup?q=R069')).body.toString());
    assert.deepEqual(merged.rooms.map((room: {id: string}) => room.id), ['R068']);
    const alias = JSON.parse((await request(base + '/api/room-lookup?q=library')).body.toString());
    assert.equal(alias.rooms[0].label, 'D-LIB');
    const unconfirmed = JSON.parse((await request(base + '/api/room-lookup?q=E01')).body.toString());
    assert.deepEqual(unconfirmed.rooms[0].evacuation, evacuationForRoom({ label: 'E01', building: 'E' }));
    assert.equal(unconfirmed.rooms[0].evacuation.status, 'unconfirmed');
    const unknown = await request(base + '/api/room-lookup?q=unknown');
    assert.equal(unknown.status, 200);
    assert.deepEqual(JSON.parse(unknown.body.toString()).rooms, []);
    for (const query of ['', '?q=', '?q=%20%20']) assert.equal((await request(base + '/api/room-lookup' + query)).status, 400);
    assert.deepEqual(JSON.parse((await request(base + '/api/evacuation-data')).body.toString()), evacuationOverview());
    assert.deepEqual(await readdir(dir), [], 'public lookup must not render PNGs');
  });
});

test('expired personal URLs return 404 and legacy latest maps are never served', async () => {
  await withApp(async (base, dir) => {
    const stale = `period_map_${'a'.repeat(32)}.png`;
    const fresh = `period_map_${'b'.repeat(32)}.png`;
    for (const filename of [stale, fresh, 'period_map.png']) await writeFile(join(dir, filename), 'image');
    const old = new Date(Date.now() - 120_000);
    await utimes(join(dir, stale), old, old);
    const expired = await request(`${base}/output/${stale}`, { 'If-None-Match': '*' });
    assert.equal(expired.status, 404);
    assert.equal(expired.headers['cache-control'], 'no-store');
    assert.equal((await request(base + '/output/period_map.png')).status, 404);
    const personal = await request(`${base}/output/${fresh}`, { 'If-None-Match': '*' });
    assert.equal(personal.status, 200);
    assert.equal(personal.headers['cache-control'], 'no-store');
    assert.equal(personal.headers.etag, undefined);
    assert.equal(personal.body.toString(), 'image');
    assert.deepEqual((await readdir(dir)).sort(), [fresh, 'period_map.png'].sort());
  }, { retentionMs: 60_000 });
});

test('retention starts with the server and closes its timer on shutdown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gunnmap-cleanup-lifecycle-'));
  const server = createApp(dir, { retentionMs: 60_000, cleanupIntervalMs: 20 });
  const filename = `period_map_${'c'.repeat(32)}.png`;
  const path = join(dir, filename);
  const expiredFile = async () => {
    await writeFile(path, 'old image');
    const old = new Date(Date.now() - 120_000);
    await utimes(path, old, old);
  };
  const waitForRemoval = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!(await readdir(dir)).includes(filename)) return;
      await delay(20);
    }
    assert.fail('running servers must clean expired images without a render request');
  };
  try {
    await expiredFile();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    await waitForRemoval();
    await expiredFile();
    await waitForRemoval();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await expiredFile();
    await delay(100);
    assert.equal(await readFile(path, 'utf8'), 'old image');
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
