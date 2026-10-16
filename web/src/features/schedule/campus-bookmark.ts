import { CAMPUS_ORIGIN, isAppUrl, isRecord, isRequestId, parseCampusPeriods } from "../../../../src/domain/campus-contract.js";
import { readLocalCampus, saveLocalCampus } from "./campus-local.js";

export const CAMPUS_BOOKMARK_EVENT = "gunnwatt-campus-bookmark";
let phase: "idle" | "reading" | "saved" | "error" = "idle";
let message = "";
let stop: (() => void) | null = null;
export function bookmarkImportState() { return { phase, message }; }
export function cancelBookmarkImport() { stop?.(); stop = null; phase = "idle"; message = ""; }

/** Only an explicitly opened return tab accepts a handoff from its own IC opener. */
export function startCampusBookmarkReceiver(): void {
  const url = new URL(location.href);
  const id = url.searchParams.get("campus-import");
  if (!id || !isRequestId(id) || !isAppUrl(url.href)) return;
  url.searchParams.delete("campus-import");
  history.replaceState(history.state, "", url.href);
  const source: Window | null = window.opener;
  if (!source) {
    phase = "error"; message = "The return tab lost its connection to Campus. Keep Campus open and try the import bookmark again.";
    return;
  }
  phase = "reading"; message = "Receiving your schedule from the Campus tab…";
  const forgottenAtStart = readLocalCampus().forgotten_at;
  const notify = () => window.dispatchEvent(new Event(CAMPUS_BOOKMARK_EVENT));
  const send = (kind: string) => source.postMessage({ channel: "gunnwatt-campus-bookmark-v1", kind, id }, CAMPUS_ORIGIN);
  const cleanup = () => { clearInterval(interval); clearTimeout(timer); window.removeEventListener("message", receive); stop = null; };
  stop = cleanup;
  const receive = (event: MessageEvent) => {
    const value: unknown = event.data;
    if (event.source !== source || event.origin !== CAMPUS_ORIGIN || !isRecord(value)
      || value.channel !== "gunnwatt-campus-bookmark-v1" || value.kind !== "result" || value.id !== id) return;
    cleanup();
    try {
      if (readLocalCampus().forgotten_at !== forgottenAtStart) {
        throw new Error("This import was forgotten in another tab. Start a new import to reconnect.");
      }
      if (typeof value.error === "string" && value.error.length <= 512) throw new Error(value.error);
      const data = parseCampusPeriods(value.data);
      if (!data.periods.length) throw new Error("No classes were found in this Campus import.");
      saveLocalCampus({ version: 1, imported_at: new Date().toISOString(), data });
      phase = "saved"; message = "Saved on this device. Update when your classes change.";
      send("accepted");
    } catch (error) {
      phase = "error"; message = error instanceof Error ? error.message : "Import could not be saved on this device.";
      send("rejected");
    }
    notify();
  };
  window.addEventListener("message", receive);
  const interval = setInterval(() => send("ready"), 400);
  const timer = setTimeout(() => {
    cleanup(); phase = "error"; message = "Import timed out. Keep both tabs open and try the bookmark again."; notify();
  }, 50000);
  send("ready");
}
