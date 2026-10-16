import { CAMPUS_CHANNEL, isRecord, isRequestId } from "../../src/domain/campus-contract.js";
import { buildCampusPeriods } from "../../src/domain/campus-import.js";

const ROSTER = "/campus/resources/portal/roster";
const INSTRUCTIONAL = "/campus/resources/calendar/instructionalDay";
const EVENTS = "/campus/resources/portal/dayEvent/byEnrollment";
let attemptedJob: string | null = null;

async function json(path: string): Promise<{ status: number; data: unknown }> {
  const response = await fetch(path, {
    credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return { status: response.status, data: null };
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("Campus did not return JSON.");
  }
  const body = await response.text();
  if (body.length > 8 * 1024 * 1024) throw new Error("Campus response is too large.");
  return { status: response.status, data: JSON.parse(body) as unknown };
}

async function send(kind: string, jobId: string, data?: unknown): Promise<void> {
  await chrome.runtime.sendMessage({ channel: CAMPUS_CHANNEL, kind, jobId, ...(data === undefined ? {} : { data }) });
}

async function collect(jobId: string): Promise<void> {
  if (attemptedJob === jobId) return;
  attemptedJob = jobId;
  try {
    const roster = await json(ROSTER);
    if (roster.status === 401 || roster.status === 403) {
      await send("login-required", jobId);
      return;
    }
    if (roster.status !== 200 || !Array.isArray(roster.data)) throw new Error("Roster unavailable.");
    await send("reading", jobId);
    const structure = roster.data.find(row => isRecord(row) && typeof row.structureID === "number")?.structureID;
    let days: unknown = null;
    let events: unknown = null;
    if (typeof structure === "number" && Number.isSafeInteger(structure)) {
      const results = await Promise.allSettled([
        json(`${INSTRUCTIONAL}?structureID=${encodeURIComponent(String(structure))}`), json(EVENTS),
      ]);
      if (results[0].status === "fulfilled" && results[0].value.status === 200) days = results[0].value.data;
      if (results[1].status === "fulfilled" && results[1].value.status === 200) events = results[1].value.data;
    }
    await send("result", jobId, buildCampusPeriods(roster.data, days, events));
  } catch {
    await send("failure", jobId).catch(() => undefined);
  }
}

if (window.top === window) {
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !isRecord(message) || message.channel !== CAMPUS_CHANNEL
      || message.kind !== "collect" || !isRequestId(message.jobId)) return;
    void collect(message.jobId);
    respond({ ok: true });
  });
  void chrome.runtime.sendMessage({ channel: CAMPUS_CHANNEL, kind: "ready" }).catch(() => undefined);
}
