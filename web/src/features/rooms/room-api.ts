import type { ApiError, RoomData, RoomLookupResponse } from "./types.js";
import { isPages, loadRooms, lookupRoom as lookupPagesRoom } from "../pages/site-data.js";

async function readRoomResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const result = await response.json() as ApiError;
    throw new Error(result.error);
  }
  return await response.json() as T;
}

export async function loadRoomDirectory(signal?: AbortSignal): Promise<RoomData> {
  if (isPages) {
    const result = await loadRooms();
    signal?.throwIfAborted();
    return result;
  }
  const response = await fetch("/api/rooms", { credentials: "omit", signal });
  return await readRoomResponse<RoomData>(response);
}

export async function lookupRoom(query: string, signal?: AbortSignal): Promise<RoomLookupResponse> {
  if (isPages) {
    const result = await lookupPagesRoom(query);
    signal?.throwIfAborted();
    return result;
  }
  const response = await fetch(`/api/room-lookup?q=${encodeURIComponent(query)}`, {
    credentials: "omit",
    signal,
  });
  return await readRoomResponse<RoomLookupResponse>(response);
}
