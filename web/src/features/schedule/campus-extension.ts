import {
  CAMPUS_CHANNEL, isRecord, parseSavedCampusImport,
  type CampusCommand, type CampusConnectionState, type CampusPhase,
} from "../../../../src/domain/campus-contract.js";

export class CampusExtensionUnavailable extends Error {
  constructor() { super("Install and enable the Campus connector, then reload this page."); }
}

function parseState(value: unknown): CampusConnectionState {
  const phases: CampusPhase[] = ["idle", "waiting", "reading", "saved", "error"];
  if (!isRecord(value) || !phases.includes(value.phase as CampusPhase)
    || typeof value.message !== "string" || value.message.length > 512) {
    throw new Error("The Campus connector returned an invalid response.");
  }
  return {
    phase: value.phase as CampusPhase, message: value.message,
    saved: value.saved === null ? null : parseSavedCampusImport(value.saved),
  };
}

/** Only extension messages are used; no localhost or remote sync requests. */
export function campusExtensionRequest(command: CampusCommand, signal?: AbortSignal): Promise<CampusConnectionState> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const origin = window.location.origin;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => { cleanup(); reject(new DOMException("Request cancelled", "AbortError")); };
    const receive = (event: MessageEvent) => {
      const message: unknown = event.data;
      if (event.source !== window || event.origin !== origin || !isRecord(message)
        || message.channel !== CAMPUS_CHANNEL || message.source !== "extension"
        || message.kind !== "response" || message.requestId !== requestId) return;
      cleanup();
      const result = message.response;
      try {
        if (!isRecord(result) || result.ok !== true) throw new Error(isRecord(result)
          && typeof result.error === "string" && result.error.length <= 512 ? result.error : "Campus connection failed.");
        resolve(parseState(result.state));
      } catch (error) { reject(error); }
    };
    if (signal?.aborted) { reject(new DOMException("Request cancelled", "AbortError")); return; }
    window.addEventListener("message", receive);
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new CampusExtensionUnavailable()); }, command === "status" ? 1800 : 6000);
    window.postMessage({ channel: CAMPUS_CHANNEL, source: "page", kind: "request", requestId, command }, origin);
  });
}

export function onCampusExtensionChange(callback: () => void): () => void {
  const receive = (event: MessageEvent) => {
    const message: unknown = event.data;
    if (event.source === window && event.origin === window.location.origin && isRecord(message)
      && message.channel === CAMPUS_CHANNEL && message.source === "extension" && message.kind === "changed") callback();
  };
  window.addEventListener("message", receive);
  return () => window.removeEventListener("message", receive);
}
