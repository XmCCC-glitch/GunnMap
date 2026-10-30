import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

/** Display derivatives only: the original maps and downloadable PNGs stay intact. */
export async function buildDisplayMaps(root = process.cwd()): Promise<void> {
  const output = resolve(root, 'dist/web');
  await mkdir(output, { recursive: true });
  for (const [source, target] of [
    ['gunn_site_map.png', 'map.webp'],
    ['gunn_evacuation_map.png', 'evacuation-map.webp'],
  ]) {
    const original = await readFile(resolve(root, 'src/map', source));
    const display = await sharp(original).webp({ lossless: true, effort: 6 }).toBuffer();
    await writeFile(resolve(output, target), display);
    console.log(`${target}: ${original.length.toLocaleString()} → ${display.length.toLocaleString()} bytes (lossless)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildDisplayMaps();
}
