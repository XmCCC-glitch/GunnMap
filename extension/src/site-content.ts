import { CAMPUS_CHANNEL, isAppUrl, isCampusCommand, isRecord, isRequestId } from "../../src/domain/campus-contract.js";

if (window.top === window && isAppUrl(window.location.href)) {
  const origin = window.location.origin;
  window.addEventListener("message", event => {
    const message: unknown = event.data;
    if (event.source !== window || event.origin !== origin || !isRecord(message)
      || message.channel !== CAMPUS_CHANNEL || message.source !== "page" || message.kind !== "request"
      || !isRequestId(message.requestId) || !isCampusCommand(message.command)) return;
    // The page can request only these named actions, never arbitrary URLs or student IDs.
    void chrome.runtime.sendMessage({
      channel: CAMPUS_CHANNEL, kind: "page", command: message.command, requestId: message.requestId,
    }).then(response => window.postMessage({
      channel: CAMPUS_CHANNEL, source: "extension", kind: "response", requestId: message.requestId, response,
    }, origin)).catch(() => window.postMessage({
      channel: CAMPUS_CHANNEL, source: "extension", kind: "response", requestId: message.requestId,
      response: { ok: false, error: "Reload this page after enabling the Campus connector." },
    }, origin));
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id === chrome.runtime.id && isRecord(message)
      && message.channel === CAMPUS_CHANNEL && message.kind === "changed") {
      window.postMessage({ channel: CAMPUS_CHANNEL, source: "extension", kind: "changed" }, origin);
    }
  });
}
