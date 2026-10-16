import { CAMPUS_CHANNEL, isRecord, isRequestId } from "../../src/domain/campus-contract.js";
import { CampusLoginRequired, collectCampus } from "../../src/campus/collect.js";

let attemptedJob: string | null = null;

async function send(kind: string, jobId: string, data?: unknown): Promise<void> {
  const result: unknown = await chrome.runtime.sendMessage({ channel: CAMPUS_CHANNEL, kind, jobId,
    ...(data === undefined ? {} : { data }) });
  if (!isRecord(result) || result.ok !== true) throw new Error("Import cancelled.");
}

async function collect(jobId: string): Promise<void> {
  if (attemptedJob === jobId) return;
  attemptedJob = jobId;
  try {
    const data = await collectCampus(() => send("reading", jobId));
    await send("result", jobId, data);
  } catch (error) {
    await send(error instanceof CampusLoginRequired ? "login-required" : "failure", jobId).catch(() => undefined);
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
