import {
  CAMPUS_CHANNEL, isRecord, parseSavedCampusImport,
  type CampusConnectionState, type SavedCampusImport,
} from "../../src/domain/campus-contract.js";

const status = document.querySelector<HTMLElement>("#status")!;
const details = document.querySelector<HTMLElement>("#details")!;
const connect = document.querySelector<HTMLButtonElement>("#connect")!;
const cancel = document.querySelector<HTMLButtonElement>("#cancel")!;
const download = document.querySelector<HTMLButtonElement>("#download")!;
const forget = document.querySelector<HTMLButtonElement>("#forget")!;
let saved: SavedCampusImport | null = null;

async function update(command = "status"): Promise<void> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({ channel: CAMPUS_CHANNEL, kind: "popup", command });
    if (!isRecord(response) || response.ok !== true || !isRecord(response.state)) {
      throw new Error(isRecord(response) && typeof response.error === "string" ? response.error : "Connector unavailable.");
    }
    const state = response.state as unknown as CampusConnectionState;
    saved = state.saved ? parseSavedCampusImport(state.saved) : null;
    status.textContent = state.message;
    details.textContent = saved ? `Imported ${new Date(saved.imported_at).toLocaleDateString()} · ${saved.data.terms.join(", ")}` : "";
    const pending = state.phase === "waiting" || state.phase === "reading";
    connect.disabled = pending;
    connect.textContent = saved ? "Update saved schedule" : "Connect Infinite Campus";
    cancel.hidden = !pending;
    download.hidden = !saved;
    forget.hidden = !saved && !pending;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Connector unavailable.";
    connect.disabled = false;
  }
}

connect.addEventListener("click", () => { connect.disabled = true; void update("connect"); });
cancel.addEventListener("click", () => { void update("cancel"); });
forget.addEventListener("click", () => { void update("forget"); });
download.addEventListener("click", () => {
  if (!saved) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(saved)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `gunnwatt-campus-${saved.data.as_of}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});
chrome.storage.onChanged.addListener(() => { void update(); });
void update();
