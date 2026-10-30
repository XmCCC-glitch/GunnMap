import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../project.js';
import { evacuationForRoom, evacuationOverview, type EvacuationData, type EvacuationProvenance } from '../evacuation.js';
import { validateMapData, validateMapFiles } from '../validate_map_data.js';

interface Fixture {
  roomData: {
    base_image: string; image_size: number[];
    rooms: { id: string; label: string; building: string; polygon: number[][]; label_box: number[]; tag_point?: number[] }[];
  };
  csv: string;
  evacuationData: {
    provenance: EvacuationProvenance; routesAvailable?: boolean; ranges: unknown[][];
    groups: EvacuationData['groups']; inventoryExceptions: Record<string, string>;
    exact: Record<string, unknown[]>; whole: Record<string, unknown[]>;
  };
}
const reference = JSON.parse(readFileSync(join(ROOT, 'src/data/evacuation_data.json'), 'utf8')) as EvacuationData;

function fixture(): Fixture {
  return {
    roomData: {
      base_image: 'map.png', image_size: [100, 100],
      rooms: [{id: 'R001', label: 'A101', building: 'A', polygon: [[10, 10], [30, 10], [30, 30], [10, 30]], label_box: [12, 12, 20, 20]}],
    },
    csv: 'id,label,building,purpose\nR001,A101,A,\n',
    evacuationData: {
      provenance: {...reference.provenance, sourceFile: 'reference.png', imageSize: [200, 100]},
      groups: Object.fromEntries(['red', 'blue', 'green', 'black'].map(name => [name, {
        title: `${name} test group`, color: '#123456', destination: 'Test assembly area',
        shortDestination: 'Test area',
        labels: ['A101-A103', 'A104-A105', 'B101-B103', 'Another group', 'A101', 'A', 'E1-E2', 'Titan Gym'],
      }])) as EvacuationData['groups'],
      inventoryExceptions: {},
      ranges: [['A', 101, 103, 'green', 'A101-A103', [20, 20, 40, 30]]], exact: {}, whole: {},
    },
  };
}
const validate = (value: Fixture) => validateMapData(value.roomData, value.csv, value.evacuationData);
function rejectsMutation(change: (value: Fixture) => void, pattern: RegExp) {
  const value = fixture();
  change(value);
  assert.match(validate(value).errors.join('\n'), pattern);
}

test('repository data, inventory and actual PNG dimensions are consistent', () => {
  assert.deepEqual(validateMapFiles(ROOT), {errors: [], warnings: []});
});

test('restored evacuation reference preserves its fingerprint and unverified provenance', () => {
  const {provenance, routesAvailable, groups, inventoryExceptions, validationIssues} = evacuationOverview();
  assert.equal(provenance.sourceKind, 'supplied_reference');
  assert.equal(provenance.originalFilename, '截屏2026-09-23 上午9.00.56.png');
  assert.equal(provenance.sourceFile, 'src/map/gunn_evacuation_map.png');
  assert.equal(provenance.sourceImageSha256, 'e8160bb444213a239c0b8e6d73fe5661944a9c93a7af325ee56f5b6ff1583048');
  assert.deepEqual(provenance.imageSize, [1852, 1156]);
  assert.equal(provenance.sourceRevisionDate, null);
  assert.equal(provenance.verifiedOn, null);
  assert.equal(reference.routesAvailable, true, 'availability is explicit in the restored source');
  assert.equal(routesAvailable, true);
  assert.deepEqual(Object.keys(groups), ['red', 'blue', 'green', 'black']);
  assert.equal(reference.ranges.length, 18);
  assert.deepEqual(Object.keys(reference.exact), ['P105', 'P115', 'P117', 'S101', 'S102', 'S121', 'S147']);
  assert.deepEqual(Object.keys(reference.whole), ['A', 'B', 'D', 'BG', 'TG']);
  assert.deepEqual(Object.keys(inventoryExceptions), ['E1-E2', 'S147', 'TG']);
  assert.match(inventoryExceptions['E1-E2'], /E01 and E02/);
  for (const group of Object.values(groups)) assert.match(group.destination, /^Historical reference:/);
  assert.deepEqual(validationIssues, []);
  const mapped = evacuationForRoom({label: 'N214', building: 'N'});
  assert.equal(mapped.status, 'mapped');
  assert.equal(mapped.reference_label, 'N201-N217');
  assert.notEqual(mapped.focus, null);
  assert.match(mapped.note, /supplied, unverified older evacuation plan/);
  assert.match(mapped.note, /follow current school staff directions/i);
  for (const label of ['E01', 'E02', 'N200', 'N223']) {
    const unresolved = evacuationForRoom({label, building: label[0]});
    assert.equal(unresolved.status, 'unconfirmed', label);
    assert.equal(unresolved.group, null, label);
    assert.equal(unresolved.focus, null, label);
  }
});

