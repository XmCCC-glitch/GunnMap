import { CAMPUS_ORIGIN, isAppUrl, isRecord, type CampusPeriods } from "../domain/campus-contract.js";
import { CampusLoginRequired, collectCampus } from "./collect.js";

declare const GUNNWATT_APP_URL: string;

/** Self-contained bookmark: no remote script, data URL, credentials or extension needed. */
function run() {
  if (window.top !== window || location.origin !== CAMPUS_ORIGIN) {
    alert("Sign in to the official PAUSD Campus Student website, then click this bookmark.");
    return;
  }
  if (!isAppUrl(GUNNWATT_APP_URL)) return;
  document.getElementById("gunnwatt-campus-import")?.remove();
  const panel = document.createElement("div");
  panel.id = "gunnwatt-campus-import";
  panel.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;max-width:340px;padding:20px;border-radius:14px;background:#14212d;color:#fff;box-shadow:0 4px 30px #0005;font:16px/1.5 system-ui";
  const label = document.createElement("p");
  label.textContent = "Reading your schedule for GunnWatt…";
  panel.append(label);
  document.body.append(panel);
  const id = crypto.randomUUID();
  const url = new URL(GUNNWATT_APP_URL);
  url.searchParams.set("campus-import", id);
  const origin = url.origin;
  let target: Window | null = null;
  let ready = false;
  let result: { data: CampusPeriods } | { error: string } | null = null;
  let timer: ReturnType<typeof setTimeout>;
  const send = () => {
    if (ready && result && target && !target.closed) {
      target.postMessage({ channel: "gunnwatt-campus-bookmark-v1", kind: "result", id, ...result }, origin);
    }
  };
  const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); };
  const receive = (event: MessageEvent) => {
    const message: unknown = event.data;
    if (event.source !== target || event.origin !== origin || !isRecord(message)
      || message.channel !== "gunnwatt-campus-bookmark-v1" || message.id !== id) return;
    if (message.kind === "ready") { ready = true; send(); }
    if (message.kind === "accepted" || message.kind === "rejected") {
      cleanup();
      label.textContent = message.kind === "accepted" ? "Imported. Your schedule is ready in the GunnWatt tab."
        : "Import could not be saved. Check the GunnWatt tab for details.";
      target?.focus();
    }
  };
  window.addEventListener("message", receive);
  timer = setTimeout(() => {
    cleanup();
    label.textContent = "Import timed out. Keep both tabs open and try the bookmark again.";
  }, 55000);
  const start = () => {
    target = window.open(url.href, "_blank");
    if (!target) {
      label.textContent = "Your browser blocked the return tab. Click below to continue.";
      if (!panel.querySelector("button")) {
        const button = document.createElement("button");
        button.textContent = "Continue to GunnWatt";
        button.onclick = () => { button.remove(); start(); };
        panel.append(button);
      }
      return;
    }
    void collectCampus().then(data => {
      result = { data };
      label.textContent = "Schedule read. Sending it to the GunnWatt tab…";
      send();
    }).catch(error => {
      const message = error instanceof CampusLoginRequired
        ? "Sign in to Campus Student, then click the import bookmark again."
        : "Campus could not be read. Keep your previous import and try again after signing in.";
      result = { error: message };
      label.textContent = message;
      send();
    });
  };
  start();
}

run();
