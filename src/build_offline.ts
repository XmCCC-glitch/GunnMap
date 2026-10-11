import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = process.cwd();
const resources: Record<string, string[]> = {
  '/': ['web/index.html', 'src/server_policy.ts', 'src/web_app.ts'],
  '/main.js': ['dist/web/main.js'],
  '/ui.css': ['dist/web/ui.css'],
  '/style.css': ['web/style.css'],
  '/map.webp': ['dist/web/map.webp'],
  '/manifest.webmanifest': ['web/manifest.webmanifest'],
  '/icon.svg': ['web/icon.svg'],
  '/apple-touch-icon.png': ['web/apple-touch-icon.png'],
  '/pwa-icon-192.png': ['web/pwa-icon-192.png'],
  '/pwa-icon-512.png': ['web/pwa-icon-512.png'],
};
// API revisions include generation/serialization code as well as data. A data-only
// hash would incorrectly retain old payloads after the API response format changes.
const apiInputs = [
  'src/web_app.ts',
  'src/room_response.ts',
  'src/domain/room-contracts.ts',
  'src/project.ts',
  'src/data/room_regions.json',
  'src/data/evacuation_data.json',
  'src/evacuation.ts',
  'src/validate_map_data.ts',
  'src/domain/room-matching.ts',
  'src/map_revision.ts',
  'src/map/gunn_site_map.png',
];
for (const path of ['/api/rooms', '/api/offline-rooms', '/api/evacuation-data']) resources[path] = apiInputs;
for (const name of (await readdir(resolve(root, 'dist/web/assets'))).sort()) {
  if (/\.(?:js|css|woff2?|svg|png|webp)$/.test(name)) resources[`/assets/${name}`] = [`dist/web/assets/${name}`];
}
const manifest = await Promise.all(Object.entries(resources).map(async ([url, inputs]) => {
  const fingerprint = createHash('sha256');
  for (const path of inputs) fingerprint.update(path).update('\0').update(await readFile(resolve(root, path))).update('\0');
  return {url, revision: fingerprint.digest('hex')};
}));
const version = createHash('sha256').update(JSON.stringify(manifest));
for (const path of ['web/offline/sw.ts', 'web/offline/policy.ts', 'src/domain/room-matching.ts', 'src/domain/generated-map-path.ts']) {
  version.update(path).update(await readFile(resolve(root, path)));
}
await build({
  configFile: false,
  publicDir: false,
  define: {__OFFLINE_VERSION__: JSON.stringify(version.digest('hex').slice(0, 16)), __OFFLINE_MANIFEST__: JSON.stringify(manifest)},
  build: {
    outDir: 'dist/web', emptyOutDir: false,
    rollupOptions: {input: resolve(root, 'web/offline/sw.ts'), output: {entryFileNames: 'sw.js'}},
  },
});
