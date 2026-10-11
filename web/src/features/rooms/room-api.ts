import type { ApiError, RoomData, RoomLookupResponse } from "./types.js";

async function readRoomResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const result = await response.json() as ApiError;
    throw new Error(result.error);
  }
  return await response.json() as T;
}

export async function loadRoomDirectory(signal?: AbortSignal): Promise<RoomData> {
  const response = await fetch("/api/rooms", { credentials: "omit", signal });
  return await readRoomResponse<RoomData>(response);
}

export async function lookupRoom(query: string, signal?: AbortSignal): Promise<RoomLookupResponse> {
  const response = await fetch(`/api/room-lookup?q=${encodeURIComponent(query)}`, {
    credentials: "omit",
    signal,
  });
  return await readRoomResponse<RoomLookupResponse>(response);
}
