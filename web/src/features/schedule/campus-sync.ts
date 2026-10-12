import type { Period } from "./types.js";

export const CAMPUS_BRIDGE = "http://127.0.0.1:8765";
/** Test-phase backend that signs in to ClassLink for the Pages site. */
export const CAMPUS_SYNC_URL: string = import.meta.env?.VITE_CAMPUS_SYNC_URL
  || "https://gunnmap-sync.tail5ba45a.ts.net";
const SAVED_PERIODS_KEY = "gunnmap.campus-periods.v1";
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
  return parseCampusPeriods(await response.json());
}

/** Sign in through the sync backend; the password is sent once and never stored here. */
export async function syncCampusWithClassLink(username: string, password: string,
  signal?: AbortSignal): Promise<CampusPeriods> {
  let response: Response;
  try {
    response = await fetch(`${CAMPUS_SYNC_URL}/api/sync`, {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Campus sync server is unreachable.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error : `Sync server returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return parseCampusPeriods(body);
}

export function loadSavedCampusPeriods(): CampusPeriods | null {
  try {
    const saved = window.localStorage.getItem(SAVED_PERIODS_KEY);
    return saved ? parseCampusPeriods(JSON.parse(saved) as unknown) : null;
  } catch {
    return null;
  }
}

export function saveCampusPeriods(data: CampusPeriods | null): boolean {
  try {
    if (data) window.localStorage.setItem(SAVED_PERIODS_KEY, JSON.stringify(data));
    else window.localStorage.removeItem(SAVED_PERIODS_KEY);
    return true;
  } catch {
    return false;
  }
}

export function parseCampusPeriods(value: unknown): CampusPeriods {
  const invalid = () => new Error("This is not a valid Infinite Campus period JSON file.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  if (typeof data.term !== "string" || typeof data.as_of !== "string"
    || !Array.isArray(data.terms) || !data.terms.every(term => typeof term === "string")
    || !Array.isArray(data.schedules) || !data.schedules.every(day => typeof day === "string")
    || !Array.isArray(data.periods)) throw invalid();
  const fields = ["course", "course_number", "section", "room", "teacher", "period",
    "start_time", "end_time", "term", "schedule_name", "course_start", "course_end"];
  if (!data.periods.every(row => row && typeof row === "object" && !Array.isArray(row)
    && fields.every(field => (row as Record<string, unknown>)[field] === null
      || typeof (row as Record<string, unknown>)[field] === "string"))) throw invalid();
  if (data.calendar !== undefined && data.calendar !== null) {
    const calendar = data.calendar as Record<string, unknown>;
    if (typeof calendar !== "object" || Array.isArray(calendar)
      || typeof calendar.start_date !== "string" || typeof calendar.end_date !== "string"
      || !Array.isArray(calendar.school_days) || !calendar.school_days.every(day => typeof day === "string")
      || !Array.isArray(calendar.no_school_days) || !calendar.no_school_days.every(day => typeof day === "string")) throw invalid();
  }
  return data as unknown as CampusPeriods;
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
