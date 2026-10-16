import type { Period } from "./types.js";
import type { CampusCalendar, CampusPeriods, CampusPlacement } from "../../../../src/domain/campus-contract.js";
export type { CampusCalendar, CampusPeriods, CampusPlacement } from "../../../../src/domain/campus-contract.js";

export const CAMPUS_RESPONSIVE_URL = "https://pausdca.infinitecampus.org/campus/nav-wrapper/student/portal/student/responsive-schedule?appName=paloalto";

export function schoolDate(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
}

export function activeOn(row: CampusPlacement, date: string): boolean {
  return (!row.course_start || row.course_start.slice(0, 10) <= date)
    && (!row.course_end || row.course_end.slice(0, 10) >= date);
}

export function scheduleForDate(date: string, data?: CampusPeriods): string {
  const confirmed = data?.calendar?.schedules_by_date?.[date];
  if (confirmed) return confirmed;
  const weekday = new Date(`${date}T12:00:00`).getDay();
  return ["Full", "M", "T", "W", "R", "F", "Full"][weekday];
}

export function isNoClassDate(calendar: CampusCalendar | null | undefined, date: string): boolean {
  if (calendar?.school_days.includes(date)) return false;
  if (calendar?.no_school_days.includes(date)) return true;
  const weekday = new Date(`${date}T12:00:00`).getDay();
  return weekday === 0 || weekday === 6;
}

export function visibleNumericPeriods(date: string, data?: CampusPeriods): number[] {
  if (data?.calendar?.schedules_by_date?.[date]) {
    return [...new Set(placementsForDate(data, date).map(row => Number(row.period))
      .filter(number => Number.isInteger(number) && number >= 1 && number <= 7))].sort((a, b) => a - b);
  }
  const day = scheduleForDate(date);
  if (day === "T" || day === "R") return [1, 2, 3, 4];
  if (day === "W" || day === "F") return [5, 6, 7];
  return [1, 2, 3, 4, 5, 6, 7];
}

export function placementsForDate(data: CampusPeriods, date: string): CampusPlacement[] {
  const day = scheduleForDate(date, data);
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

export function needsFridayStudyHall(date: string, rows: CampusPlacement[], data?: CampusPeriods): boolean {
  return scheduleForDate(date, data) === "F" && !responsivePlacements(rows).some(row =>
    /^(?:SH\b|STUDY\s*HALL\b)/i.test(row.period?.trim() ?? ""));
}

export function needsWednesdayPrime(date: string, rows: CampusPlacement[], data?: CampusPeriods): boolean {
  return scheduleForDate(date, data) === "W" && !responsivePlacements(rows).some(row =>
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