test('unavailable routes cannot silently retain historical assignments', () => {
  const value = fixture();
  value.evacuationData.provenance.sourceKind = 'official_site_map';
  value.evacuationData.routesAvailable = false;
  assert.match(validate(value).errors.join('\n'), /assignments must be empty while routes are unavailable/);
  value.evacuationData.ranges = [];
  value.evacuationData.groups = {} as EvacuationData['groups'];
  assert.deepEqual(validate(value).errors, []);
});

test('unique IDs and CSV membership are enforced while duplicate room labels remain valid', () => {
  rejectsMutation(v => v.roomData.rooms.push(structuredClone(v.roomData.rooms[0])), /duplicate room ID R001/);
  rejectsMutation(v => v.csv += 'R001,A101,A,\n', /duplicate room ID R001/);
  rejectsMutation(v => v.csv = 'id,label,building,purpose\n', /missing room ID R001/);
  rejectsMutation(v => v.csv += 'R099,A102,A,\n', /unknown room ID R099/);
  rejectsMutation(v => v.csv = v.csv.replace('R001,A101,A,', 'R001,A102,A,'), /label or building differs/);
  const value = fixture();
  value.roomData.rooms.push({...structuredClone(value.roomData.rooms[0]), id: 'R002'});
  value.csv += 'R002,A101,A,\n';
  assert.deepEqual(validate(value).errors, []);
});

test('CSV quoting, line endings and malformed rows are handled explicitly', () => {
  const value = fixture();
  value.csv = '\uFEFFid,label,building,purpose\r\n"R001","A101",A,"Lab, \"\"east\"\""\r\n';
  assert.deepEqual(validate(value).errors, []);
  rejectsMutation(v => v.csv = 'id,label,building,purpose\nR001,"A101,A,', /unterminated quoted field/);
  rejectsMutation(v => v.csv = 'id,label,building,purpose\nR001,A101,A', /column count/);
  rejectsMutation(v => v.csv = 'id,label,label\nR001,A101,A\n', /distinct columns/);
});

test('invalid, degenerate, crossing and out-of-bounds room polygons are rejected', () => {
  rejectsMutation(v => v.roomData.rooms[0].polygon = [[10, 10], [20, 20]], /at least three/);
  rejectsMutation(v => v.roomData.rooms[0].polygon[0][0] = NaN, /finite coordinate pairs/);
  rejectsMutation(v => v.roomData.rooms[0].polygon[0][0] = -1, /coordinates exceed map bounds/);
  rejectsMutation(v => v.roomData.rooms[0].polygon = [[10, 10], [20, 20], [30, 30]], /zero area/);
  rejectsMutation(v => v.roomData.rooms[0].polygon = [[10, 10], [30, 30], [10, 30], [30, 10]], /self-intersecting/);
  rejectsMutation(v => v.roomData.rooms[0].polygon = [[10, 10], [30, 10], [10, 10], [10, 30]], /repeated vertices/);
  const value = fixture();
  value.roomData.rooms[0].polygon.push([10, 10]);
  assert.deepEqual(validate(value).errors, [], 'an explicitly closed polygon is valid');
});

test('room label boxes and their derived clickable markers must stay on their room', () => {
  rejectsMutation(v => v.roomData.rooms[0].label_box = [20, 12, 12, 20], /label_box/);
  rejectsMutation(v => v.roomData.rooms[0].label_box = [12, 12, 120, 20], /label_box/);
  rejectsMutation(v => v.roomData.rooms[0].label_box = [50, 50, 60, 60], /marker.*outside the room polygon/);
  rejectsMutation(v => v.roomData.rooms[0].tag_point = [Infinity, 30], /tag_point/);
});

test('source dimensions, dates and assignment focus rectangles are validated', () => {
  rejectsMutation(v => v.evacuationData.provenance.imageSize = [0, 100], /provenance.imageSize/);
  rejectsMutation(v => v.evacuationData.provenance.sourceRevisionDate = '2026-02-30', /provenance.sourceRevisionDate/);
  rejectsMutation(v => v.evacuationData.provenance.verifiedOn = 'unknown', /provenance.verifiedOn/);
  rejectsMutation(v => v.evacuationData.ranges[0][5] = [20, 20, 201, 30], /focus.*source image bounds/);
  rejectsMutation(v => v.evacuationData.ranges[0][5] = [40, 20, 20, 30], /focus.*positive rectangle/);
  rejectsMutation(v => v.evacuationData.ranges[0][3] = 'purple', /unknown assembly group/);
  const value = fixture();
  value.evacuationData.provenance.verifiedOn = '2024-02-29';
  assert.deepEqual(validate(value).errors, []);
});

