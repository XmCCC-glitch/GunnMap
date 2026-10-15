import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { rooms, roomData, ROOT } from '../project.js';
import { evacuationForRoom } from '../evacuation.js';
import { findRoomMatches } from '../domain/room-matching.js';
import { NETWORK_GET_TIMEOUT_MS, PERSONAL_CACHE, PERSONAL_IMAGE_KEY, PERSONAL_SOURCE_HEADER, PUBLIC_CACHE_PREFIX, PUBLIC_MANIFEST_KEY, UNSAVED_IMAGE_TIMEOUT_MS } from '../../web/offline/policy.js';

const origin = 'https://gunnmap.test';
const shell = '<!doctype html><div id="root">installed app shell</div>';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64');
const imagePath = `/output/period_map_${'a'.repeat(32)}.png`;
const otherImagePath = `/output/period_map_${'b'.repeat(32)}.png`;
const locatedRooms = rooms.map(room => ({
  id: room.id, label: room.label, building: room.building, floor: room.floor ?? 1,
  aliases: room.aliases ?? [], polygon: room.polygon,
  marker: [(room.label_box[0] + room.label_box[2]) / 2, (room.label_box[1] + room.label_box[3]) / 2],
  evacuation: evacuationForRoom(room),
}));
const directory = { rooms: locatedRooms, map_size: roomData.image_size };
const workerCode = readFileSync(join(ROOT, 'dist', 'web', 'sw.js'), 'utf8');

class BrowserRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === 'string' ? new URL(input, origin) : input, init);
  }
}

type CacheKey = Request | string | URL;
const keyFor = (key: CacheKey) => new URL(key instanceof Request ? key.url : String(key), origin).href;
type Network = (request: Request) => Promise<Response>;

function defaultNetwork(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/') return Promise.resolve(new Response(shell, { headers: { 'Content-Type': 'text/html' } }));
  if (url.pathname === '/api/offline-rooms') return Promise.resolve(Response.json(directory));
  if (url.pathname === '/api/rooms') return Promise.resolve(Response.json({ rooms }));
  if (url.pathname === '/api/room-lookup') {
    return Promise.resolve(Response.json({ rooms: findRoomMatches(locatedRooms, url.searchParams.get('q') ?? ''), map_size: roomData.image_size }));
  }
  if (url.pathname === '/api/render') return Promise.resolve(Response.json({ image_url: imagePath }));
  if (url.pathname.endsWith('.png')) return Promise.resolve(new Response(png, { headers: { 'Content-Type': 'image/png' } }));
  if (url.pathname.endsWith('.webp')) return Promise.resolve(new Response('compressed map', { headers: { 'Content-Type': 'image/webp' } }));
  return Promise.resolve(new Response(`public asset: ${url.pathname}`));
}

