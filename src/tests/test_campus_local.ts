import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { buildCampusPeriods } from "../domain/campus-import.js";
import { forgetLocalCampus, newestCampusImport, readLocalCampus, saveLocalCampus } from "../../web/src/features/schedule/campus-local.js";
import { campusRoster, campusDays, campusEvents } from "./fixtures/campus.js";
import type { SavedCampusImport } from "../domain/campus-contract.js";

test("a bookmark import persists, newer extension imports win, and forgotten imports stay forgotten", () => {
  const dom = new JSDOM("", { url: "https://app.test" });
  const storage = dom.window.localStorage;
  const saved: SavedCampusImport = { version: 1, imported_at: "2026-10-15T18:00:00Z",
    data: buildCampusPeriods(campusRoster, campusDays, campusEvents) };
  saveLocalCampus(saved, storage);
  assert.deepEqual(newestCampusImport(readLocalCampus(storage), null), saved);
  const newer = { ...saved, imported_at: "2026-10-15T19:00:00Z" };
  assert.deepEqual(newestCampusImport(readLocalCampus(storage), newer), newer);
  forgetLocalCampus(storage, Date.parse("2026-10-15T20:00:00Z"));
  assert.equal(newestCampusImport(readLocalCampus(storage), newer), null);
  const refreshed = { ...saved, imported_at: "2026-10-15T21:00:00Z" };
  saveLocalCampus(refreshed, storage);
  assert.deepEqual(newestCampusImport(readLocalCampus(storage), newer), refreshed);
  dom.window.close();
});
