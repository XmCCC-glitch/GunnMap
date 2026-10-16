import { CAMPUS_ORIGIN, isRecord } from "../domain/campus-contract.js";
import { buildCampusPeriods, campusStructure } from "../domain/campus-import.js";

export class CampusLoginRequired extends Error {}

async function json(path: string): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) throw new CampusLoginRequired();
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("Campus did not return JSON.");
  }
  const body = await response.text();
  if (body.length > 8 * 1024 * 1024) throw new Error("Campus response is too large.");
  return JSON.parse(body) as unknown;
}

/** Runs inside the official portal. No credentials or raw responses leave this module. */
export async function collectCampus(onReading: () => Promise<void> | void = () => {}) {
  if (location.origin !== CAMPUS_ORIGIN) throw new Error("Open the official Campus Student portal first.");
  const roster = await json("/campus/resources/portal/roster");
  if (!Array.isArray(roster) || !roster.every(isRecord)) throw new Error("Roster unavailable.");
  await onReading();
  const structure = campusStructure(roster);
  let days: unknown = null;
  let events: unknown = null;
  if (structure !== null) {
    const results = await Promise.allSettled([
      json(`/campus/resources/calendar/instructionalDay?structureID=${encodeURIComponent(String(structure))}`),
      json("/campus/resources/portal/dayEvent/byEnrollment"),
    ]);
    if (results[0].status === "fulfilled") days = results[0].value;
    if (results[1].status === "fulfilled") events = results[1].value;
  }
  return buildCampusPeriods(roster, days, events);
}
