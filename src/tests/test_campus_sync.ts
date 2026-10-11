import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapFromCampus, needsFridayStudyHall, needsWednesdayPrime, placementsForDate, responsiveColor,
  responsivePlacements, scheduleForDate, visibleNumericPeriods,
  type CampusPeriods, type CampusPlacement,
} from "../../web/src/features/schedule/campus-sync.js";
import { defaultPeriods } from "../../web/src/features/schedule/schedule-storage.js";
import { findRoomMatches } from "../domain/room-matching.js";
import { rooms } from "../project.js";

const row = (period: string, room: string, start: string | null = null): CampusPlacement => ({
  course: "Synthetic course", course_number: period, section: "1", room,
  teacher: null, period, start_time: "09:00:00", end_time: "09:50:00",
  term: "S1", schedule_name: "W", course_start: start, course_end: null,
});

test("Friday shows an empty Study Hall card only without a selected Study Hall", () => {
  const friday = "2026-10-16";
  assert.equal(scheduleForDate(friday), "F");
  assert.equal(needsFridayStudyHall(friday, [row("SELF 11-12", "M-03")]), true);
  assert.equal(needsFridayStudyHall(friday, [row("SH", "N-203")]), false);
  assert.equal(needsFridayStudyHall(friday, [row("StudyHall", "N-203")]), false);
  assert.equal(needsFridayStudyHall("2026-10-14", [row("SELF 11-12", "M-03")]), false);
});

test("Wednesday shows an empty PRIME card only without a selected PRIME", () => {
  const wednesday = "2026-10-14";
  assert.equal(scheduleForDate(wednesday), "W");
  assert.equal(needsWednesdayPrime(wednesday, [row("6", "J-10")]), true);
  assert.equal(needsWednesdayPrime(wednesday, [row("PRIME", "H-03")]), false);
  assert.equal(needsWednesdayPrime("2026-10-16", [row("6", "J-10")]), false);
});

test("Campus date sync keeps only active placements and recognizes responsive periods", () => {
  const ended = { ...row("6", "C-03"), course_end: "2026-08-23" };
  const data: CampusPeriods = {
    term: "S1", as_of: "2026-10-14", terms: ["S1"], schedules: ["W"],
    periods: [ended, row("6", "J-10", "2026-08-24"),
      row("PRIME", "H-03", "2026-10-14"), row("PRIME", "H-03", "2026-10-14"),
      row("SELF 11-12", "N-211", "2026-10-14")],
  };
  assert.equal(scheduleForDate("2026-10-14"), "W");
  assert.deepEqual(visibleNumericPeriods("2026-10-14"), [5, 6, 7]);
  assert.deepEqual(visibleNumericPeriods("2026-10-13"), [1, 2, 3, 4]);
  const active = placementsForDate(data, "2026-10-14");
  assert.equal(active.length, 3);
  assert.deepEqual(responsivePlacements(active).map(item => item.period), ["PRIME", "SELF 11-12"]);
  assert.equal(responsiveColor("SELF 11-12"), "#06b6d4");
  const imported = mapFromCampus(defaultPeriods(), active);
  assert.equal(imported[5].room, "J-10");
  assert.equal(imported[0].room, "");
  assert.equal(findRoomMatches(rooms, "H-03")[0]?.label, "H3");
});
