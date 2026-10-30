import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildPages } from '../build_pages.js';
import { ROOT } from '../project.js';

test('Pages preserves both original map downloads and their separate coordinate systems', async () => {
  const output = await mkdtemp(join(tmpdir(), 'gunnmap-pages-'));
  try {
    await buildPages(output);
    const [campus, evacuation, campusSource, evacuationSource] = await Promise.all([
      readFile(join(output, 'map.png')),
      readFile(join(output, 'evacuation-map.png')),
      readFile(resolve(ROOT, 'src/map/gunn_site_map.png')),
      readFile(resolve(ROOT, 'src/map/gunn_evacuation_map.png')),
    ]);
    assert.deepEqual(campus, campusSource, 'classroom map download must preserve the current campus PNG');
    assert.deepEqual(evacuation, evacuationSource, 'evacuation download must preserve the exact reference PNG');
    assert.notDeepEqual(evacuation, campus, 'the older evacuation reference must remain a distinct asset');

    const reference = JSON.parse(await readFile(join(output, 'data/evacuation.json'), 'utf8'));
    assert.equal(reference.routesAvailable, true);
    assert.deepEqual(Object.keys(reference.groups).sort(), ['black', 'blue', 'green', 'red']);
    assert.deepEqual(reference.provenance.imageSize, [1852, 1156]);
    assert.equal(reference.provenance.verifiedOn, null);

    const directory = JSON.parse(await readFile(join(output, 'data/located-rooms.json'), 'utf8'));
    assert.deepEqual(directory.map_size, [2448, 1584], 'room locations stay on the current campus map');
    const n214 = directory.rooms.find((room: { label: string }) => room.label === 'N214');
    assert.deepEqual(n214.marker, [1651.5, 576.5]);
    assert.equal(n214.evacuation.group, 'black');
    assert.equal(n214.evacuation.reference_label, 'N201-N217');
    assert.equal(n214.evacuation.focus.x, 1696 / 1852, 'reference focus uses the original evacuation dimensions');
    assert.equal(n214.evacuation.focus.y, 380 / 1156);
    const e01 = directory.rooms.find((room: { label: string }) => room.label === 'E01');
    assert.equal(e01.evacuation.status, 'unconfirmed');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
