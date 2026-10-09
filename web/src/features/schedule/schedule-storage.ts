import scheduleDefaults from "./schedule-defaults.json" with { type: "json" };
import type { Period, ScheduleTemplate } from "./types.js";

export const PERIOD_COLORS = scheduleDefaults.periodColors;
export const EXAMPLE_SCHEDULE = scheduleDefaults.exampleSchedule;
export const DRAFT_COOKIE_NAME = "gunnmap_v2_schedule_draft";
export const CURRENT_SCHEDULE_KEY = "gunnmap_v2_current_schedule";
export const TEMPLATES_COOKIE_NAME = "gunnmap_v2_schedule_templates";
export const GENERATED_MAP_SESSION_KEY = "gunnmap_v2_generated_map";
export const TEMPLATES_INDEX_COOKIE_NAME = "gunnmap_v2_schedule_templates_index";
const TEMPLATE_COOKIE_PREFIX = "gunnmap_v2_schedule_template_";
const MAX_COOKIE_BYTES = 4096;
// Leave room for other request headers below the server's default header limit.
const MAX_COOKIE_HEADER_BYTES = 12 * 1024;
const REVIEW_PREVIEW_KEY = "gunnmap_v2_review_preview";
let reviewPreviewInMemory: Period[] | null = null;
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
        HEX_COLOR.test(period.color) &&
        (period.roomId === undefined || typeof period.roomId === "string") &&
        (period.mapRevision === undefined || typeof period.mapRevision === "string"),
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

function cookieText(name: string, value: string) {
  const cookieName = encodeURIComponent(name);
  const cookieValue = encodeURIComponent(value);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=${cookieValue}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax${secure}`;
}

function setCookie(name: string, value: string) {
  const serialized = cookieText(name, value);
  if (serialized.length > MAX_COOKIE_BYTES) return false;
  if (!fitsCookieHeader([{ name, value }], new Set([name]))) return false;
  document.cookie = serialized;
  return getCookie(name) === value;
}

function fitsCookieHeader(entries: { name: string; value: string }[], removedNames: ReadonlySet<string>) {
  const retained = document.cookie.split("; ").filter(entry => entry && !removedNames.has(entry.slice(0, entry.indexOf("="))));
  const projected = [...retained, ...entries.map(({ name, value }) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)].join("; ");
  return new TextEncoder().encode(projected).byteLength <= MAX_COOKIE_HEADER_BYTES;
}

function removeCookie(name: string) {
  document.cookie = `${encodeURIComponent(name)}=; max-age=0; path=/; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
}

export function loadDraft(): Period[] | null {
  if (pendingDraft) return copyPeriods(pendingDraft.periods);
  try {
    const saved = getCookie(DRAFT_COOKIE_NAME) ?? getCookie(LEGACY_DRAFT_COOKIE_NAME);
    if (!saved) return null;
    return parseSchedule(JSON.parse(saved));
  } catch {
    return null;
  }
}

export function saveDraft(periods: Period[]) {
  cancelPendingDraft();
  try {
    // Keep the draft envelope readable by the prior app when rolling back.
    return setCookie(DRAFT_COOKIE_NAME, serializeSchedule(periods, 1));
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
    sessionStorage.setItem(CURRENT_SCHEDULE_KEY, serializeSchedule(periods));
  } catch {
    // Keep editing available when session storage is blocked.
  }
}

export function saveSharedPreview(periods: Period[] | null) {
  sharedPreviewInMemory = periods ? copyPeriods(periods) : null;
  try {
    if (periods) sessionStorage.setItem(SHARED_PREVIEW_KEY, serializeSchedule(periods));
    else sessionStorage.removeItem(SHARED_PREVIEW_KEY);
  } catch {
    // The in-memory fallback survives SPA route changes without using cookies.
  }
}

export function loadSharedPreview(): Period[] | null {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(SHARED_PREVIEW_KEY) ?? "null");
    return parseSchedule(saved);
  } catch { return sharedPreviewInMemory ? copyPeriods(sharedPreviewInMemory) : null; }
}

/** Keep unconfirmed edits separate from the last explicitly accepted device draft. */
export function saveReviewPreview(periods: Period[] | null) {
  reviewPreviewInMemory = periods ? copyPeriods(periods) : null;
  try {
    if (periods) sessionStorage.setItem(REVIEW_PREVIEW_KEY, serializeSchedule(periods));
    else sessionStorage.removeItem(REVIEW_PREVIEW_KEY);
  } catch { /* Preserve the review within this SPA session. */ }
}

