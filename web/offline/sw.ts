/// <reference lib="webworker" />
import { findRoomMatches } from '../../src/domain/room-matching.js';
import { appRoute, GENERATED_IMAGE, isValidPng, NETWORK_GET_TIMEOUT_MS, PERSONAL_CACHE, PERSONAL_IMAGE_KEY, PERSONAL_SOURCE_HEADER, PUBLIC_CACHE_PREFIX, PUBLIC_MANIFEST_KEY, UNSAVED_IMAGE_TIMEOUT_MS } from './policy.js';

declare const __OFFLINE_VERSION__: string;
interface PrecacheEntry {url: string; revision: string}
declare const __OFFLINE_MANIFEST__: PrecacheEntry[];
const worker = self as unknown as ServiceWorkerGlobalScope;
const publicCache = PUBLIC_CACHE_PREFIX + __OFFLINE_VERSION__;
const publicPaths = new Set(__OFFLINE_MANIFEST__.map(entry => entry.url));

async function previousReleases(): Promise<{cache: Cache; revisions: Map<string, string>}[]> {
  const releases = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith(PUBLIC_CACHE_PREFIX)) continue;
    const cache = await caches.open(name);
    try {
      const manifest: unknown = await (await cache.match(PUBLIC_MANIFEST_KEY))?.json();
      if (!Array.isArray(manifest) || !manifest.every(entry => record(entry) && string(entry.url) && string(entry.revision))) continue;
      releases.push({cache, revisions: new Map(manifest.map(entry => [entry.url as string, entry.revision as string]))});
    } catch { /* Older versions or damaged metadata are safely downloaded again. */ }
  }
  return releases;
}

async function installPublicResources(): Promise<void> {
  const previous = await previousReleases();
  const existingVersion = (await caches.keys()).includes(publicCache);
  const cache = await caches.open(publicCache);
  try {
    // Populate a separate version; only a complete install is eligible to activate.
    // The manifest is a completion marker and is committed after every resource.
    const results = await Promise.allSettled(__OFFLINE_MANIFEST__.map(async entry => {
      let response: Response | undefined;
      for (const release of previous) {
        if (release.revisions.get(entry.url) !== entry.revision) continue;
        const candidate = await release.cache.match(entry.url);
        if (!candidate?.ok || (entry.url === '/api/offline-rooms' && !await readDirectory(candidate))) continue;
        response = candidate;
        break;
      }
      response ??= await fetch(new Request(entry.url, {cache: 'reload', credentials: 'omit'}));
      if (!response.ok || (entry.url === '/api/offline-rooms' && !await readDirectory(response))) {
        throw new Error(`Precache download failed: ${entry.url}`);
      }
      await cache.put(entry.url, response);
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    await cache.put(PUBLIC_MANIFEST_KEY, Response.json(__OFFLINE_MANIFEST__));
  } catch (error) {
    // A toolchain-only rebuild may install different worker bytes with the same
    // resource version. Never remove an already active cache on a failed repair.
    if (!existingVersion) await caches.delete(publicCache);
    throw error;
  }
}

worker.addEventListener('install', event => {
  event.waitUntil(installPublicResources());
});

worker.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PUBLIC_CACHE_PREFIX) && name !== publicCache).map(name => caches.delete(name)));
    await worker.clients.claim();
  })());
});

worker.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(worker.skipWaiting());
});

function unavailable(message: string): Response {
  return Response.json({error: message}, {status: 503, headers: {'Cache-Control': 'no-store'}});
}

async function reportConnection(type: 'GUNNMAP_OFFLINE' | 'GUNNMAP_ONLINE', sequence: number): Promise<void> {
  try {
    const clients = await worker.clients.matchAll({type: 'window'});
    if (sequence < lastConnectionSequence) return;
    for (const client of clients) client.postMessage({type});
  } catch {
    // A closed client must not prevent a valid network or cached response.
  }
}

let networkSequence = 0, lastConnectionSequence = 0;
async function reportOutcome(sequence: number, type: 'GUNNMAP_OFFLINE' | 'GUNNMAP_ONLINE'): Promise<void> {
  if (sequence < lastConnectionSequence) return;
  lastConnectionSequence = sequence;
  await reportConnection(type, sequence);
}

/** Bound both the response headers and body; an aborted late response cannot report a recovery. */
async function boundedGet(request: Request, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener('abort', abort, {once: true});
  if (request.signal.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(new Request(request, {signal: controller.signal, credentials: 'omit'}));
        const bytes = await response.arrayBuffer();
        const headers = new Headers(response.headers);
        // Fetch decoded the body; do not advertise the original wire encoding/length.
        headers.delete('Content-Encoding');
        headers.delete('Content-Length');
        return new Response([204, 205, 304].includes(response.status) ? null : bytes,
          {status: response.status, statusText: response.statusText, headers});
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Network request timed out'));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}

async function networkFetch(request: Request, timeoutMs?: number): Promise<Response> {
  const sequence = ++networkSequence;
  try {
    const response = timeoutMs !== undefined ? await boundedGet(request, timeoutMs)
      : await fetch(request.method === 'GET' ? new Request(request, {credentials: 'omit'}) : request);
    if (response.ok) await reportOutcome(sequence, 'GUNNMAP_ONLINE');
    return response;
  } catch (error) {
    if (!request.signal.aborted) await reportOutcome(sequence, 'GUNNMAP_OFFLINE');
    throw error;
  }
}

async function savedImage(path: string): Promise<Response | undefined> {
  try {
    const cache = await caches.open(PERSONAL_CACHE);
    const response = await cache.match(PERSONAL_IMAGE_KEY);
    if (!response || response.headers.get(PERSONAL_SOURCE_HEADER) !== path) return;
    if (await isValidPng(response.clone())) return response;
    await cache.delete(PERSONAL_IMAGE_KEY);
  } catch {
    // Unavailable browser storage is handled like an unavailable saved image.
  }
  return undefined;
}

interface OfflineRoom {
  id: string; label: string; building: string; aliases?: string[];
}
interface OfflineDirectory { rooms: OfflineRoom[]; map_size: [number, number] }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const nullableString = (value: unknown) => value === null || string(value);
const point = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n));

