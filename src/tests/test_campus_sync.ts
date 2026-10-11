import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAMPUS_SYNC_URL, isNoClassDate, loadSavedCampusPeriods, mapFromCampus, needsFridayStudyHall, needsWednesdayPrime,
  parseCampusPeriods, placementsForDate, responsiveColor, responsivePlacements, saveCampusPeriods, scheduleForDate,
  syncCampusWithClassLink, visibleNumericPeriods,
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

test("Campus calendar hides weekends and non-school weekdays without guessing outside coverage", () => {
  const calendar = {
    start_date: "2026-08-13", end_date: "2027-06-03",
    school_days: ["2026-10-09", "2026-10-12", "2026-11-12"],
    no_school_days: ["2026-11-11"],
  };
  assert.equal(isNoClassDate(calendar, "2026-10-10"), true);
  assert.equal(isNoClassDate(calendar, "2026-10-12"), false);
  assert.equal(isNoClassDate(calendar, "2026-11-11"), true);
  assert.equal(isNoClassDate(calendar, "2026-11-23"), true);
  assert.equal(isNoClassDate(calendar, "2027-07-05"), false);
  assert.equal(isNoClassDate(null, "2026-11-11"), false);
  assert.equal(isNoClassDate(null, "2026-10-10"), true);
});

test("period JSON imports only the connector's schedule shape", () => {
  const valid = {
    term: "S1", as_of: "2026-10-11", terms: ["S1"], schedules: ["W"],
    periods: [row("6", "J-10")],
  };
  assert.deepEqual(parseCampusPeriods(valid), valid);
  assert.throws(() => parseCampusPeriods({ ...valid, periods: [{ ...row("6", "J-10"), room: 123 }] }), /valid Infinite Campus/);
  assert.throws(() => parseCampusPeriods({ ...valid, calendar: { school_days: "tomorrow" } }), /valid Infinite Campus/);
});

test("ClassLink sync posts credentials once and validates the returned period JSON", async t => {
  const valid = { term: "S1", as_of: "2026-10-11", terms: ["S1"], schedules: ["W"], periods: [row("6", "J-10")] };
  const calls: [string, RequestInit | undefined][] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return new Response(JSON.stringify(valid), { status: 200 });
  });
  assert.deepEqual(await syncCampusWithClassLink("950123", "secret"), valid);
  assert.equal(calls[0][0], `${CAMPUS_SYNC_URL}/api/sync`);
  assert.equal(calls[0][1]?.method, "POST");
  assert.equal(calls[0][1]?.credentials, "omit");
  assert.deepEqual(JSON.parse(String(calls[0][1]?.body)), { username: "950123", password: "secret" });
});

test("ClassLink sync reports server errors and unreachable servers", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: "ClassLink sign-in did not finish." }), { status: 401 }));
  await assert.rejects(syncCampusWithClassLink("950123", "wrong"), /ClassLink sign-in did not finish/);
  fetchMock.mock.mockImplementation(async () => new Response("<html>", { status: 502 }));
  await assert.rejects(syncCampusWithClassLink("950123", "x"), /HTTP 502/);
  fetchMock.mock.mockImplementation(async () => { throw new TypeError("Load failed"); });
  await assert.rejects(syncCampusWithClassLink("950123", "x"), /unreachable/);
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ periods: "none" }), { status: 200 }));
  await assert.rejects(syncCampusWithClassLink("950123", "x"), /valid Infinite Campus/);
});

test("saved Campus periods round-trip, ignore corrupt data, and can be forgotten", () => {
  const store = new Map<string, string>();
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  } };
  try {
    const valid = { term: "S1", as_of: "2026-10-11", terms: ["S1"], schedules: ["W"], periods: [row("6", "J-10")] };
    assert.equal(loadSavedCampusPeriods(), null);
    assert.equal(saveCampusPeriods(valid), true);
    assert.deepEqual(loadSavedCampusPeriods(), valid);
    assert.ok(![...store.values()].some(value => value.includes("password")));
    store.set("gunnmap.campus-periods.v1", "{not json");
    assert.equal(loadSavedCampusPeriods(), null);
    assert.equal(saveCampusPeriods(null), true);
    assert.equal(store.size, 0);
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
});

test("Campus storage failures are reported for saves and forgetting", () => {
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { localStorage: {
    setItem: () => { throw new Error("Storage full"); },
    removeItem: () => { throw new Error("Storage unavailable"); },
  } };
  try {
    const valid = { term: "S1", as_of: "2026-10-11", terms: ["S1"], schedules: ["W"], periods: [row("6", "J-10")] };
    assert.equal(saveCampusPeriods(valid), false);
    assert.equal(saveCampusPeriods(null), false);
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
});