test('inclusive range overlaps are rejected even when their destinations agree', () => {
  rejectsMutation(v => v.evacuationData.ranges.push(['A', 103, 105, 'green', 'A101-A103', [20, 20, 40, 30]]), /overlaps ranges\[0\]/);
  rejectsMutation(v => v.evacuationData.ranges.push(['A', 102, 105, 'blue', 'Another group', [60, 20, 80, 30]]), /overlaps.*conflicting assignment/);
  rejectsMutation(v => v.evacuationData.ranges[0][2] = 100, /ordered positive integer range/);
  const value = fixture();
  value.evacuationData.ranges.push(['A', 104, 105, 'green', 'A104-A105', [20, 35, 40, 45]]);
  value.evacuationData.ranges.push(['B', 101, 103, 'blue', 'B101-B103', [50, 20, 70, 30]]);
  value.evacuationData.inventoryExceptions = {'A104-A105': 'Reference rooms outside this test inventory.', 'B101-B103': 'Reference rooms outside this test inventory.'};
  assert.deepEqual(validate(value).errors, []);
});

test('exact and whole-building assignments cannot silently override conflicting rules', () => {
  rejectsMutation(v => v.evacuationData.exact.A101 = ['blue', 'A101', [60, 20, 80, 30]], /exact.A101.*conflicts with ranges\[0\]/);
  rejectsMutation(v => v.evacuationData.whole.A = ['blue', 'A', [60, 20, 80, 30]], /ranges\[0\].*conflicts with whole.A/);
  rejectsMutation(v => {
    v.evacuationData.ranges = [];
    v.evacuationData.whole.A = ['green', 'A', [20, 20, 40, 30]];
    v.evacuationData.exact.A101 = ['green', 'A101', [60, 20, 80, 30]];
  }, /exact.A101.*conflicts with whole.A/);
  rejectsMutation(v => v.evacuationData.exact.E01 = ['green', 'E1-E2', [20, 20, 40, 30]], /non-canonical assignment key/);
  const value = fixture();
  value.evacuationData.exact.A101 = ['green', 'A101-A103', [20, 20, 40, 30]];
  const result = validate(value);
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join('\n'), /exact.A101.*duplicates ranges\[0\]/);
});

test('unassigned rooms remain valid and malformed document roots report errors', () => {
  const value = fixture();
  value.evacuationData.ranges = [];
  assert.deepEqual(validate(value), {errors: [], warnings: []});
  const malformed = validateMapData(null, '', []);
  assert.ok(malformed.errors.some(error => error.startsWith('room_regions:')));
  assert.ok(malformed.errors.some(error => error.startsWith('evacuation_data:')));
});

test('group legend and inventory exceptions keep source-only labels explicit', () => {
  rejectsMutation(v => v.evacuationData.groups.green.labels = ['A'], /missing from the group legend/);
  rejectsMutation(v => v.evacuationData.ranges[0][1] = 102, /no matching inventory room/);
  rejectsMutation(v => v.evacuationData.exact.A102 = ['green', 'A101-A103', [20, 20, 40, 30]], /exact.A102.*missing from the inventory/);
  rejectsMutation(v => v.evacuationData.whole.TG = ['green', 'Titan Gym', [20, 20, 40, 30]], /whole.TG.*missing from the inventory/);
  const value = fixture();
  value.evacuationData.whole.TG = ['green', 'Titan Gym', [20, 20, 40, 30]];
  value.evacuationData.inventoryExceptions.TG = 'Titan Gym has no selectable room geometry.';
  assert.deepEqual(validate(value).errors, []);
});

test('file validation catches image metadata drift before a changed source misplaces highlights', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gunnmap-data-'));
  const value = fixture();
  const header = (width: number, height: number) => {
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
    return bytes;
  };
  value.evacuationData.provenance.sourceImageSha256 = createHash('sha256').update(header(200, 100)).digest('hex');
  try {
    await Promise.all([
      writeFile(join(directory, 'room_regions.json'), JSON.stringify(value.roomData)),
      writeFile(join(directory, 'evacuation_data.json'), JSON.stringify(value.evacuationData)),
      writeFile(join(directory, 'room_index.csv'), value.csv),
      writeFile(join(directory, 'map.png'), header(100, 100)),
      writeFile(join(directory, 'reference.png'), header(200, 100)),
    ]);
    assert.deepEqual(validateMapFiles(directory), {errors: [], warnings: []});
    await writeFile(join(directory, 'reference.png'), header(400, 200));
    assert.match(validateMapFiles(directory).errors.join('\n'), /provenance.imageSize.*200×100.*400×200/);
    assert.match(validateMapFiles(directory).errors.join('\n'), /fingerprint changed/);
    await rm(join(directory, 'map.png'));
    assert.match(validateMapFiles(directory).errors.join('\n'), /room_regions.image_size.*ENOENT/);
  } finally { await rm(directory, {recursive: true, force: true}); }
});
