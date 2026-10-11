import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoomMatches, normalizeRoomInput } from './domain/room-matching.js';
const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = existsSync(resolve(here, 'data/room_regions.json'))
  ? resolve(here, '..')
  : resolve(here, '../..');
export function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(ROOT, 'src/data', name), 'utf8')) as T;
}
export type Point = [number, number];
export interface Room {
  id: string; label: string; building: string; floor?: number;
  aliases?: string[]; polygon: Point[]; label_box: [number, number, number, number]; tag_point?: Point;
}
export interface RoomData { base_image: string; image_size: Point; rooms: Room[] }
export const roomData = readJson<RoomData>('room_regions.json');
export const rooms = roomData.rooms;
export const buildings = [...new Set(rooms.map(room => room.building))].sort((a,b) => a === 'BG' ? 1 : b === 'BG' ? -1 : a.localeCompare(b));
export interface BuildingRegion { aliases?: string[]; polygons: Point[][] }
export interface BuildingData { image_size: Point; regions: Record<string, BuildingRegion> }
export const buildingData = readJson<BuildingData>('building_regions.json');
export const normalize = normalizeRoomInput;
export function resolveRoom(building: string, value: string): Room {
  const canonicalBuilding = buildings.find(candidate => normalize(candidate) === normalize(building));
  if (!canonicalBuilding) throw new Error(`Unknown building: ${building}`);
  const matches = findRoomMatches(rooms, value, canonicalBuilding);
  if (!matches.length) {
    const key = normalize(value);
    const byId = findRoomMatches(rooms, value).find(room =>
      key === normalize(room.id) || key.endsWith(`(${normalize(room.id)})`));
    if (byId) throw new Error(`${byId.label} is not in ${canonicalBuilding} Building`);
    throw new Error(`Room '${value}' was not found in ${canonicalBuilding} Building`);
  }
  if (matches.length > 1) {
    const choices = matches.map(room => room.aliases?.[0] ?? room.label).join(', ');
    throw new Error(
      `${value} appears more than once on the map. Choose ${choices}`,
    );
  }
  return matches[0];
}