function workerHarness() {
  let network: Network = defaultNetwork;
  const networkRequests: Request[] = [];
  const messages: string[] = [];
  const writes: { name: string; key: string }[] = [];
  const reads: { name: string; key: string }[] = [];
  let nextTimer = 0;
  const timers = new Map<number, {callback: () => void; delay: number}>();
  let claims = 0, skips = 0;
  const fetchFromNetwork = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request && !init ? input : new BrowserRequest(input, init);
    networkRequests.push(request);
    return network(request);
  };
  class MemoryCache {
    private entries = new Map<string, Response>();
    constructor(readonly name: string) {}
    async match(key: CacheKey) {
      reads.push({ name: this.name, key: keyFor(key) });
      return this.entries.get(keyFor(key))?.clone();
    }
    async put(key: CacheKey, response: Response) {
      writes.push({ name: this.name, key: keyFor(key) });
      this.entries.set(keyFor(key), response.clone());
    }
    async delete(key: CacheKey) { return this.entries.delete(keyFor(key)); }
    async keys() { return [...this.entries.keys()].map(key => new BrowserRequest(key)); }
    async addAll(requests: Request[]) {
      // Cache.addAll is atomic: a failed precache must not partially replace entries.
      const responses = await Promise.all(requests.map(request => fetchFromNetwork(request)));
      if (responses.some(response => !response.ok)) throw new TypeError('Precache download failed');
      await Promise.all(requests.map((request, index) => this.put(request, responses[index])));
    }
  }
  const stores = new Map<string, MemoryCache>();
  const caches = {
    async open(name: string) {
      let cache = stores.get(name);
      if (!cache) { cache = new MemoryCache(name); stores.set(name, cache); }
      return cache;
    },
    async keys() { return [...stores.keys()]; },
    async delete(name: string) { return stores.delete(name); },
  };
  interface WorkerEvent {
    data?: unknown;
    request?: Request;
    waitUntil(promise: Promise<unknown>): void;
    respondWith?(promise: Promise<Response> | Response): void;
  }
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const worker = {
    location: new URL(origin),
    addEventListener(type: string, listener: (event: WorkerEvent) => void) { listeners.set(type, listener); },
    async skipWaiting() { skips++; },
    clients: {
      async claim() { claims++; },
      async matchAll() { return [{ postMessage(message: { type: string }) { messages.push(message.type); } }]; },
    },
  };
  vm.runInNewContext(workerCode, {
    self: worker, caches, fetch: fetchFromNetwork,
    Request: BrowserRequest, Response, Headers, URL, console, AbortController,
    setTimeout(callback: () => void, delay: number) {
      assert.ok([NETWORK_GET_TIMEOUT_MS, UNSAVED_IMAGE_TIMEOUT_MS].includes(delay), 'only bounded GETs should schedule this timer');
      timers.set(++nextTimer, {callback, delay});
      return nextTimer;
    },
    clearTimeout(id: number) { timers.delete(id); },
  }, { filename: 'dist/web/sw.js' });

  async function lifecycle(type: 'install' | 'activate' | 'message', data?: unknown) {
    const pending: Promise<unknown>[] = [];
    const listener = listeners.get(type);
    assert.ok(listener, `worker must register ${type}`);
    listener({ data, waitUntil: promise => { pending.push(Promise.resolve(promise)); } });
    await Promise.all(pending);
  }
  async function dispatchFetch(path: string, init: RequestInit = {}) {
    const request = new BrowserRequest(path, init.mode === 'navigate' ? { ...init, mode: 'same-origin' } : init);
    // Browsers create navigate requests internally; Node's Request constructor rejects that mode.
    if (init.mode === 'navigate') Object.defineProperty(request, 'mode', { value: 'navigate' });
    let response: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    const listener = listeners.get('fetch');
    assert.ok(listener, 'worker must register fetch');
    listener({
      request,
      respondWith: promise => { assert.equal(response, undefined); response = Promise.resolve(promise); },
      waitUntil: promise => { pending.push(Promise.resolve(promise)); },
    });
    if (!response) return undefined;
    const result = await response;
    await Promise.all(pending);
    return result;
  }
  return {
    caches, networkRequests, messages, writes, reads, lifecycle, dispatchFetch,
    expireTimeouts() { for (const [id, {callback}] of [...timers]) { timers.delete(id); callback(); } },
    get timerCount() { return timers.size; },
    get timerDelays() { return [...timers.values()].map(timer => timer.delay); },
    setNetwork(handler: Network) { network = handler; },
    offline() { network = async () => { throw new TypeError('Failed to fetch'); }; },
    online() { network = defaultNetwork; },
    get claims() { return claims; },
    get skips() { return skips; },
    async fetch(path: string, init?: RequestInit) {
      const response = await dispatchFetch(path, init);
      assert.ok(response, `worker did not handle ${path}`);
      return response;
    },
    async publicCache() {
      const names = (await caches.keys()).filter(name => name.startsWith(PUBLIC_CACHE_PREFIX));
      assert.equal(names.length, 1, 'one active public cache should remain');
      return caches.open(names[0]);
    },
  };
}

