export const PUBLIC_CACHE_PREFIX = 'gunnmap-public-';
export const PUBLIC_MANIFEST_KEY = '/__gunnmap_precache_manifest__';
export const NETWORK_GET_TIMEOUT_MS = 4000;
export const UNSAVED_IMAGE_TIMEOUT_MS = 15000;
export const PERSONAL_CACHE = 'gunnmap-personal-offline-v1';
export const PERSONAL_IMAGE_KEY = '/__gunnmap_saved_map__';
export const PERSONAL_SOURCE_HEADER = 'X-GunnMap-Saved-Source';
export const GENERATED_IMAGE = /^\/output\/period_map_[0-9a-f]{32}\.png$/;
export const APP_ROUTES = new Set(['/', '/evacuation', '/find-room', '/generate-map']);

export function generatedImagePath(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin);
    return url.origin === origin && !url.search && GENERATED_IMAGE.test(url.pathname) ? url.pathname : null;
  } catch { return null; }
}

export function appRoute(path: string): boolean {
  return APP_ROUTES.has(path === '/' ? path : path.replace(/\/$/, ''));
}

/** Reject HTML error pages, empty images and truncated PNGs before replacing a saved map. */
export async function isValidPng(response: Response): Promise<boolean> {
  if (!response.ok || response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'image/png') return false;
  try {
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 45 || !signature.every((value, index) => bytes[index] === value)) return false;
    const view = new DataView(bytes.buffer);
    let offset = 8, hasImage = false;
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset);
      if (size > bytes.length - offset - 12) return false;
      const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (offset === 8 && (name !== 'IHDR' || size !== 13 || view.getUint32(16) === 0 || view.getUint32(20) === 0)) return false;
      if (name === 'IDAT' && size > 0) hasImage = true;
      if (name === 'IEND') return hasImage && size === 0 && offset + 12 === bytes.length;
      offset += size + 12;
    }
    return false;
  } catch { return false; }
}
