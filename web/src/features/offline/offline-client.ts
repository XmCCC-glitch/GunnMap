import { generatedImagePath, isValidPng, PERSONAL_CACHE, PERSONAL_IMAGE_KEY, PERSONAL_SOURCE_HEADER, MAP_REVISION_HEADER, GENERATED_AT_HEADER, PERSONAL_SAVED_AT_HEADER } from '../../../offline/policy.js';

export interface GeneratedMapMetadata { mapRevision: string | null; generatedAt: string | null }
export interface SavedOfflineMap extends GeneratedMapMetadata { path: string; savedAt: string | null }

function timestamp(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

export function generatedMapMetadata(headers: Headers): GeneratedMapMetadata {
  const revision = headers.get(MAP_REVISION_HEADER);
  return { mapRevision: revision && /^[a-f0-9]{64}$/.test(revision) ? revision : null,
    generatedAt: timestamp(headers.get(GENERATED_AT_HEADER)) };
}

export async function savedOfflineMapInfo(): Promise<SavedOfflineMap | null> {
  if (!('caches' in window)) return null;
  const response = await (await caches.open(PERSONAL_CACHE)).match(PERSONAL_IMAGE_KEY);
  const source = response?.headers.get(PERSONAL_SOURCE_HEADER);
  const path = source && generatedImagePath(source, window.location.origin);
  return path && response && await isValidPng(response)
    ? { path, ...generatedMapMetadata(response.headers), savedAt: timestamp(response.headers.get(PERSONAL_SAVED_AT_HEADER)) }
    : null;
}

export async function saveMapOffline(path: string): Promise<void> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) throw new Error('Offline saving is unavailable in this browser. Download the PNG instead.');
  const validPath = generatedImagePath(path, window.location.origin);
  if (!validPath) throw new Error('This map cannot be saved offline.');
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration?.active) throw new Error('Offline setup is still loading. Try again in a moment.');
  const response = await fetch(validPath, { credentials: 'omit' });
  if (!await isValidPng(response)) throw new Error('The map could not be downloaded as a complete PNG. Reconnect and try again.');
  const blob = await response.blob();
  try {
    if ('createImageBitmap' in window) {
      const bitmap = await window.createImageBitmap(blob);
      bitmap.close();
    } else {
      const image = new Image();
      const url = URL.createObjectURL(blob);
      try { image.src = url; await image.decode(); }
      finally { URL.revokeObjectURL(url); }
    }
  } catch { throw new Error('The downloaded image is damaged. Your previous offline copy has been kept.'); }
  const cache = await caches.open(PERSONAL_CACHE);
  const headers = new Headers(response.headers);
  headers.set(PERSONAL_SOURCE_HEADER, validPath);
  headers.set(PERSONAL_SAVED_AT_HEADER, new Date().toISOString());
  // One atomic entry keeps its identity with its bytes, even if two tabs save together.
  await cache.put(PERSONAL_IMAGE_KEY, new Response(blob, {headers}));
}

export async function removeOfflineMap(): Promise<void> {
  if ('caches' in window) await caches.delete(PERSONAL_CACHE);
}