async function installedWorker() {
  const harness = workerHarness();
  await harness.lifecycle('install');
  await harness.lifecycle('activate');
  return harness;
}

test('worker installation caches public resources and activation preserves personal and unrelated caches', async () => {
  const h = workerHarness();
  const oldName = PUBLIC_CACHE_PREFIX + 'previous-release';
  await (await h.caches.open(oldName)).put('/', new Response('old shell'));
  await (await h.caches.open(PERSONAL_CACHE)).put(PERSONAL_IMAGE_KEY, new Response(png, {
    headers: { 'Content-Type': 'image/png', [PERSONAL_SOURCE_HEADER]: imagePath },
  }));
  await (await h.caches.open('another-application')).put('/other', new Response('unrelated data'));
  await h.lifecycle('install');
  assert.ok((await h.caches.keys()).includes(oldName), 'install must preserve the active version');
  assert.equal(h.skips, 0, 'new versions must wait for the user to activate them');
  assert.ok(h.networkRequests.some(request => new URL(request.url).pathname === '/api/offline-rooms'));
  for (const request of h.networkRequests) {
    assert.equal(request.method, 'GET');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.cache, 'reload');
    assert.ok(!new URL(request.url).pathname.startsWith('/output/'));
  }
  await h.lifecycle('activate');
  assert.equal(h.claims, 1);
  assert.ok(!(await h.caches.keys()).includes(oldName));
  assert.equal(await (await (await h.caches.open('another-application')).match('/other'))?.text(), 'unrelated data');
  const saved = await (await h.caches.open(PERSONAL_CACHE)).match(PERSONAL_IMAGE_KEY);
  assert.equal(saved?.headers.get(PERSONAL_SOURCE_HEADER), imagePath);
  assert.deepEqual(Buffer.from(await saved!.arrayBuffer()), png);
  const publicCache = await h.publicCache();
  assert.equal(await (await publicCache.match('/'))?.text(), shell);
  assert.deepEqual(await (await publicCache.match('/api/offline-rooms'))?.json(), directory);
  await h.lifecycle('message', { type: 'ACTIVATE_UPDATE' });
  assert.equal(h.skips, 1);
});

test('a failed precache leaves the previous worker resources available', async () => {
  const h = workerHarness();
  const oldName = PUBLIC_CACHE_PREFIX + 'working-release';
  await (await h.caches.open(oldName)).put('/', new Response('working shell'));
  h.setNetwork(async request => new URL(request.url).pathname === '/main.js'
    ? new Response('Unavailable', { status: 503 }) : defaultNetwork(request));
  await assert.rejects(h.lifecycle('install'), /Precache download failed/);
  assert.equal(await (await (await h.caches.open(oldName)).match('/'))?.text(), 'working shell');
  assert.equal(h.claims, 0);
  assert.equal(h.skips, 0);
  assert.deepEqual(await h.caches.keys(), [oldName], 'an incomplete release must be removed entirely');
});

