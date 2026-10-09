import { findRoomMatches } from "../../../../src/domain/room-matching.js";
import type { RoomOption } from "../rooms/types.js";
import type { Period } from "./types.js";

export function inferRoomBuilding(rooms: readonly RoomOption[], value: string): string {
  const buildings = new Set(findRoomMatches(rooms, value).map(room => room.building));
  return buildings.size === 1 ? [...buildings][0] : "";
}

export function periodRoomState(period: Period, rooms: readonly RoomOption[]) {
  const matches = findRoomMatches(rooms, period.room, period.building);
  const state = !period.room.trim() ? "empty" : matches.length === 1 ? "matched"
    : matches.length > 1 ? "ambiguous" : "missing";
  return { matches, state, invalid: state === "ambiguous" || state === "missing" };
}
