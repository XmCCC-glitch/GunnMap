import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface ValidationResult { errors: string[]; warnings: string[] }
type RecordValue = Record<string, unknown>;
type Point = [number, number];
type Box = [number, number, number, number];
interface Assignment { group: string; label: string; box: Box }
interface Range { prefix: string; start: number; end: number; assignment: Assignment; path: string }
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const numbers = (value: unknown, length: number): value is number[] => Array.isArray(value) && value.length === length && value.every(item => typeof item === 'number' && Number.isFinite(item));
const point = (value: unknown): value is Point => numbers(value, 2);
const size = (value: unknown): value is Point => point(value) && value.every(n => Number.isInteger(n) && n > 0);
const inBounds = ([x, y]: Point, bounds?: Point) => x >= 0 && y >= 0 && (!bounds || (x <= bounds[0] && y <= bounds[1]));
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const epsilon = 1e-7;
function onSegment(a: Point, b: Point, p: Point) {
  return Math.abs(cross(a, b, p)) < epsilon && p[0] >= Math.min(a[0], b[0]) - epsilon && p[0] <= Math.max(a[0], b[0]) + epsilon && p[1] >= Math.min(a[1], b[1]) - epsilon && p[1] <= Math.max(a[1], b[1]) + epsilon;
}
function intersects(a: Point, b: Point, c: Point, d: Point) {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
function inside(p: Point, polygon: Point[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (onSegment(a, b, p)) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
function validBox(value: unknown, bounds?: Point): value is Box {
  return numbers(value, 4) && value[0] < value[2] && value[1] < value[3]
    && inBounds([value[0], value[1]], bounds) && inBounds([value[2], value[3]], bounds);
}

/** Parse quoted CSV fields as well as the simple current inventory. */
function parseCsv(value: string) {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted) {
      if (c === '"' && value[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') {
        if (row.some(item => item !== '')) rows.push(row);
        row = [];
        if (c === '\r' && value[i + 1] === '\n') i++;
      }
    } else if (closed || c === '"') throw new Error('invalid quoted field');
    else field += c;
  }
  if (quoted) throw new Error('unterminated quoted field');
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  return rows;
}

/** Pure, read-only validation. Unknown assignments are allowed; routes are never inferred. */
export function validateMapData(roomInput: unknown, csv: string, evacuationInput: unknown): ValidationResult {
  const errors: string[] = [], warnings: string[] = [];
  const fail = (path: string, message: string) => errors.push(`${path}: ${message}`);
  const roomData = record(roomInput) ? roomInput : {};
  if (!record(roomInput)) fail('room_regions', 'expected an object');
  const mapSize = size(roomData.image_size) ? roomData.image_size : undefined;
  if (!mapSize) fail('room_regions.image_size', 'expected two positive integer dimensions');
  if (!text(roomData.base_image)) fail('room_regions.base_image', 'expected an image path');
  const rooms = Array.isArray(roomData.rooms) ? roomData.rooms : [];
  if (!rooms.length) fail('room_regions.rooms', 'expected a non-empty array');
  const inventory = new Map<string, RecordValue>();
  for (const [index, room] of rooms.entries()) {
    const path = `rooms[${index}]`;
    if (!record(room)) { fail(path, 'expected an object'); continue; }
    if (!text(room.id) || !/^R\d{3,}$/.test(room.id)) fail(`${path}.id`, 'expected a stable R-number');
    else if (inventory.has(room.id)) fail(`${path}.id`, `duplicate room ID ${room.id}`);
    else inventory.set(room.id, room);
    if (!text(room.label)) fail(`${path}.label`, 'expected a non-empty label');
    if (!text(room.building) || !/^[A-Z]+$/.test(room.building)) fail(`${path}.building`, 'expected an uppercase building code');
    if (room.floor !== undefined && !(typeof room.floor === 'number' && Number.isInteger(room.floor) && room.floor > 0)) fail(`${path}.floor`, 'expected a positive integer');
    if (room.aliases !== undefined && (!Array.isArray(room.aliases) || !room.aliases.every(text))) fail(`${path}.aliases`, 'expected non-empty strings');
    let polygon: Point[] | undefined;
    if (!Array.isArray(room.polygon) || room.polygon.length < 3 || !room.polygon.every(point)) fail(`${path}.polygon`, 'expected at least three finite coordinate pairs');
    else {
      polygon = room.polygon.slice();
      if (polygon.length > 3 && polygon[0][0] === polygon.at(-1)![0] && polygon[0][1] === polygon.at(-1)![1]) polygon.pop();
      if (polygon.some(p => !inBounds(p, mapSize))) fail(`${path}.polygon`, 'coordinates exceed map bounds');
      if (new Set(polygon.map(p => p.join(','))).size !== polygon.length) fail(`${path}.polygon`, 'contains repeated vertices');
      const area = polygon.reduce((sum, p, i) => { const q = polygon![(i + 1) % polygon!.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
      if (Math.abs(area) < epsilon) fail(`${path}.polygon`, 'has zero area');
      let crossing = false;
      for (let i = 0; i < polygon.length && !crossing; i++) for (let j = i + 1; j < polygon.length; j++) {
        if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
        if (intersects(polygon[i], polygon[(i + 1) % polygon.length], polygon[j], polygon[(j + 1) % polygon.length])) { crossing = true; break; }
      }
      if (crossing) fail(`${path}.polygon`, 'has self-intersecting edges');
    }
    if (!validBox(room.label_box, mapSize)) fail(`${path}.label_box`, 'expected a positive rectangle within map bounds');
    else if (polygon && !inside([(room.label_box[0] + room.label_box[2]) / 2, (room.label_box[1] + room.label_box[3]) / 2], polygon)) fail(`${path}.marker`, 'label-box center lies outside the room polygon');
    if (room.tag_point !== undefined && (!point(room.tag_point) || !inBounds(room.tag_point, mapSize))) fail(`${path}.tag_point`, 'expected a finite point within map bounds');
  }
  try {
    const [header = [], ...rows] = parseCsv(csv.replace(/^\uFEFF/, ''));
    const columns = ['id', 'label', 'building'].map(name => header.indexOf(name));
    if (columns.some(index => index < 0) || new Set(header).size !== header.length) fail('room_index.csv', 'expected distinct columns including id, label, building');
    else {
      const seen = new Set<string>();
      for (const [index, row] of rows.entries()) {
        const path = `room_index.csv row ${index + 2}`, id = row[columns[0]];
        if (row.length !== header.length) fail(path, 'column count does not match header');
        if (seen.has(id)) fail(path, `duplicate room ID ${id}`);
        seen.add(id);
        const room = inventory.get(id);
        if (!room) fail(path, `unknown room ID ${id}`);
        else if (room.label !== row[columns[1]] || room.building !== row[columns[2]]) fail(path, `${id} label or building differs from room_regions.json`);
      }
      for (const id of inventory.keys()) if (!seen.has(id)) fail('room_index.csv', `missing room ID ${id}`);
    }
  } catch (error) { fail('room_index.csv', (error as Error).message); }

  const evacuation = record(evacuationInput) ? evacuationInput : {};
  if (!record(evacuationInput)) fail('evacuation_data', 'expected an object');
  const source = record(evacuation.provenance) ? evacuation.provenance : {};
  if (source.sourceKind !== 'supplied_reference' && source.sourceKind !== 'official_site_map') fail('provenance.sourceKind', 'expected supplied_reference or official_site_map');
  if (evacuation.routesAvailable !== undefined && typeof evacuation.routesAvailable !== 'boolean') fail('routesAvailable', 'expected a boolean');
  const routesAvailable = evacuation.routesAvailable !== false;
  for (const key of ['originalFilename', 'sourceFile']) if (!text(source[key])) fail(`provenance.${key}`, 'expected non-empty text');
  if (typeof source.sourceImageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sourceImageSha256)) fail('provenance.sourceImageSha256', 'expected a SHA-256 fingerprint');
  const sourceSize = size(source.imageSize) ? source.imageSize : undefined;
  if (!sourceSize) fail('provenance.imageSize', 'expected two positive integer dimensions');
  for (const key of ['sourceRevisionDate', 'verifiedOn']) {
    const value = source[key];
    if (value !== null && !(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)) fail(`provenance.${key}`, 'expected a real YYYY-MM-DD date, or null when unknown');
  }
  const groupNames = ['red', 'blue', 'green', 'black'];
  const groups = record(evacuation.groups) ? evacuation.groups : {};
  for (const name of routesAvailable ? groupNames : []) {
    const group = groups[name];
    if (!record(group)) { fail(`groups.${name}`, 'expected group information'); continue; }
    for (const key of ['title', 'destination', 'shortDestination']) if (!text(group[key])) fail(`groups.${name}.${key}`, 'expected non-empty text');
    if (typeof group.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(group.color)) fail(`groups.${name}.color`, 'expected a six-digit hex color');
    if (!Array.isArray(group.labels) || !group.labels.length || !group.labels.every(text) || new Set(group.labels).size !== group.labels.length) fail(`groups.${name}.labels`, 'expected distinct non-empty reference labels');
    if (group.appendReferenceLabel !== undefined && typeof group.appendReferenceLabel !== 'boolean') fail(`groups.${name}.appendReferenceLabel`, 'expected a boolean');
    if (group.description !== undefined && !text(group.description)) fail(`groups.${name}.description`, 'expected non-empty text');
  }
  for (const name of Object.keys(groups)) if (!groupNames.includes(name)) fail(`groups.${name}`, 'unknown assembly group');
  if (!routesAvailable) {
    if (Object.keys(groups).length) fail('groups', 'must be empty while routes are unavailable');
    for (const key of ['ranges', 'exact', 'whole'] as const) {
      const value = evacuation[key];
      if ((Array.isArray(value) && value.length) || (record(value) && Object.keys(value).length)) fail(key, 'assignments must be empty while routes are unavailable');
    }
  }
  const exceptions = record(evacuation.inventoryExceptions) ? evacuation.inventoryExceptions : {};
  if (!record(evacuation.inventoryExceptions)) fail('inventoryExceptions', 'expected an object with documented exceptions');
  for (const [key, value] of Object.entries(exceptions)) if (!text(key) || !text(value)) fail(`inventoryExceptions.${key}`, 'expected an explanation');
  function hasException(key: string) { return text(exceptions[key]); }
  function roomNumber(room: RecordValue) {
    return typeof room.label === 'string' ? room.label.toUpperCase().match(/^([A-Z]+)([1-9][0-9]*)$/) : null;
  }
  function assignment(value: unknown, path: string): Assignment | undefined {
    if (!Array.isArray(value) || value.length !== 3) { fail(path, 'expected [group, reference label, focus rectangle]'); return; }
    let valid = true;
    if (!groupNames.includes(value[0])) { fail(path, 'unknown assembly group'); valid = false; }
    if (!text(value[1])) { fail(path, 'expected a reference label'); valid = false; }
    const group = typeof value[0] === 'string' ? groups[value[0]] : undefined;
    if (record(group) && Array.isArray(group.labels) && !group.labels.includes(value[1])) { fail(path, `reference label “${value[1]}” is missing from the group legend`); valid = false; }
    if (!validBox(value[2], sourceSize)) { fail(`${path}.focus`, 'expected a positive rectangle within source image bounds'); valid = false; }
    if (valid) return { group: value[0], label: value[1], box: value[2] };
  }
  const ranges: Range[] = [];
  if (!Array.isArray(evacuation.ranges)) fail('ranges', 'expected an array');
  else for (const [index, row] of evacuation.ranges.entries()) {
    const path = `ranges[${index}]`;
    if (!Array.isArray(row) || row.length !== 6) { fail(path, 'expected [prefix, start, end, group, label, focus]'); continue; }
    const match = assignment(row.slice(3), path);
    if (typeof row[0] !== 'string' || !/^[A-Z]+$/.test(row[0]) || !Number.isSafeInteger(row[1]) || !Number.isSafeInteger(row[2]) || row[1] < 1 || row[1] > row[2]) fail(path, 'expected an uppercase prefix and an ordered positive integer range');
    else if (match) ranges.push({prefix: row[0], start: row[1], end: row[2], assignment: match, path});
  }
  const exact = new Map<string, Assignment>(), whole = new Map<string, Assignment>();
  for (const [key, target, pattern] of [['exact', exact, /^[A-Z]+[1-9][0-9]*$/], ['whole', whole, /^[A-Z]+$/]] as const) {
    const entries = evacuation[key];
    if (!record(entries)) { fail(key, 'expected an object'); continue; }
    for (const [name, value] of Object.entries(entries)) {
      if (!pattern.test(name)) { fail(`${key}.${name}`, 'non-canonical assignment key'); continue; }
      const result = assignment(value, `${key}.${name}`);
      if (result) target.set(name, result);
    }
  }
  const same = (a: Assignment, b: Assignment) => a.group === b.group && a.label === b.label && a.box.every((n, i) => n === b.box[i]);
  function shadow(path: string, coveringPath: string, a: Assignment, b: Assignment) {
    if (!same(a, b)) fail(path, `conflicts with ${coveringPath}; lookup precedence would hide one assignment`);
    else warnings.push(`${path}: duplicates ${coveringPath}; both describe the same assignment`);
  }
  for (const [index, range] of ranges.entries()) {
    for (const other of ranges.slice(index + 1)) if (range.prefix === other.prefix && range.start <= other.end && other.start <= range.end) fail(other.path, `overlaps ${range.path}${same(range.assignment, other.assignment) ? '' : ' with a conflicting assignment'}`);
    const covering = whole.get(range.prefix);
    if (covering) shadow(range.path, `whole.${range.prefix}`, range.assignment, covering);
    const matchesInventory = [...inventory.values()].some(room => {
      const match = roomNumber(room);
      return room.building === range.prefix && match?.[1] === range.prefix && Number(match[2]) >= range.start && Number(match[2]) <= range.end;
    });
    if (!matchesInventory && !hasException(range.assignment.label)) fail(range.path, 'no matching inventory room or documented inventory exception');
  }
  for (const [name, value] of exact) {
    const [, prefix, number] = name.match(/^([A-Z]+)([1-9][0-9]*)$/)!;
    const covering = whole.get(prefix);
    if (covering) shadow(`exact.${name}`, `whole.${prefix}`, value, covering);
    for (const range of ranges) if (range.prefix === prefix && Number(number) >= range.start && Number(number) <= range.end) shadow(`exact.${name}`, range.path, value, range.assignment);
    const matches = [...inventory.values()].filter(room => typeof room.label === 'string' && room.label.replace(/[\s-]+/g, '').toUpperCase() === name && room.building === prefix);
    if (!matches.length && !hasException(name)) fail(`exact.${name}`, 'missing from the inventory without a documented exception');
    if (matches.length > 1) fail(`exact.${name}`, 'matches multiple rooms; preserve their stable IDs');
  }
  for (const name of whole.keys()) if (![...inventory.values()].some(room => room.building === name) && !hasException(name)) fail(`whole.${name}`, 'missing from the inventory without a documented exception');
  return {errors, warnings};
}

/** Check the JSON/CSV plus the actual PNG dimensions, without generating any files. */
export function validateMapFiles(directory: string): ValidationResult {
  const dataDirectory = existsSync(resolve(directory, 'src/data/room_regions.json'))
    ? resolve(directory, 'src/data')
    : directory;
  const readJson = (name: string): unknown => JSON.parse(readFileSync(resolve(dataDirectory, name), 'utf8'));
  const roomData = readJson('room_regions.json'), evacuation = readJson('evacuation_data.json');
  const result = validateMapData(roomData, readFileSync(resolve(dataDirectory, 'room_index.csv'), 'utf8'), evacuation);
  function checkImage(path: unknown, expected: unknown, label: string, expectedHash?: unknown) {
    if (!text(path) || !size(expected)) return;
    try {
      const bytes = readFileSync(resolve(directory, path));
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('expected a PNG with an IHDR header');
      const actual = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
      if (actual[0] !== expected[0] || actual[1] !== expected[1]) result.errors.push(`${label}: metadata ${expected.join('×')} differs from PNG ${actual.join('×')}`);
      if (typeof expectedHash === 'string' && createHash('sha256').update(bytes).digest('hex') !== expectedHash) result.errors.push(`${label}: source image fingerprint changed; review assignments and reference coordinates`);
    } catch (error) { result.errors.push(`${label}: ${(error as Error).message}`); }
  }
  if (record(roomData)) checkImage(roomData.base_image, roomData.image_size, 'room_regions.image_size');
  if (record(evacuation) && record(evacuation.provenance)) checkImage(evacuation.provenance.sourceFile, evacuation.provenance.imageSize, 'provenance.imageSize', evacuation.provenance.sourceImageSha256);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = existsSync(resolve(here, 'data/room_regions.json')) ? resolve(here, '..') : resolve(here, '../..');
  try {
    const result = validateMapFiles(root);
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    for (const error of result.errors) console.error(`Error: ${error}`);
    if (result.errors.length) process.exitCode = 1;
    else console.log(`Map data valid. ${result.warnings.length} warning(s). No files generated.`);
  } catch (error) {
    console.error(`Map data validation failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