test('offline navigation, public assets and room lookup preserve geometry and evacuation details', async () => {
  const h = await installedWorker();
  h.offline();
  const writesBefore = h.writes.length;
  for (const path of ['/', '/evacuation', '/evacuation/', '/find-room', '/generate-map/?preview=1']) {
    const response = await h.fetch(path, { mode: 'navigate' });
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), shell);
  }
  assert.deepEqual(await (await h.fetch('/api/offline-rooms')).json(), directory);
  assert.equal(await (await h.fetch('/map.webp')).text(), 'compressed map');
  assert.equal(await (await h.fetch('/evacuation-map.webp')).text(), 'compressed map');
  for (const query of ['n—214', 'Ｎ－２１４', 'R 148', 'library', 'K6', 'E01', 'unknown']) {
    const response = await h.fetch(`/api/room-lookup?q=${encodeURIComponent(query)}`);
    assert.equal(response.status, 200, query);
    assert.equal(response.headers.get('X-GunnMap-Offline'), '1');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const result = await response.json();
    assert.deepEqual(result, { rooms: findRoomMatches(locatedRooms, query), map_size: roomData.image_size });
    if (query === 'n—214') {
      assert.equal(result.rooms[0].id, 'R148');
      assert.equal(result.rooms[0].floor, 2);
      assert.ok(result.rooms[0].polygon.length >= 3);
      assert.equal(result.rooms[0].marker.length, 2);
      assert.equal(result.rooms[0].evacuation.group, null);
    }
    if (query === 'K6') assert.deepEqual(result.rooms.map((room: {id: string}) => room.id), ['R070']);
    if (query === 'E01') assert.equal(result.rooms[0].evacuation.status, 'unconfirmed');
  }
  assert.equal((await h.fetch('/api/room-lookup?q=%20')).status, 400);
  assert.equal(h.writes.length, writesBefore, 'lookup responses and navigation must not create new caches');
  assert.ok(h.messages.includes('GUNNMAP_OFFLINE'));
  assert.equal(await h.dispatchFetch('https://another.example/map.png'), undefined);
});

test('render POSTs return a useful offline error and never enter CacheStorage', async () => {
  const h = await installedWorker();
  const writesBefore = h.writes.length;
  h.offline();
  const response = await h.fetch('/api/render', { method: 'POST', body: JSON.stringify({ periods: [{ room: 'N214' }] }) });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match((await response.json()).error, /connection/i);
  h.online();
  assert.deepEqual(await (await h.fetch('/api/render', { method: 'POST', body: '{}' })).json(), { image_url: imagePath });
  assert.equal(h.writes.length, writesBefore);
  assert.ok(!h.writes.some(write => new URL(write.key).pathname === '/api/render'));
});

test('personal images are never cached automatically and only the explicitly saved URL can fall back', async () => {
  const h = await installedWorker();
  const writesBefore = h.writes.length;
  assert.deepEqual(Buffer.from(await (await h.fetch(imagePath)).arrayBuffer()), png);
  assert.equal(h.writes.length, writesBefore);
  h.offline();
  assert.equal((await h.fetch(imagePath)).status, 503);
  const personalCache = await h.caches.open(PERSONAL_CACHE);
  assert.equal((await personalCache.keys()).length, 0);
  await personalCache.put(PERSONAL_IMAGE_KEY, new Response(png, {
    headers: { 'Content-Type': 'image/png', [PERSONAL_SOURCE_HEADER]: imagePath },
  }));
  const savedWrites = h.writes.length;
  assert.equal((await h.fetch(otherImagePath)).status, 503);
  const restored = await h.fetch(imagePath);
  assert.equal(restored.status, 200);
  assert.deepEqual(Buffer.from(await restored.arrayBuffer()), png);
  h.setNetwork(async () => new Response('Expired', { status: 404 }));
  assert.equal((await h.fetch(imagePath)).status, 200, 'an explicit offline copy remains available after server expiry');
  assert.equal((await h.fetch(otherImagePath)).status, 404);
  assert.equal(h.writes.length, savedWrites, 'viewing maps must not replace or expand the saved personal entry');
  assert.ok(!h.writes.some(write => write.name.startsWith(PUBLIC_CACHE_PREFIX) && new URL(write.key).pathname.startsWith('/output/')));
});

test('a corrupt saved image is removed instead of being shown as a successful offline map', async () => {
  const h = await installedWorker();
  const personalCache = await h.caches.open(PERSONAL_CACHE);
  await personalCache.put(PERSONAL_IMAGE_KEY, new Response('<html>broken download</html>', {
    headers: { 'Content-Type': 'image/png', [PERSONAL_SOURCE_HEADER]: imagePath },
  }));
  h.offline();
  assert.equal((await h.fetch(imagePath)).status, 503);
  assert.equal(await personalCache.match(PERSONAL_IMAGE_KEY), undefined);
});

