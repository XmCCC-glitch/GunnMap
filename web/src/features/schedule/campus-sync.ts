import type { Period } from "./types.js";

export const CAMPUS_BRIDGE = "http://127.0.0.1:8765";
export const CAMPUS_RESPONSIVE_URL = "https://pausdca.infinitecampus.org/campus/nav-wrapper/student/portal/student/responsive-schedule?appName=paloalto";

export interface CampusPlacement {
  course: string | null;
  course_number: string | null;
  section: string | null;
  room: string | null;
  teacher: string | null;
  period: string | null;
  start_time: string | null;
  end_time: string | null;
  term: string | null;
  schedule_name: string | null;
  course_start: string | null;
  course_end: string | null;
}

export interface CampusPeriods {
  term: string;
  as_of: string;
  terms: string[];
  schedules: string[];
  periods: CampusPlacement[];
  calendar?: CampusCalendar | null;
}

export interface CampusCalendar {
  start_date: string;
  end_date: string;
  school_days: string[];
  no_school_days: string[];
}

export async function fetchCampusPeriods(): Promise<CampusPeriods> {
  const response = await fetch(`${CAMPUS_BRIDGE}/api/periods`, {
    mode: "cors", credentials: "omit", cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status === 401
    ? "Sign in through the local Infinite Campus connector."
    : `Connector returned HTTP ${response.status}.`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !Array.isArray((value as CampusPeriods).periods)) {
    throw new Error("The connector returned an invalid period JSON response.");
  }
  return value as CampusPeriods;
}

export function schoolDate(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
}

export function activeOn(row: CampusPlacement, date: string): boolean {
  return (!row.course_start || row.course_start.slice(0, 10) <= date)
    && (!row.course_end || row.course_end.slice(0, 10) >= date);
}

export function scheduleForDate(date: string): string {
  const weekday = new Date(`${date}T12:00:00`).getDay();
  return ["Full", "M", "T", "W", "R", "F", "Full"][weekday];
}

export function isNoClassDate(calendar: CampusCalendar | null | undefined, date: string): boolean {
  const weekday = new Date(`${date}T12:00:00`).getDay();
  if (weekday === 0 || weekday === 6) return true;
  if (!calendar) return false;
  if (calendar.school_days.includes(date)) return false;
  return calendar.no_school_days.includes(date)
    || (calendar.start_date <= date && date <= calendar.end_date);
}

export function visibleNumericPeriods(date: string): number[] {
  const day = scheduleForDate(date);
  if (day === "T" || day === "R") return [1, 2, 3, 4];
  if (day === "W" || day === "F") return [5, 6, 7];
  return [1, 2, 3, 4, 5, 6, 7];
}

export function placementsForDate(data: CampusPeriods, date: string): CampusPlacement[] {
  const day = scheduleForDate(date);
  const rows = data.periods.filter(row => row.schedule_name === day && activeOn(row, date));
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = [row.course_number, row.section, row.period, row.room].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function numericCandidates(rows: CampusPlacement[], number: number): CampusPlacement[] {
  return rows.filter(row => row.period?.trim() === String(number));
}

export function responsivePlacements(rows: CampusPlacement[]): CampusPlacement[] {
  return rows.filter(row => /^(?:PRIME\b|SELF\b|SH\b|STUDY\s*HALL\b)/i.test(row.period?.trim() ?? ""));
}

export function needsFridayStudyHall(date: string, rows: CampusPlacement[]): boolean {
  return scheduleForDate(date) === "F" && !responsivePlacements(rows).some(row =>
    /^(?:SH\b|STUDY\s*HALL\b)/i.test(row.period?.trim() ?? ""));
}

export function needsWednesdayPrime(date: string, rows: CampusPlacement[]): boolean {
  return scheduleForDate(date) === "W" && !responsivePlacements(rows).some(row =>
    /^PRIME\b/i.test(row.period?.trim() ?? ""));
}

export function responsiveColor(period: string | null): string {
  if (/^PRIME\b/i.test(period ?? "")) return "#f59e0b";
  if (/^SELF\b/i.test(period ?? "")) return "#06b6d4";
  return "#8b5cf6";
}

export function mapFromCampus(existing: Period[], rows: CampusPlacement[]): Period[] {
  return existing.map((period, index) => {
    const candidates = numericCandidates(rows, index + 1);
    if (candidates.length === 0) return { ...period, room: "", building: "" };
    const room = candidates.length === 1 ? candidates[0].room?.trim() ?? "" :
      candidates.find(row => row.room?.trim() === period.room.trim())?.room?.trim() ?? "";
    return { ...period, room, building: room === period.room ? period.building : "" };
  });
}
