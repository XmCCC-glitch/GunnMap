import { findRoomMatches } from "../../../../src/domain/room-matching.js";
import type { EvacuationOverview } from "../evacuation/types.js";
import type { LocatedRoom, RoomData, RoomLookupResponse } from "../rooms/types.js";

export const isPages = import.meta.env?.VITE_PAGES === "true";

export function siteUrl(path: string): string {
  return isPages ? `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}` : path;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error("Map data could not be loaded.");
  return await response.json() as T;
}

let directoryPromise: Promise<RoomLookupResponse> | undefined;

function directory(): Promise<RoomLookupResponse> {
  return directoryPromise ??= readJson<RoomLookupResponse>(siteUrl("data/located-rooms.json"))
    .catch(error => { directoryPromise = undefined; throw error; });
}

export function loadRooms(): Promise<RoomData> {
  return readJson<RoomData>(isPages ? siteUrl("data/rooms.json") : "/api/rooms");
}

export function loadEvacuation(): Promise<EvacuationOverview> {
  return readJson<EvacuationOverview>(isPages ? siteUrl("data/evacuation.json") : "/api/evacuation-data");
}

export async function lookupRoom(query: string): Promise<RoomLookupResponse> {
  if (!query.trim()) throw new Error("Enter a room number or room alias.");
  if (isPages) {
    const data = await directory();
    return { rooms: findRoomMatches(data.rooms, query) as LocatedRoom[], map_size: data.map_size };
  }
  return readJson<RoomLookupResponse>(`/api/room-lookup?q=${encodeURIComponent(query)}`);
}

export async function loadLocatedRooms(): Promise<RoomLookupResponse> {
  return directory();
}
