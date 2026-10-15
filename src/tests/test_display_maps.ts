import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../project.js';

test('lossless display maps preserve every source pixel and map coordinate', async () => {
  for (const [source, display] of [
    ['gunn_site_map.png', 'map.webp'],
    ['gunn_site_map.png', 'evacuation-map.webp'],
  ]) {
    const original = await readFile(resolve(ROOT, 'src/map', source));
    const derivative = await readFile(resolve(ROOT, 'dist/web', display));
    const before = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const after = await sharp(derivative).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(after.info.width, before.info.width, display);
    assert.equal(after.info.height, before.info.height, display);
    assert.deepEqual(after.data, before.data, `${display} must remain pixel-identical`);
    assert.ok(derivative.length < original.length, `${display} should reduce public map transfer size`);
  }
});