test('broken offline directories return 503, are discarded, and recover when a lookup reconnects', async () => {
  const malformed = [
    '{broken JSON',
    JSON.stringify({ rooms: 'not an array', map_size: roomData.image_size }),
    JSON.stringify({ rooms: [{ id: 'R148', label: 'N214', building: 'N' }], map_size: roomData.image_size }),
    JSON.stringify({ rooms: [locatedRooms[0], locatedRooms[0]], map_size: roomData.image_size }),
    JSON.stringify({ rooms: locatedRooms, map_size: [0, 1584] }),
  ];
  for (const body of malformed) {
    const h = await installedWorker();
    const cache = await h.publicCache();
    await cache.put('/api/offline-rooms', new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    h.offline();
    const broken = await h.fetch('/api/room-lookup?q=N214');
    assert.equal(broken.status, 503);
    assert.equal(broken.headers.get('Cache-Control'), 'no-store');
    assert.match((await broken.json()).error, /directory.*Reconnect/i);
    assert.equal(await cache.match('/api/offline-rooms'), undefined);
    assert.equal((await h.fetch('/api/room-lookup?q=N214')).status, 503);
    h.online();
    assert.equal((await h.fetch('/api/room-lookup?q=N214')).status, 200);
    assert.deepEqual(await (await cache.match('/api/offline-rooms'))?.json(), directory);
    const restoredRequest = h.networkRequests.filter(request => new URL(request.url).pathname === '/api/offline-rooms').at(-1);
    assert.equal(restoredRequest?.cache, 'reload');
    assert.equal(restoredRequest?.credentials, 'omit');
    h.offline();
    const recovered = await h.fetch('/api/room-lookup?q=N214');
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).rooms[0].evacuation.group, null);
  }
});

test('a real successful network request sends ONLINE after an earlier connection failure', async () => {
  const h = await installedWorker();
  h.offline();
  assert.equal((await h.fetch('/api/room-lookup?q=N214')).status, 200);
  assert.equal(h.messages.at(-1), 'GUNNMAP_OFFLINE');
  const messagesBeforeCacheHit = h.messages.length;
  await h.fetch('/find-room', { mode: 'navigate' });
  assert.equal(h.messages.length, messagesBeforeCacheHit, 'a cached page does not prove that the network recovered');
  h.online();
  assert.equal((await h.fetch('/api/room-lookup?q=N214')).status, 200);
  assert.equal(h.messages.at(-1), 'GUNNMAP_ONLINE');
});

async function seedPreviousRelease(h: ReturnType<typeof workerHarness>, changes: string[] = []) {
  await h.lifecycle('install');
  const current = await h.publicCache();
  const previous = await h.caches.open(PUBLIC_CACHE_PREFIX + 'previous-manifest-release');
  for (const key of await current.keys()) await previous.put(key, (await current.match(key))!);
  const manifest = await (await previous.match(PUBLIC_MANIFEST_KEY))!.json() as {url: string; revision: string}[];
  for (const entry of manifest) if (changes.includes(entry.url)) entry.revision = 'previous-revision';
  await previous.put(PUBLIC_MANIFEST_KEY, Response.json(manifest));
  await h.caches.delete(current.name);
  h.networkRequests.length = 0;
  return previous;
}

test('upgrades reuse unchanged maps and scripts but download changed resources and API revisions', async () => {
  const h = workerHarness();
  const previous = await seedPreviousRelease(h, ['/main.js', '/api/offline-rooms']);
  await previous.put('/main.js', new Response('old script'));
  await previous.put('/api/offline-rooms', Response.json({...directory, rooms: [locatedRooms[0]]}));
  await h.lifecycle('install');
  assert.deepEqual(h.networkRequests.map(request => new URL(request.url).pathname).sort(), ['/api/offline-rooms', '/main.js']);
  assert.ok((await h.caches.keys()).includes(previous.name), 'old release is retained until activation');
  await h.lifecycle('activate');
  const cache = await h.publicCache();
  assert.equal(await (await cache.match('/map.webp'))?.text(), 'compressed map');
  assert.equal(await (await cache.match('/evacuation-map.webp'))?.text(), 'compressed map');
  assert.deepEqual(await (await cache.match('/api/offline-rooms'))?.json(), directory);
  assert.notEqual(await (await cache.match('/main.js'))?.text(), 'old script');
  assert.ok(await cache.match(PUBLIC_MANIFEST_KEY), 'only a completed release gets reuse metadata');
});

