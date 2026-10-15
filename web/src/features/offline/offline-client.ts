import { generatedImagePath, isValidPng, PERSONAL_CACHE, PERSONAL_IMAGE_KEY, PERSONAL_SOURCE_HEADER } from '../../../offline/policy.js';

export async function savedOfflineMap(): Promise<string> {
  if (!('caches' in window)) return '';
  const response = await (await caches.open(PERSONAL_CACHE)).match(PERSONAL_IMAGE_KEY);
  const source = response?.headers.get(PERSONAL_SOURCE_HEADER);
  return source && response && await isValidPng(response) ? generatedImagePath(source, window.location.origin) ?? '' : '';
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
  // One atomic entry keeps its identity with its bytes, even if two tabs save together.
  await cache.put(PERSONAL_IMAGE_KEY, new Response(blob, {headers}));
}

export async function removeOfflineMap(): Promise<void> {
  if ('caches' in window) await caches.delete(PERSONAL_CACHE);
}
