import { normalizeRoomInput } from "../../../../src/domain/room-matching.js";
import { buildingName } from "./room-display.js";
import type { RoomData } from "./types.js";

export type BuildingRegions = RoomData["building_regions"];

export function buildingSearchTerms(code: string, aliases: string[] = []): string[] {
  return [code, `${code} building`, `${code} bldg`, buildingName(code), ...aliases];
}

export function findBuilding(regions: BuildingRegions, input: string): string | null {
  const query = normalizeRoomInput(input);
  if (!query) return null;
  return Object.keys(regions).filter(code => code !== "LIBRARY").find(code => buildingSearchTerms(code, regions[code].aliases)
    .some(term => normalizeRoomInput(term) === query)) ?? null;
}

export function buildingCenter(polygons: [number, number][][]): [number, number] {
  const points = polygons.flat();
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