/** Validate the fields used by matching, room details and map overlays. */
function validDirectory(value: unknown): value is OfflineDirectory {
  if (!record(value) || !point(value.map_size) || !value.map_size.every(n => Number.isInteger(n) && n > 0)
    || !Array.isArray(value.rooms) || !value.rooms.length) return false;
  const ids = new Set<string>();
  return value.rooms.every(room => {
    if (!record(room) || !string(room.id) || !room.id || ids.has(room.id) || !string(room.label) || !room.label
      || !string(room.building) || !room.building || (room.aliases !== undefined && (!Array.isArray(room.aliases) || !room.aliases.every(string)))
      || typeof room.floor !== 'number' || !Number.isInteger(room.floor) || room.floor < 1
      || !point(room.marker) || !Array.isArray(room.polygon) || room.polygon.length < 3 || !room.polygon.every(point)) return false;
    const evacuation = room.evacuation;
    if (!record(evacuation) || (evacuation.status !== 'mapped' && evacuation.status !== 'unconfirmed')
      || !nullableString(evacuation.group) || !nullableString(evacuation.color)
      || !string(evacuation.destination) || !string(evacuation.note)
      || !nullableString(evacuation.short_destination) || !nullableString(evacuation.reference_label)) return false;
    ids.add(room.id);
    return true;
  });
}

async function readDirectory(response: Response | undefined): Promise<OfflineDirectory | null> {
  if (!response?.ok) return null;
  try {
    const data: unknown = await response.clone().json();
    return validDirectory(data) ? data : null;
  } catch { return null; }
}

let directoryPromise: Promise<OfflineDirectory | null> | undefined;
function cachedDirectory(cache: Cache): Promise<OfflineDirectory | null> {
  directoryPromise ??= (async () => {
    const response = await cache.match('/api/offline-rooms');
    const data = await readDirectory(response);
    if (response && !data) await cache.delete('/api/offline-rooms');
    return data;
  })().catch(error => { directoryPromise = undefined; throw error; });
  return directoryPromise;
}

let restoringDirectory: Promise<void> | undefined;
function restoreDirectory(): Promise<void> {
  restoringDirectory ??= (async () => {
    try {
      const cache = await caches.open(publicCache);
      if (await cachedDirectory(cache)) return;
      const request = new Request(new URL('/api/offline-rooms', worker.location.origin), {cache: 'reload', credentials: 'omit'});
      const response = await networkFetch(request, NETWORK_GET_TIMEOUT_MS);
      const data = await readDirectory(response);
      if (data) {
        await cache.put('/api/offline-rooms', response);
        directoryPromise = Promise.resolve(data);
      }
    } catch {
      // The successful room lookup remains useful even if storage or refresh fails.
    }
  })().finally(() => { restoringDirectory = undefined; });
  return restoringDirectory;
}

async function offlineLookup(url: URL): Promise<Response> {
  const input = url.searchParams.get('q')?.trim() ?? '';
  if (!input) return Response.json({error: 'Enter a room number or room alias.'}, {status: 400});
  let data: OfflineDirectory | null = null;
  try { data = await cachedDirectory(await caches.open(publicCache)); }
  catch { /* Missing or inaccessible storage uses the same recovery message. */ }
  if (!data) return unavailable('The offline classroom directory is unavailable. Reconnect to download it again.');
  return Response.json({rooms: findRoomMatches(data.rooms, input), map_size: data.map_size}, {
    headers: {'Cache-Control': 'no-store', 'X-GunnMap-Offline': '1'},
  });
}

async function handle(request: Request, event: FetchEvent): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/api/render') {
    try { return await networkFetch(request); }
    catch {
      return unavailable('Map generation needs a connection. You can still view maps saved offline.');
    }
  }
  if (request.method !== 'GET') return networkFetch(request);
  if (GENERATED_IMAGE.test(url.pathname)) {
    // Personal images enter this cache only after the user presses Save offline.
    const saved = await savedImage(url.pathname);
    try {
      const response = await networkFetch(request, saved ? NETWORK_GET_TIMEOUT_MS : UNSAVED_IMAGE_TIMEOUT_MS);
      if (response.ok) return response;
      return saved ?? response;
    } catch {
      return saved
        ?? unavailable('This map was not saved offline. Reconnect to download it.');
    }
  }
  if (url.pathname === '/api/room-lookup') {
    try {
      const response = await networkFetch(request, NETWORK_GET_TIMEOUT_MS);
      if (response.ok) event.waitUntil(restoreDirectory());
      return response;
    }
    catch { return offlineLookup(url); }
  }
  const cache = await caches.open(publicCache);
  if (request.mode === 'navigate' && appRoute(url.pathname)) {
    // Serve a shell and scripts from the same build until an update is activated.
    const shell = await cache.match('/');
    if (shell) return shell;
  }
  if (publicPaths.has(url.pathname) && !url.search) {
    const cached = await cache.match(url.pathname);
    if (cached) return cached;
  }
  try { return await networkFetch(request); }
  catch { return unavailable('This page is unavailable offline.'); }
}

worker.addEventListener('fetch', event => {
  if (new URL(event.request.url).origin !== worker.location.origin) return;
  event.respondWith(handle(event.request, event));
});
