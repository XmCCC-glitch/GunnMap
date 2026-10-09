import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRoomDirectory, lookupRoom } from "../../web/src/features/rooms/room-api.js";
import { loadScheduleEvacuation } from "../../web/src/features/evacuation/useEvacuationData.js";
import { assemblySummary, evacuationDestination } from "../../web/src/features/evacuation/formatters.js";
import type { EvacuationInfo, LocatedRoom, RoomData } from "../domain/room-contracts.js";
import type { Period } from "../../web/src/features/schedule/types.js";

const mapRevision = "a".repeat(64);
const evacuation: EvacuationInfo = {
  status: "unconfirmed", group: null, color: null, destination: "Unconfirmed",
  short_destination: null, reference_label: null, note: "Follow current school staff directions.",
};
const room: LocatedRoom = {
  id: "R016", label: "A134", building: "A", floor: 1, aliases: [],
  polygon: [[10, 10], [20, 10], [20, 20]], marker: [15, 15], evacuation,
};
const directory: RoomData = {
  rooms: [room], buildings: ["A"], map_revision: mapRevision, map_revision_date: "2026-09-03",
};
const period: Period = { room: room.label, building: room.building, color: "#123456", roomId: room.id, mapRevision };

test("room API uses the known error field and forwards abort signals without credentials", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const urls: string[] = [];
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.signal, controller.signal);
    return Response.json({ error: "Room request rejected." }, { status: 400 });
  };
  try {
    await assert.rejects(loadRoomDirectory(controller.signal), { message: "Room request rejected." });
    await assert.rejects(lookupRoom("D Library", controller.signal), { message: "Room request rejected." });
    assert.deepEqual(urls, ["/api/rooms", "/api/room-lookup?q=D%20Library"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("evacuation lookups distinguish failed requests from unmatched current rooms", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url === "/api/rooms") return Response.json(directory);
    throw new TypeError("Network request failed");
  };
  try {
    const unmatched: Period = { room: "ZZ999", building: "", color: "#654321", mapRevision };
    const data = await loadScheduleEvacuation([period, unmatched], new AbortController().signal);
    assert.deepEqual(data.entries.map(entry => entry.status), ["lookup-failed", "not-found"]);
    assert.equal(data.mapSize, null);
    assert.ok(data.entries.every(entry => entry.marker === null));
    assert.ok(data.entries.every(entry => !("id" in entry)), "unlocated entries must not invent IDs");
  } finally { globalThis.fetch = originalFetch; }
});

test("repeated evacuation periods share one lookup while retaining their own markers", async () => {
  const originalFetch = globalThis.fetch;
  let lookups = 0;
  const controller = new AbortController();
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.signal, controller.signal);
    if (url === "/api/rooms") return Response.json(directory);
    assert.equal(url, `/api/room-lookup?q=${room.id}`);
    lookups += 1;
    return Response.json({ rooms: [room], map_size: [2448, 1584], map_revision: mapRevision, map_revision_date: "2026-09-03" });
  };
  try {
    const data = await loadScheduleEvacuation([period, { ...period, color: "#654321" }], controller.signal);
    assert.equal(lookups, 1);
    assert.deepEqual(data.entries.map(entry => [entry.period, entry.status, entry.color]), [
      [1, "located", "#123456"], [2, "located", "#654321"],
    ]);
    assert.deepEqual(data.mapSize, [2448, 1584]);
  } finally { globalThis.fetch = originalFetch; }
});

test("a changed room directory requires review while request cancellation remains cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async url => url === "/api/rooms"
    ? Response.json(directory)
    : Response.json({ rooms: [room], map_size: [2448, 1584], map_revision: "b".repeat(64), map_revision_date: "2026-09-03" });
  try {
    const changed = await loadScheduleEvacuation([period], controller.signal);
    assert.equal(changed.entries[0].status, "review-required");
    globalThis.fetch = async url => {
      if (url === "/api/rooms") return Response.json(directory);
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    };
    await assert.rejects(loadScheduleEvacuation([period], controller.signal), { name: "AbortError" });
  } finally { globalThis.fetch = originalFetch; }
});

test("shared evacuation formatters retain verified destinations and unconfirmed status", () => {
  assert.equal(evacuationDestination(evacuation), "Unconfirmed");
  assert.equal(assemblySummary(evacuation), "Assembly area not confirmed");
  const mapped: EvacuationInfo = {
    ...evacuation, status: "mapped", group: "red", destination: "Synthetic assembly area",
    short_destination: "Synthetic area", reference_label: "Rally point",
  };
  assert.equal(evacuationDestination(mapped), "Rally point · Synthetic area (red)");
  assert.equal(assemblySummary(mapped), "red group · Rally point · Synthetic area");
  assert.equal(evacuationDestination({ ...mapped, reference_label: "A" }), "Synthetic area (red)");
});