export function loadReviewPreview(): Period[] | null {
  try { return parseSchedule(JSON.parse(sessionStorage.getItem(REVIEW_PREVIEW_KEY) ?? "null")); }
  catch { return reviewPreviewInMemory ? copyPeriods(reviewPreviewInMemory) : null; }
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
    return parseSchedule(value) ?? [];
  } catch {
    return [];
  }
}

interface TemplateIndex { version: 2; entries: string[] }

function readTemplateIndex(): TemplateIndex | null {
  const value: unknown = JSON.parse(getCookie(TEMPLATES_INDEX_COOKIE_NAME) ?? "null");
  return isRecord(value) && value.version === 2 && Array.isArray(value.entries) && value.entries.length <= 8 &&
    value.entries.every(entry => typeof entry === "string" && /^[a-z0-9-]{1,64}_[0-7]$/i.test(entry))
    ? value as unknown as TemplateIndex : null;
}

function validTemplate(value: unknown): value is ScheduleTemplate {
  return isRecord(value) && typeof value.name === "string" && value.name.trim().length > 0 &&
    value.name.length <= 60 && isValidPeriods(value.periods);
}

function parseTemplate(value: unknown): ScheduleTemplate | null {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 60) return null;
  const periods = parseSchedule(value);
  return periods ? { name: value.name, periods } : null;
}

export function loadTemplates(): ScheduleTemplate[] {
  try {
    const index = readTemplateIndex();
    if (index) {
      const templates: ScheduleTemplate[] = [];
      for (const entry of index.entries) {
        const template = parseTemplate(JSON.parse(getCookie(`${TEMPLATE_COOKIE_PREFIX}${entry}`) ?? "null"));
        if (!template) return []; // Never silently substitute an older list after a partial browser eviction.
        templates.push(template);
      }
      return templates;
    }
    // Both earlier formats remain untouched until an explicit successful save.
    const saved = getCookie(TEMPLATES_COOKIE_NAME) ?? getCookie(LEGACY_TEMPLATES_COOKIE_NAME);
    if (!saved) return [];
    const templates: unknown = JSON.parse(saved);
    return Array.isArray(templates) ? templates.filter(validTemplate).slice(0, 8) : [];
  } catch { return []; }
}

let templateSaveFailure: "capacity" | "unavailable" | null = null;
export function templateSaveError() { return templateSaveFailure; }

/** Serialize cookie transactions across tabs before reading, staging, publishing, and cleanup. */
export async function saveTemplates(templates: ScheduleTemplate[]): Promise<boolean> {
  try {
    const copy = templates.map(template => ({ ...template, periods: copyPeriods(template.periods) }));
    if (navigator.locks?.request) {
      return await navigator.locks.request("gunnmap-v2-template-storage", () => saveTemplatesTransaction(copy, true));
    }
    // Without cross-tab locks, immutable entries remain available to concurrent publishers.
    // The aggregate byte budget bounds retained copies; refusing a save preserves the last list.
    return saveTemplatesTransaction(copy, false);
  } catch {
    templateSaveFailure = "unavailable";
    return false;
  }
}

