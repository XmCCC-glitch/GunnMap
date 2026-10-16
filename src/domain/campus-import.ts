import {
  isRecord, parseCampusPeriods, validDate,
  type CampusCalendar, type CampusPeriods, type CampusPlacement,
} from "./campus-contract.js";

function string(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null
    : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

export function campusDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000);
    return Number.isFinite(date.getTime())
      ? date.toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" }) : null;
  }
  if (typeof value !== "string") return null;
  const iso = value.slice(0, 10);
  if (validDate(iso)) return iso;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const converted = match ? `${match[3]}-${match[1]}-${match[2]}` : "";
  return validDate(converted) ? converted : null;
}

function bound(values: unknown[], latest: boolean): string | null {
  const dates = values.map(campusDate).filter((value): value is string => value !== null).sort();
  return (latest ? dates.at(-1) : dates[0]) ?? null;
}

export function schoolDate(now = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
}

function calendarFrom(
  instructionalDays: unknown, dayEvents: unknown, structure: number,
  scheduleNames: Map<string, string>,
): CampusCalendar | null {
  if (!Array.isArray(instructionalDays)) return null;
  const covered = new Set<string>();
  const school = new Set<string>();
  const noSchool = new Set<string>();
  const schedules: Record<string, string> = {};
  for (const item of instructionalDays) {
    if (!isRecord(item) || (item.structureID != null && item.structureID !== structure)) continue;
    const day = campusDate(item.date);
    if (!day) continue;
    covered.add(day);
    if (item.isSchoolDay === true) {
      school.add(day);
      const name = scheduleNames.get(String(item.periodScheduleID));
      if (name) schedules[day] = name;
    } else if (item.isSchoolDay === false) noSchool.add(day);
  }
  if (!school.size) return null;
  for (const enrollment of Array.isArray(dayEvents) ? dayEvents : []) {
    if (!isRecord(enrollment) || enrollment.structureID !== structure || !Array.isArray(enrollment.events)) continue;
    for (const item of enrollment.events) {
      if (!isRecord(item) || item.schoolDay !== false) continue;
      const day = campusDate(item.date);
      if (day) noSchool.add(day);
    }
  }
  const coverage = [...covered].sort();
  return {
    start_date: coverage[0], end_date: coverage.at(-1)!,
    school_days: [...school].sort(), no_school_days: [...noSchool].filter(day => !school.has(day)).sort(),
    schedules_by_date: schedules,
  };
}

/** All terms and bell schedules are imported once; date selection stays local. */
export function buildCampusPeriods(
  roster: unknown, instructionalDays: unknown = null, dayEvents: unknown = null, now = new Date(),
): CampusPeriods {
  if (!Array.isArray(roster) || roster.length > 2000) throw new Error("Campus returned an invalid roster.");
  const periods: CampusPlacement[] = [];
  const scheduleNames = new Map<string, string>();
  let structure: number | null = null;
  for (const entry of roster) {
    if (!isRecord(entry) || !Array.isArray(entry.sectionPlacements)) continue;
    if (structure === null && typeof entry.structureID === "number") structure = entry.structureID;
    if (entry.sectionPlacements.length > 2000) throw new Error("Campus returned too many placements.");
    for (const placement of entry.sectionPlacements) {
      if (!isRecord(placement)) continue;
      const term = isRecord(placement.term) ? placement.term : {};
      // A class meets only in the intersection of enrollment, placement and term dates.
      const start = bound([entry.startDate, placement.startDate, term.startDate], true);
      const end = bound([entry.endDate, placement.endDate, term.endDate], false);
      if (start && end && start > end) continue;
      const schedule = string(placement.periodScheduleName);
      if (schedule && placement.periodScheduleID != null && entry.structureID === structure) {
        scheduleNames.set(String(placement.periodScheduleID), schedule);
      }
      periods.push({
        course: string(entry.courseName) ?? string(placement.courseName),
        course_number: string(entry.courseNumber) ?? string(placement.courseNumber),
        section: string(entry.sectionNumber) ?? string(placement.sectionNumber),
        room: string(placement.roomName) ?? string(entry.roomName), teacher: null,
        period: string(placement.periodName), start_time: string(placement.startTime),
        end_time: string(placement.endTime), term: string(placement.termName) ?? string(term.termName),
        schedule_name: schedule, course_start: start, course_end: end,
        term_start: campusDate(term.startDate), term_end: campusDate(term.endDate),
      });
      if (periods.length > 10000) throw new Error("Campus returned too many placements.");
    }
  }
  if (!periods.length) throw new Error("No scheduled classes were found. Check that Campus Student is signed in.");
  const today = schoolDate(now);
  const currentTerms = [...new Set(periods.filter(row => row.term && row.term_start && row.term_end
    && row.term_start <= today && row.term_end >= today).map(row => row.term!))];
  return parseCampusPeriods({
    term: currentTerms.length === 1 ? currentTerms[0] : "School year", as_of: today,
    terms: [...new Set(periods.map(row => row.term).filter(Boolean))],
    schedules: [...new Set(periods.map(row => row.schedule_name).filter(Boolean))], periods,
    calendar: structure === null ? null : calendarFrom(instructionalDays, dayEvents, structure, scheduleNames),
  });
}
