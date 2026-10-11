import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { generatedImagePath, isValidPng, PERSONAL_IMAGE_KEY, PERSONAL_SOURCE_HEADER, MAP_REVISION_HEADER, GENERATED_AT_HEADER } from '../../web/offline/policy.js';
import { generatedMapMetadata, removeOfflineMap, savedOfflineMapInfo, saveMapOffline } from '../../web/src/features/offline/offline-client.js';

const origin = 'https://gunnmap.test';
const first = `/output/period_map_${'a'.repeat(32)}.png`;
const second = `/output/period_map_${'b'.repeat(32)}.png`;
const png = await sharp({create: {width: 2, height: 2, channels: 4, background: '#f00'}}).png().toBuffer();
const image = () => new Response(new Uint8Array(png), {headers: {'Content-Type': 'image/png'}});

test('offline save only accepts same-origin, unique generated image URLs', () => {
  assert.equal(generatedImagePath(first, origin), first);
  for (const path of ['/output/period_map.png', first.toUpperCase(), 'https://other.test' + first, first + '?schedule=secret', '/map.png', 'javascript:alert(1)']) {
    assert.equal(generatedImagePath(path, origin), null);
  }
});

test('PNG validation rejects HTML, truncation and empty PNG headers', async () => {
  assert.equal(await isValidPng(image()), true);
  assert.equal(await isValidPng(new Response('<html>failed</html>', {headers: {'Content-Type': 'image/png'}})), false);
  assert.equal(await isValidPng(new Response(new Uint8Array(png.subarray(0, -12)), {headers: {'Content-Type': 'image/png'}})), false);
  assert.equal(await isValidPng(new Response(new Uint8Array(png), {headers: {'Content-Type': 'text/html'}})), false);
});

test('explicit offline saving atomically replaces one copy and preserves it after download, decode or quota failures', async () => {
  const originals = new Map(['window', 'navigator', 'caches', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const entries = new Map<string, Response>();
  let response = image(), failPut = false, failDecode = false, downloaded = '';
  const cache = {
    match: async (key: string) => entries.get(key)?.clone(),
    put: async (key: string, value: Response) => {
      if (failPut) throw new Error('Quota exceeded');
      entries.set(key, value.clone());
    },
  };
  const storage = {open: async () => cache, delete: async () => {entries.clear(); return true;}};
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {
    location: {origin}, caches: storage,
    createImageBitmap: async () => {if (failDecode) throw new Error('Bad image'); return {close() {}};},
  }});
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {serviceWorker: {getRegistration: async () => ({active: {}})}}});
  Object.defineProperty(globalThis, 'caches', {configurable: true, value: storage});
  Object.defineProperty(globalThis, 'fetch', {configurable: true, value: async (path: string) => {downloaded = path; return response.clone();}});
  try {
    assert.equal(await savedOfflineMapInfo(), null);
    await saveMapOffline(first);
    assert.equal(downloaded, first);
    assert.equal((await savedOfflineMapInfo())?.path, first);
    assert.equal(entries.get(PERSONAL_IMAGE_KEY)?.headers.get(PERSONAL_SOURCE_HEADER), first);
    response = new Response('error page', {headers: {'Content-Type': 'text/html'}});
    await assert.rejects(saveMapOffline(second), /complete PNG/);
    assert.equal((await savedOfflineMapInfo())?.path, first);
    response = image();
    response.headers.set(MAP_REVISION_HEADER, 'c'.repeat(64));
    response.headers.set(GENERATED_AT_HEADER, '2026-10-03T12:34:56.000Z');
    failDecode = true;
    await assert.rejects(saveMapOffline(second), /damaged/);
    assert.equal((await savedOfflineMapInfo())?.path, first);
    failDecode = false;
    failPut = true;
    await assert.rejects(saveMapOffline(second), /Quota/);
    assert.equal((await savedOfflineMapInfo())?.path, first);
    failPut = false;
    await Promise.all([saveMapOffline(first), saveMapOffline(second)]);
    assert.equal(entries.size, 1);
    const saved = await savedOfflineMapInfo();
    assert.ok(saved && [first, second].includes(saved.path));
    const final = entries.get(PERSONAL_IMAGE_KEY)!;
    assert.equal(await isValidPng(final), true);
    const info = await savedOfflineMapInfo();
    assert.equal(info?.mapRevision, 'c'.repeat(64));
    assert.equal(info?.generatedAt, '2026-10-03T12:34:56.000Z');
    assert.ok(info?.savedAt && Number.isFinite(Date.parse(info.savedAt)));
    await removeOfflineMap();
    assert.equal(await savedOfflineMapInfo(), null);
    await assert.rejects(saveMapOffline('/output/period_map.png'), /cannot be saved/);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('missing or invalid image provenance remains unknown instead of adopting the current version', () => {
  assert.deepEqual(generatedMapMetadata(new Headers()), {mapRevision: null, generatedAt: null});
  assert.deepEqual(generatedMapMetadata(new Headers({[MAP_REVISION_HEADER]: 'not-a-revision', [GENERATED_AT_HEADER]: 'yesterday'})),
    {mapRevision: null, generatedAt: null});
});