/** Stage changed cookies, then publish one small index; a rejected save retains the prior list. */
function saveTemplatesTransaction(templates: ScheduleTemplate[], cleanupAllowed: boolean) {
  templateSaveFailure = null;
  const staged: string[] = [];
  let committed = false;
  let publicationAttempted = false;
  let previousIndexValue: string | null = null;
  let nextIndexValue = "";
  try {
    if (templates.length > 8 || !templates.every(validTemplate)) {
      templateSaveFailure = "capacity";
      return false;
    }
    const generation = typeof crypto.randomUUID === "function" ? crypto.randomUUID()
      : [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    previousIndexValue = getCookie(TEMPLATES_INDEX_COOKIE_NAME);
    const previous = readTemplateIndex()?.entries ?? [];
    const entries = templates.map((template, slot) => {
      const value = JSON.stringify({ name: template.name, ...scheduleEnvelope(template.periods) });
      const reusable = previous.find(entry => getCookie(`${TEMPLATE_COOKIE_PREFIX}${entry}`) === value);
      const key = reusable ?? `${generation}_${slot}`;
      return { key, name: `${TEMPLATE_COOKIE_PREFIX}${key}`, value, changed: !reusable };
    });
    const indexValue = JSON.stringify({ version: 2, entries: entries.map(entry => entry.key) });
    nextIndexValue = indexValue;
    const newCookies = entries.filter(entry => entry.changed);
    // Check both final and temporary staging headers; saving must never break navigation.
    const oldTemplateNames = new Set(document.cookie.split("; ").map(value => value.slice(0, value.indexOf("=")))
      .filter(name => name.startsWith(TEMPLATE_COOKIE_PREFIX)));
    oldTemplateNames.add(TEMPLATES_INDEX_COOKIE_NAME);
    if (entries.some(entry => cookieText(entry.name, entry.value).length > MAX_COOKIE_BYTES) ||
      !fitsCookieHeader([...entries, { name: TEMPLATES_INDEX_COOKIE_NAME, value: indexValue }], oldTemplateNames) ||
      !fitsCookieHeader([...newCookies, { name: TEMPLATES_INDEX_COOKIE_NAME, value: indexValue }], new Set([TEMPLATES_INDEX_COOKIE_NAME]))) {
      templateSaveFailure = "capacity";
      return false;
    }
    for (const entry of newCookies) {
      staged.push(entry.name);
      if (!setCookie(entry.name, entry.value)) throw new Error("Template cookie rejected");
    }
    publicationAttempted = true;
    if (!setCookie(TEMPLATES_INDEX_COOKIE_NAME, indexValue)) throw new Error("Template index rejected");
    committed = true;
    if (!cleanupAllowed) return true;
    const retainedNames = new Set(entries.map(entry => entry.name));
    // The committed generation is now complete. Remove only our older staged cookies.
    for (const entry of document.cookie.split("; ")) {
      try {
        const name = decodeURIComponent(entry.slice(0, entry.indexOf("=")));
        if (name.startsWith(TEMPLATE_COOKIE_PREFIX) && !retainedNames.has(name)) removeCookie(name);
      } catch { /* Unrelated malformed cookies and cleanup failures cannot undo a committed save. */ }
    }
    return true;
  } catch {
    // Publication is irreversible: a later cleanup/read failure must never delete committed entries.
    if (committed) return true;
    if (publicationAttempted) {
      // Cookie assignment may succeed before its verification read throws. Recover only
      // a known outcome; retaining staged entries is safer than an index pointing at deleted data.
      try {
        const currentIndex = getCookie(TEMPLATES_INDEX_COOKIE_NAME);
        if (currentIndex === nextIndexValue) return true;
        if (!cleanupAllowed || currentIndex !== previousIndexValue) {
          templateSaveFailure = "unavailable";
          return false;
        }
      } catch {
        templateSaveFailure = "unavailable";
        return false;
      }
    }
    templateSaveFailure = "unavailable";
    for (const name of staged) { try { removeCookie(name); } catch { /* Retain the previous index. */ } }
    return false;
  }
}

function parseSchedule(value: unknown): Period[] | null {
  if (isValidPeriods(value)) return value; // Legacy share and session preview.
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || !isValidPeriods(value.periods)) return null;
  const ids = value.roomIds;
  const revisions = value.mapRevisions;
  const metadataArray = (items: unknown) => Array.isArray(items) && items.length === 7 &&
    items.every(item => item === null || typeof item === "string");
  if (ids !== undefined && !metadataArray(ids)) return null;
  if (revisions !== undefined && !metadataArray(revisions)) return null;
  if (value.mapRevision !== undefined && typeof value.mapRevision !== "string") return null;
  return value.periods.map((period, index) => ({
    ...period,
    ...(Array.isArray(ids) && typeof ids[index] === "string" ? { roomId: ids[index] as string } : {}),
    ...(Array.isArray(revisions) && typeof revisions[index] === "string" ? { mapRevision: revisions[index] as string }
      : typeof value.mapRevision === "string" && period.room.trim() ? { mapRevision: value.mapRevision } : {}),
  }));
}

/** Compact repeated map revisions to keep eight full templates below HTTP cookie limits. */
function scheduleEnvelope(periods: Period[], version: 1 | 2 = 2) {
  const revisions = [...new Set(periods.filter(period => period.room.trim()).map(period => period.mapRevision))];
  const fields = periods.map(({ roomId: _id, mapRevision: _revision, ...period }) => period);
  return { version, periods: fields,
    ...(periods.some(period => period.roomId) ? { roomIds: periods.map(period => period.roomId ?? null) } : {}),
    ...(revisions.length === 1 && revisions[0] && periods.every(period => period.room.trim() || period.mapRevision === undefined) ? { mapRevision: revisions[0] }
      : periods.some(period => period.mapRevision) ? { mapRevisions: periods.map(period => period.mapRevision ?? null) } : {}),
  };
}

export function serializeSchedule(periods: Period[], version: 1 | 2 = 2) {
  return JSON.stringify(scheduleEnvelope(periods, version));
}

export function readSharedSchedule(): Period[] | null {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : "";
  const encoded = new URLSearchParams(hash).get(SHARE_PARAM);
  if (!encoded) return null;
  try {
    const value: unknown = JSON.parse(encoded);
    return parseSchedule(value);
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
