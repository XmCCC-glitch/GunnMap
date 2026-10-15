export interface RoomMatchOption {
  id: string;
  label: string;
  aliases?: string[];
}

export function normalizeRoomInput(value: string) {
  return value.normalize("NFKC").replace(/[\s\-‐‑‒–—−]+/g, "").toLowerCase();
}

// Preserve saved schedules from the 2025 map, where R069 was merged into K5.
// The 2026 map prints an upper K6 again, but its identity is not yet confirmed.
const mergedRoomAliases = new Map([
  ["r069", "R068"],
  ["k6(r069)", "R068"],
  ["k6(uppermaplocation)", "R068"],
]);

/** Keep all matches so a genuinely duplicated label can still be disambiguated. */
export function findRoomMatches<T extends RoomMatchOption & { building: string }>(
  rooms: readonly T[], value: string, building = "",
): T[] {
  const buildingKey = normalizeRoomInput(building);
  return rooms.filter(room => (!buildingKey || normalizeRoomInput(room.building) === buildingKey)
    && roomMatchesInput(room, value));
}

export function roomMatchesInput(room: RoomMatchOption, value: string) {
  const query = normalizeRoomInput(value);
  if (!query) return false;
  if (mergedRoomAliases.get(query) === room.id) return true;
  return [room.id, room.label, `${room.label} (${room.id})`, ...(room.aliases ?? [])]
    .some((candidate) => normalizeRoomInput(candidate) === query);
}