test('upgrades redownload corrupt directory entries and failed changed resources cannot activate partially', async () => {
  const h = workerHarness();
  const previous = await seedPreviousRelease(h, ['/main.js']);
  await previous.put('/api/offline-rooms', new Response('{broken JSON'));
  h.setNetwork(async request => new URL(request.url).pathname === '/main.js'
    ? new Response('Unavailable', {status: 503}) : defaultNetwork(request));
  await assert.rejects(h.lifecycle('install'), /Precache download failed/);
  assert.deepEqual(h.networkRequests.map(request => new URL(request.url).pathname).sort(), ['/api/offline-rooms', '/main.js']);
  assert.deepEqual(await h.caches.keys(), [previous.name]);
  assert.equal(await (await previous.match('/map.webp'))?.text(), 'compressed map');
  assert.equal(h.claims, 0);
  assert.equal(h.skips, 0);
});

test('slow personal images and room lookups abort and fall back without late ONLINE messages', async () => {
  const h = await installedWorker();
  await (await h.caches.open(PERSONAL_CACHE)).put(PERSONAL_IMAGE_KEY, new Response(png, {
    headers: {'Content-Type': 'image/png', [PERSONAL_SOURCE_HEADER]: imagePath},
  }));
  const resolveLate: ((response: Response) => void)[] = [];
  const requests: Request[] = [];
  h.setNetwork(request => {
    requests.push(request);
    return new Promise<Response>(resolve => { resolveLate.push(resolve); });
  });
  const imageResult = h.fetch(imagePath, {credentials: 'include'});
  const roomResult = h.fetch('/api/room-lookup?q=library', {credentials: 'include'});
  for (let turn = 0; h.timerCount < 2 && turn < 20; turn++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(h.timerCount, 2);
  assert.deepEqual(h.timerDelays, [NETWORK_GET_TIMEOUT_MS, NETWORK_GET_TIMEOUT_MS]);
  h.expireTimeouts();
  const [image, room] = await Promise.all([imageResult, roomResult]);
  assert.equal(image.status, 200);
  assert.equal(room.headers.get('X-GunnMap-Offline'), '1');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal(h.timerCount, 0);
  assert.ok(requests.every(request => request.signal.aborted && request.credentials === 'omit'));
  assert.equal(h.messages.at(-1), 'GUNNMAP_OFFLINE');
  const messageCount = h.messages.length;
  resolveLate[0](new Response(png, {headers: {'Content-Type': 'image/png'}}));
  resolveLate[1](Response.json(directory));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(h.messages.length, messageCount, 'a late response from an aborted probe must not report recovery');
  h.online();
  await h.fetch('/api/room-lookup?q=library');
  assert.equal(h.messages.at(-1), 'GUNNMAP_ONLINE');
  assert.equal(h.timerCount, 0, 'successful requests clear their deadline timers');
});

test('a stalled response body is bounded and an older failure cannot replace a newer ONLINE state', async () => {
  const h = await installedWorker();
  let finishBody: (() => void) | undefined;
  const requests: Request[] = [];
  h.setNetwork(request => {
    requests.push(request);
    return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) { finishBody = () => {controller.enqueue(new TextEncoder().encode('{}')); controller.close();}; },
    }), {headers: {'Content-Type': 'application/json'}}));
  });
  const slowResult = h.fetch('/api/room-lookup?q=library');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(h.timerCount, 1, 'the deadline remains active while the response body stalls');
  h.online();
  assert.equal((await h.fetch('/api/room-lookup?q=K4')).status, 200);
  assert.equal(h.messages.at(-1), 'GUNNMAP_ONLINE');
  const messageCount = h.messages.length;
  h.expireTimeouts();
  assert.equal((await slowResult).headers.get('X-GunnMap-Offline'), '1');
  assert.ok(requests[0].signal.aborted);
  assert.equal(h.messages.length, messageCount, 'older failed requests must not overwrite newer successful connectivity');
  finishBody!();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(h.messages.length, messageCount);
  assert.equal(h.timerCount, 0);
});

