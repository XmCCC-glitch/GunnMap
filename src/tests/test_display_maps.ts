import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../project.js';

test('lossless display maps preserve every source pixel and map coordinate', async () => {
  for (const [source, display, width, height] of [
    ['gunn_site_map.png', 'map.webp', 2448, 1584],
    ['gunn_evacuation_map.png', 'evacuation-map.webp', 1852, 1156],
  ] as const) {
    const original = await readFile(resolve(ROOT, 'src/map', source));
    const derivative = await readFile(resolve(ROOT, 'dist/web', display));
    const before = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const after = await sharp(derivative).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(before.info.width, width, source);
    assert.equal(before.info.height, height, source);
    assert.equal(after.info.width, before.info.width, display);
    assert.equal(after.info.height, before.info.height, display);
    assert.deepEqual(after.data, before.data, `${display} must remain pixel-identical`);
    assert.ok(derivative.length < original.length, `${display} should reduce public map transfer size`);
  }
});

test('the evacuation source preserves the exact supplied historical PNG', async () => {
  const original = await readFile(resolve(ROOT, 'src/map/gunn_evacuation_map.png'));
  assert.equal(createHash('sha256').update(original).digest('hex'),
    'e8160bb444213a239c0b8e6d73fe5661944a9c93a7af325ee56f5b6ff1583048');
});
