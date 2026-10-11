import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT, rooms } from "../project.js";
import { findRoomMatches, normalizeRoomInput, roomMatchesInput } from "../domain/room-matching.js";
import { setBoundedImageTransform } from "../../web/src/features/maps/map-pan-bounds.js";
import { buildingCenter, findBuilding } from "../../web/src/features/rooms/building-search.js";
import { buildingData, buildings } from "../project.js";

test("every searchable building has a map region and building names avoid room aliases", () => {
  assert.deepEqual(buildingData.image_size, [2448, 1584]);
  for (const code of buildings) {
    const polygons = buildingData.regions[code]?.polygons;
    assert.ok(polygons?.length, `${code} needs a building outline`);
    assert.ok(polygons.every(polygon => polygon.length >= 3));
    assert.equal(findBuilding(buildingData.regions, `${code} bldg`), code);
    assert.equal(findBuilding(buildingData.regions, `${code} building`), code);
    const [x, y] = buildingCenter(polygons);
    assert.ok(x >= 0 && x <= 2448 && y >= 0 && y <= 1584);
  }
  assert.equal(findBuilding(buildingData.regions, "Bow Gym"), "BG");
  assert.equal(findBuilding(buildingData.regions, "Bow Gymnasium"), "BG");
  assert.equal(findBuilding(buildingData.regions, "library"), null);
});

test("map panning is clamped to the image edges at its current zoom", () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      getComputedStyle: () => ({ paddingLeft: "10px", paddingRight: "10px", paddingTop: "10px", paddingBottom: "10px" }),
    },
  });
  const image = { offsetWidth: 600, offsetHeight: 400, style: { transform: "" } } as unknown as HTMLElement;
  const viewport = { clientWidth: 500, clientHeight: 300 } as unknown as HTMLElement;
  try {
    assert.deepEqual(setBoundedImageTransform(image, viewport, { x: 1000, y: -1000, scale: 1 }), { x: 60, y: -60 });
    assert.equal(image.style.transform, "scale(1) translate(60px, -60px)");
    assert.deepEqual(setBoundedImageTransform(image, viewport, { x: 1000, y: -1000, scale: 2 }), { x: 180, y: -130 });
  } finally {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("room matching normalizes case, spaces, and hyphens while retaining aliases", () => {
  assert.equal(normalizeRoomInput(" n-214 "), "n214");
  const n214 = rooms.find(room => room.label === "N214");
  assert.ok(n214);
  for (const value of ["N214", "n214", "n-214", " n 214 ", "Ｎ – ２１４"]) {
    assert.equal(roomMatchesInput(n214, value), true, value);
  }
  const k6 = rooms.filter(room => roomMatchesInput(room, "K6"));
  assert.equal(k6.length, 1, "only the lower K6 remains selectable");
  assert.equal(k6[0].id, "R070");
  assert.equal(findRoomMatches(rooms, "K6", "N").length, 0);
  for (const room of k6) {
    assert.equal(findRoomMatches(rooms, `${room.label} ( ${room.id} )`, " k ")[0]?.id, room.id);
    assert.equal(findRoomMatches(rooms, room.aliases![0])[0]?.id, room.id);
  }
  for (const legacy of ["R069", "K6 (R069)", "K6 (upper map location)"]) {
    assert.equal(findRoomMatches(rooms, legacy, "K")[0]?.id, "R068");
  }
});

test("schedule defaults retain the seven-period data shape", () => {
  const defaults = JSON.parse(readFileSync(join(ROOT, "web/src/features/schedule/schedule-defaults.json"), "utf8")) as {
    periodColors: string[];
    exampleSchedule: Array<{ building: string; room: string }>;
  };
  assert.equal(defaults.periodColors.length, 7);
  assert.equal(defaults.exampleSchedule.length, 7);
  assert.ok(defaults.periodColors.every(color => /^#[\da-f]{6}$/i.test(color)));
});