test('render POST is sent once without the GET timeout or any automatic retry', async () => {
  const h = await installedWorker();
  let complete: ((response: Response) => void) | undefined;
  let attempts = 0;
  h.setNetwork(async () => { attempts++; return new Promise<Response>(resolve => {complete = resolve;}); });
  const pending = h.fetch('/api/render', {method: 'POST', body: '{}'});
  assert.equal(attempts, 1);
  assert.equal(h.timerCount, 0);
  h.expireTimeouts();
  complete!(Response.json({image_url: imagePath}));
  assert.equal((await pending).status, 200);
  assert.equal(attempts, 1);
});

test('directory reads are parsed once per worker and concurrent repair requests are deduplicated', async () => {
  const h = await installedWorker();
  const cache = await h.publicCache();
  await cache.delete('/api/offline-rooms');
  h.offline();
  assert.equal((await h.fetch('/api/room-lookup?q=library')).status, 503);
  const readsAfterMissing = h.reads.length;
  let finishRepair: ((response: Response) => void) | undefined;
  let repairs = 0;
  h.setNetwork(request => {
    if (new URL(request.url).pathname === '/api/offline-rooms') {
      repairs++;
      return new Promise<Response>(resolve => {finishRepair = resolve;});
    }
    return defaultNetwork(request);
  });
  const lookups = [h.fetch('/api/room-lookup?q=library'), h.fetch('/api/room-lookup?q=K4')];
  for (let turn = 0; !finishRepair && turn < 20; turn++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(finishRepair);
  assert.equal(repairs, 1);
  finishRepair(Response.json(directory));
  await Promise.all(lookups);
  h.offline();
  for (const query of ['library', 'K4', 'A101']) {
    assert.equal((await h.fetch(`/api/room-lookup?q=${query}`)).headers.get('X-GunnMap-Offline'), '1');
  }
  assert.equal(h.reads.length, readsAfterMissing, 'the repaired validated object is reused without reparsing CacheStorage');
  assert.equal(h.timerCount, 0);
});

test('a first image download gets a longer bounded deadline and is never automatically retried', async () => {
  const h = await installedWorker();
  const requests: Request[] = [];
  h.setNetwork(request => {requests.push(request); return new Promise<Response>(() => {});});
  const pending = h.fetch(imagePath);
  for (let turn = 0; !h.timerCount && turn < 20; turn++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(h.timerDelays, [UNSAVED_IMAGE_TIMEOUT_MS]);
  h.expireTimeouts();
  assert.equal((await pending).status, 503);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].signal.aborted);
  assert.equal(h.timerCount, 0);
});

test('reinstalling the same resource version reuses existing resources and preserves them if repair fails', async () => {
  const h = await installedWorker();
  const cache = await h.publicCache();
  h.networkRequests.length = 0;
  h.offline();
  await h.lifecycle('install');
  assert.equal(h.networkRequests.length, 0, 'a toolchain-only worker update can reuse the complete current resource version');
  await cache.delete('/main.js');
  await assert.rejects(h.lifecycle('install'), /Failed to fetch/);
  assert.equal(await (await cache.match('/'))?.text(), shell);
  assert.equal((await h.caches.keys()).includes(cache.name), true, 'a failed repair cannot delete the active cache');
});
