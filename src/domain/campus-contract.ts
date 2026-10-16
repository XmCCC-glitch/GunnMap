/** The only Campus data allowed across the extension/page boundary. */
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
  term_start?: string | null;
  term_end?: string | null;
}

export interface CampusCalendar {
  start_date: string;
  end_date: string;
  school_days: string[];
  no_school_days: string[];
  schedules_by_date?: Record<string, string>;
}

export interface CampusPeriods {
  term: string;
  as_of: string;
  terms: string[];
  schedules: string[];
  periods: CampusPlacement[];
  calendar?: CampusCalendar | null;
}

export interface SavedCampusImport {
  version: 1;
  imported_at: string;
  data: CampusPeriods;
}

export const CAMPUS_CHANNEL = "gunnwatt-campus-v1";
export const CAMPUS_CACHE_KEY = "gunnwatt_campus_import_v1";
export const MAX_CAMPUS_BYTES = 2 * 1024 * 1024;
export const CAMPUS_ORIGIN = "https://pausdca.infinitecampus.org";
export const CAMPUS_LOGIN_URL = `${CAMPUS_ORIGIN}/campus/portal/students/paloalto.jsp`;
export const DEFAULT_APP_URL = "https://xmccc-glitch.github.io/GunnMap/";
export type CampusCommand = "status" | "connect" | "cancel" | "forget";
export type CampusPhase = "idle" | "waiting" | "reading" | "saved" | "error";
export interface CampusConnectionState {
  phase: CampusPhase;
  message: string;
  saved: SavedCampusImport | null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isAppUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.origin === "https://xmccc-glitch.github.io") {
      return url.pathname === "/GunnMap" || url.pathname.startsWith("/GunnMap/");
    }
    return url.protocol === "http:" && url.port === "8000"
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch { return false; }
}

export function isCampusUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === CAMPUS_ORIGIN && !url.username && !url.password;
  } catch { return false; }
}

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(value);
}

export function isCampusCommand(value: unknown): value is CampusCommand {
  return value === "status" || value === "connect" || value === "cancel" || value === "forget";
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit) throw new Error("Invalid Campus text field.");
  return value.trim();
}

function optionalText(value: unknown, limit: number): string | null {
  return value == null ? null : text(value, limit) || null;
}

function dateOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (!validDate(value)) throw new Error("Invalid Campus date.");
  return value;
}

function strings(value: unknown, maximum: number, limit: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error("Invalid Campus list.");
  return [...new Set(value.map(item => text(item, limit)))];
}

function dates(value: unknown): string[] {
  const result = strings(value, 2000, 10);
  if (!result.every(validDate)) throw new Error("Invalid Campus calendar date.");
  return result.sort();
}

/** Validate and project rather than forwarding opaque API objects or identifiers. */
export function parseCampusPeriods(value: unknown): CampusPeriods {
  if (!isRecord(value) || !Array.isArray(value.periods) || value.periods.length > 10000
    || new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_CAMPUS_BYTES) {
    throw new Error("Invalid Campus schedule.");
  }
  if (!validDate(value.as_of)) throw new Error("Invalid Campus import date.");
  const periods = value.periods.map((item): CampusPlacement => {
    if (!isRecord(item)) throw new Error("Invalid Campus placement.");
    return {
      course: optionalText(item.course, 512), course_number: optionalText(item.course_number, 80),
      section: optionalText(item.section, 80), room: optionalText(item.room, 80),
      teacher: null,
      period: optionalText(item.period, 80), start_time: optionalText(item.start_time, 40),
      end_time: optionalText(item.end_time, 40), term: optionalText(item.term, 80),
      schedule_name: optionalText(item.schedule_name, 160),
      course_start: dateOrNull(item.course_start), course_end: dateOrNull(item.course_end),
      term_start: dateOrNull(item.term_start), term_end: dateOrNull(item.term_end),
    };
  });
  let calendar: CampusCalendar | null = null;
  if (value.calendar != null) {
    const item = value.calendar;
    if (!isRecord(item) || !validDate(item.start_date) || !validDate(item.end_date)
      || item.start_date > item.end_date) throw new Error("Invalid Campus calendar.");
    const schedules: Record<string, string> = {};
    if (item.schedules_by_date != null) {
      if (!isRecord(item.schedules_by_date) || Object.keys(item.schedules_by_date).length > 2000) {
        throw new Error("Invalid Campus calendar schedules.");
      }
      for (const [day, name] of Object.entries(item.schedules_by_date)) {
        if (!validDate(day)) throw new Error("Invalid Campus calendar schedule date.");
        schedules[day] = text(name, 160);
      }
    }
    const schoolDays = dates(item.school_days);
    calendar = {
      start_date: item.start_date, end_date: item.end_date,
      school_days: schoolDays,
      no_school_days: dates(item.no_school_days).filter(day => !schoolDays.includes(day)),
      schedules_by_date: schedules,
    };
  }
  return {
    term: text(value.term, 80), as_of: value.as_of,
    terms: strings(value.terms, 80, 80), schedules: strings(value.schedules, 1000, 160),
    periods, calendar,
  };
}

export function parseSavedCampusImport(value: unknown): SavedCampusImport {
  if (!isRecord(value) || value.version !== 1 || typeof value.imported_at !== "string"
    || value.imported_at.length > 40 || !Number.isFinite(Date.parse(value.imported_at))) {
    throw new Error("Invalid saved Campus import.");
  }
  return { version: 1, imported_at: value.imported_at, data: parseCampusPeriods(value.data) };
}
