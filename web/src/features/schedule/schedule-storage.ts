import scheduleDefaults from "./schedule-defaults.json" with { type: "json" };
import type { Period, ScheduleTemplate } from "./types.js";

export const PERIOD_COLORS = scheduleDefaults.periodColors;
export const EXAMPLE_SCHEDULE = scheduleDefaults.exampleSchedule;
export const DRAFT_COOKIE_NAME = "gunnmap_v2_schedule_draft";
export const CURRENT_SCHEDULE_KEY = "gunnmap_v2_current_schedule";
export const TEMPLATES_COOKIE_NAME = "gunnmap_v2_schedule_templates";
export const GENERATED_MAP_SESSION_KEY = "gunnmap_v2_generated_map";
const SHARED_PREVIEW_KEY = "gunnmap_v2_shared_preview";
const LEGACY_DRAFT_COOKIE_NAME = "gunnmap_schedule_draft";
const LEGACY_TEMPLATES_COOKIE_NAME = "gunnmap_schedule_templates";
export const SHARE_PARAM = "schedule";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// A restricted browser may reject session storage. Keep route changes within
// this SPA session from silently substituting the unrelated device draft.
let currentScheduleInMemory: Period[] | null = null;
let sharedPreviewInMemory: Period[] | null = null;
const copyPeriods = (periods: Period[]) => periods.map(period => ({ ...period }));
let pendingDraft: { periods: Period[]; onFailure(): void } | null = null;
let draftTimer: ReturnType<typeof setTimeout> | undefined;

function cancelPendingDraft() {
  clearTimeout(draftTimer);
  draftTimer = undefined;
  pendingDraft = null;
}

/** Keep the current draft synchronous in memory; coalesce cookie writes while typing. */
export function queueDraft(periods: Period[], onFailure: () => void) {
  clearTimeout(draftTimer);
  pendingDraft = { periods: copyPeriods(periods), onFailure };
  draftTimer = setTimeout(flushPendingDraft, 250);
}

export function flushPendingDraft(): boolean {
  if (!pendingDraft) return true;
  const draft = pendingDraft;
  const saved = saveDraft(draft.periods);
  if (!saved) draft.onFailure();
  return saved;
}

interface ScheduleDraft {
  version: 1;
  periods: Period[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defaultPeriods(): Period[] {
  return PERIOD_COLORS.map((color) => ({ building: "", room: "", color }));
}

export function isValidPeriods(value: unknown): value is Period[] {
  return Boolean(
    Array.isArray(value) &&
      value.length === 7 &&
      value.every((period) =>
        isRecord(period) &&
        typeof period.building === "string" &&
        typeof period.room === "string" &&
        typeof period.color === "string" &&
        HEX_COLOR.test(period.color),
      ),
  );
}

function getCookie(name: string) {
  const encodedName = encodeURIComponent(name);
  const entry = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${encodedName}=`));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(encodedName.length + 1));
  } catch {
    return null;
  }
}

function setCookie(name: string, value: string) {
  const cookieName = encodeURIComponent(name);
  const cookieValue = encodeURIComponent(value);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${cookieName}=${cookieValue}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax${secure}`;
  return getCookie(name) === value;
}

export function loadDraft(): Period[] | null {
  if (pendingDraft) return copyPeriods(pendingDraft.periods);
  try {
    const saved = getCookie(DRAFT_COOKIE_NAME) ?? getCookie(LEGACY_DRAFT_COOKIE_NAME);
    if (!saved) return null;
    const draft: unknown = JSON.parse(saved);
    if (!isRecord(draft) || draft.version !== 1 || !isValidPeriods(draft.periods)) {
      return null;
    }
    return draft.periods;
  } catch {
    return null;
  }
}

export function saveDraft(periods: Period[]) {
  cancelPendingDraft();
  try {
    return setCookie(DRAFT_COOKIE_NAME, JSON.stringify({ version: 1, periods }));
  } catch {
    return false;
  }
}

export function clearDraft() {
  cancelPendingDraft();
  try {
    // An explicit empty v2 draft prevents the legacy draft from reappearing.
    return setCookie(DRAFT_COOKIE_NAME, "null");
  } catch {
    return false;
  }
}

export function saveCurrentSchedule(periods: Period[]) {
  currentScheduleInMemory = copyPeriods(periods);
  try {
    sessionStorage.setItem(CURRENT_SCHEDULE_KEY, JSON.stringify({ version: 1, periods }));
  } catch {
    // Keep editing available when session storage is blocked.
  }
}

export function saveSharedPreview(periods: Period[] | null) {
  sharedPreviewInMemory = periods ? copyPeriods(periods) : null;
  try {
    if (periods) sessionStorage.setItem(SHARED_PREVIEW_KEY, JSON.stringify(periods));
    else sessionStorage.removeItem(SHARED_PREVIEW_KEY);
  } catch {
    // The in-memory fallback survives SPA route changes without using cookies.
  }
}

export function loadSharedPreview(): Period[] | null {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(SHARED_PREVIEW_KEY) ?? "null");
    return isValidPeriods(saved) ? saved : null;
  } catch { return sharedPreviewInMemory ? copyPeriods(sharedPreviewInMemory) : null; }
}

export function readCurrentSchedule(): Period[] {
  let saved: string | null = null;
  try {
    saved = sessionStorage.getItem(CURRENT_SCHEDULE_KEY);
  } catch {
    return currentScheduleInMemory ? copyPeriods(currentScheduleInMemory) : loadDraft() ?? [];
  }
  if (!saved) return loadDraft() ?? [];
  try {
    const value: unknown = JSON.parse(saved);
    return isRecord(value) && isValidPeriods(value.periods) ? value.periods : [];
  } catch {
    return [];
  }
}

export function loadTemplates(): ScheduleTemplate[] {
  try {
    const saved = getCookie(TEMPLATES_COOKIE_NAME) ?? getCookie(LEGACY_TEMPLATES_COOKIE_NAME);
    if (!saved) return [];
    const templates: unknown = JSON.parse(saved);
    if (!Array.isArray(templates)) return [];
    return templates.filter((template): template is ScheduleTemplate =>
      isRecord(template) &&
      typeof template.name === "string" &&
      template.name.trim().length > 0 &&
      isValidPeriods(template.periods),
    );
  } catch {
    return [];
  }
}

export function saveTemplates(templates: ScheduleTemplate[]) {
  try {
    return setCookie(TEMPLATES_COOKIE_NAME, JSON.stringify(templates.slice(0, 8)));
  } catch {
    return false;
  }
}

export function readSharedSchedule(): Period[] | null {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : "";
  const encoded = new URLSearchParams(hash).get(SHARE_PARAM);
  if (!encoded) return null;
  try {
    const value: unknown = JSON.parse(encoded);
    return isValidPeriods(value) ? value : null;
  } catch {
    return null;
  }
}

export function removeSharedSchedule() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  if (!hash.has(SHARE_PARAM)) return;
  hash.delete(SHARE_PARAM);
  const fragment = hash.toString();
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search + (fragment ? `#${fragment}` : ""),
  );
}
