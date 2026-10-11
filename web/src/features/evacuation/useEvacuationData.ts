import { useEffect, useState } from "react";
import { loadRoomDirectory, lookupRoom } from "../rooms/room-api.js";
import type { RoomLookupResponse } from "../rooms/types.js";
import { readCurrentSchedule } from "../schedule/schedule-storage.js";
import { scheduleReview } from "../schedule/schedule-review.js";
import type { Period } from "../schedule/types.js";
import type {
  EvacuationOverview,
  ScheduleEvacuationEntry,
  UnlocatedScheduleEntry,
} from "./types.js";

export async function loadScheduleEvacuation(periods: readonly Period[], signal: AbortSignal) {
  const selected = periods
    .map((period, index) => ({ ...period, period: index + 1, room: period.room.trim() }))
    .filter(period => period.room);
  if (!selected.length) return { entries: [], mapSize: null };

  const inventory = await loadRoomDirectory(signal);
  const needsReview = new Set(scheduleReview(periods, inventory.rooms, inventory.map_revision)
    .map(item => item.index + 1));
  const lookups = new Map<string, Promise<RoomLookupResponse>>();
  const results = await Promise.all(selected.map(async period => {
    const unlocated = (status: UnlocatedScheduleEntry["status"]) => ({
      entry: {
        period: period.period,
        room: period.room,
        building: period.building,
        color: period.color,
        status,
        floor: null,
        marker: null,
        evacuation: null,
      } satisfies UnlocatedScheduleEntry,
      mapSize: null,
    });

    if (needsReview.has(period.period)) return unlocated("review-required");
    const id = period.roomId;
    if (!id) return unlocated("not-found");

    try {
      // Repeated periods share one lookup, while each keeps its own marker.
      let lookup = lookups.get(id);
      if (!lookup) {
        lookup = lookupRoom(id, signal);
        lookups.set(id, lookup);
      }
      const result = await lookup;
      if (result.map_revision !== inventory.map_revision) return unlocated("review-required");
      const room = result.rooms.find(candidate => candidate.id === id
        && (!period.building || candidate.building === period.building));
      if (!room) return unlocated("review-required");

      return {
        entry: {
          period: period.period,
          id: room.id,
          room: room.label,
          building: room.building,
          color: period.color,
          status: "located",
          floor: room.floor,
          marker: room.marker,
          evacuation: room.evacuation,
        } satisfies ScheduleEvacuationEntry,
        mapSize: result.map_size,
      };
    } catch (error) {
      if (signal.aborted) throw error;
      return unlocated("lookup-failed");
    }
  }));
  return {
    entries: results.map(result => result.entry),
    mapSize: results.find(result => result.mapSize)?.mapSize ?? null,
  };
}

export function useEvacuationData() {
  const [overview, setOverview] = useState<EvacuationOverview | null>(null);
  const [entries, setEntries] = useState<ScheduleEvacuationEntry[]>([]);
  const [mapSize, setMapSize] = useState<[number, number]>([2448, 1584]);
  const [overviewError, setOverviewError] = useState("");
  const [scheduleError, setScheduleError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/evacuation-data", { credentials: "omit", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Evacuation data is unavailable.");
        return await response.json() as EvacuationOverview;
      })
      .then(data => {
        if (!controller.signal.aborted) setOverview(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setOverviewError("Evacuation data could not be loaded. Reload the page to try again.");
      });

    void loadScheduleEvacuation(readCurrentSchedule(), controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setEntries(data.entries);
        if (data.mapSize) setMapSize(data.mapSize);
      })
      .catch(() => {
        if (!controller.signal.aborted) setScheduleError("Your saved rooms could not be checked because the room directory failed to load. Reload the page to try again.");
      });

    return () => controller.abort();
  }, []);

  return { overview, entries, mapSize, overviewError, scheduleError };
}
