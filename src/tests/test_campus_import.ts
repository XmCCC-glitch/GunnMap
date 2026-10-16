import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCampusPeriods, campusDate, campusStructure } from "../domain/campus-import.js";
import { isAppUrl, isCampusUrl, parseCampusPeriods, parseSavedCampusImport } from "../domain/campus-contract.js";
import { isNoClassDate, needsFridayStudyHall, needsWednesdayPrime, placementsForDate, visibleNumericPeriods } from "../../web/src/features/schedule/campus-sync.js";
import { campusRoster, campusDays, campusEvents } from "./fixtures/campus.js";

const now = new Date("2026-10-15T18:00:00Z");

test("one import preserves next semester and intersects enrollment, placement and term dates", () => {
  const data = buildCampusPeriods(campusRoster, campusDays, campusEvents, now);
  assert.deepEqual(data.terms, ["S1", "S2"]);
  assert.equal(data.term, "S1");
  const science = data.periods.find(row => row.course_number === "SCI-TEST")!;
  assert.equal(science.course_start, "2026-09-01");
  assert.equal(science.course_end, "2026-11-30");
  assert.equal(data.periods.find(row => row.term === "S2")!.course_start, "2027-01-05");
  assert.equal(data.periods.find(row => row.term === "S1")!.course_end, "2026-12-18");
  assert.deepEqual(placementsForDate(data, "2027-01-07").map(row => row.room), ["N-214"]);
  assert.equal(placementsForDate(data, "2026-10-21").some(row => row.period === "PRIME"), false);
});

test("only schedule fields leave the raw student response", () => {
  const data = buildCampusPeriods(campusRoster, campusDays, campusEvents, now);
  const exported = JSON.stringify(data);
  assert.doesNotMatch(exported, /personID|rosterID|structureID|periodScheduleID|comments|Not exported|987654/);
  const projected = parseCampusPeriods({ ...data, access_token: "SECRET", periods: data.periods.map(row => ({ ...row, personID: 999, teacher: "Private teacher" })) });
  assert.doesNotMatch(JSON.stringify(projected), /SECRET|access_token|personID|Private teacher/);
});

test("confirmed calendar schedules win over weekday assumptions and gaps do not create holidays", () => {
  const data = buildCampusPeriods(campusRoster, campusDays, campusEvents, now);
  assert.deepEqual(data.calendar?.no_school_days, ["2026-11-11"]);
  assert.equal(isNoClassDate(data.calendar, "2026-10-15"), false);
  assert.equal(isNoClassDate(data.calendar, "2026-11-11"), true);
  assert.equal(isNoClassDate(data.calendar, "2026-11-23"), false);
  data.calendar!.schedules_by_date!["2026-10-16"] = "R";
  assert.deepEqual(placementsForDate(data, "2026-10-16").map(row => row.period), ["1", "2"]);
  assert.deepEqual(visibleNumericPeriods("2026-10-16", data), [1, 2]);
  assert.equal(needsFridayStudyHall("2026-10-16", placementsForDate(data, "2026-10-16"), data), false);
  data.calendar!.schedules_by_date!["2026-10-15"] = "W";
  assert.equal(needsWednesdayPrime("2026-10-15", [], data), true);
  assert.equal(buildCampusPeriods(campusRoster, [], campusEvents, now).calendar, null);
});

test("calendar collection skips a different enrollment without scheduled placements", () => {
  const roster = [{ structureID: 999, sectionPlacements: [] }, { structureID: 888 }, ...campusRoster];
  assert.equal(campusStructure(roster), 42);
  const data = buildCampusPeriods(roster, campusDays, campusEvents, now);
  assert.deepEqual(data.calendar?.no_school_days, ["2026-11-11"]);
  assert.equal(data.calendar?.schedules_by_date?.["2026-10-15"], "R");
});

test("malformed, oversized and impossible payloads fail before replacing saved data", () => {
  const data = buildCampusPeriods(campusRoster, campusDays, campusEvents, now);
  assert.throws(() => parseCampusPeriods({ ...data, as_of: "2026-02-30" }));
  assert.throws(() => parseCampusPeriods({ ...data, periods: Array(10001).fill(data.periods[0]) }));
  assert.throws(() => parseCampusPeriods({ ...data, periods: [{ ...data.periods[0], room: { token: "SECRET" } }] }));
  assert.throws(() => parseSavedCampusImport({ version: 2, imported_at: now.toISOString(), data }));
  assert.throws(() => buildCampusPeriods({ roster: [] }));
  assert.throws(() => buildCampusPeriods([]));
  assert.equal(campusDate("2026-10-15T00:00:00"), "2026-10-15");
  assert.equal(campusDate("02/30/2026"), null);
});

test("the connector is restricted to the exact Campus host and approved app locations", () => {
  assert.equal(isAppUrl("https://xmccc-glitch.github.io/GunnMap/"), true);
  assert.equal(isAppUrl("http://127.0.0.1:8000/GunnMap/"), true);
  for (const url of ["https://evil.test/GunnMap/", "https://xmccc-glitch.github.io/other/", "https://xmccc-glitch.github.io/GunnMap-copy/", "https://xmccc-glitch.github.io.evil.test/GunnMap/", "http://localhost:9999/", "https://secret@xmccc-glitch.github.io/GunnMap/"]) {
    assert.equal(isAppUrl(url), false, url);
  }
  assert.equal(isCampusUrl("https://pausdca.infinitecampus.org/campus/portal/"), true);
  assert.equal(isCampusUrl("https://pausdca.infinitecampus.org.evil.test/"), false);
});
