import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { excludedFromVisits, observeVisits } from "../../web/src/features/visits/visit-counter.js";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function browser(url = "https://xmccc-glitch.github.io/GunnMap/") {
  const dom = new JSDOM('<div id="counter"></div>', { url, pretendToBeVisual: true });
  for (const key of ["window", "document", "location", "navigator", "localStorage"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  const recorded = new Map<string, string>();
  let total = -1;
  let notice = "";
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: string, init?: RequestInit) => {
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.referrerPolicy, "no-referrer");
    requests.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    let removed = 0;
    if (init?.method === "POST") {
      const { visitId, undoToken } = JSON.parse(String(init.body)); recorded.set(visitId, undoToken);
    } else if (init?.method === "DELETE") {
      const id = url.split("/").at(-1)!;
      if (recorded.get(id) === JSON.parse(String(init.body)).undoToken) { recorded.delete(id); removed = 1; }
    }
    return Response.json({ total: 7 + recorded.size, startedAt: "2026-10-20T00:00:00Z", removed });
  } });
  const observe = () => observeVisits({ apiUrl: "https://local-test.example/visits", onSummary: value => { total = value.total; },
    onUnavailable: () => assert.fail("unexpected failure"), onNotice: value => { notice = value; } });
  return { dom, requests, observe, total: () => total, notice: () => notice };
}

test("a page opening reuses its receipt through remounts and SPA navigation", async () => {
  const h = browser(); let stop = h.observe(); await tick(); assert.equal(h.total(), 8); stop();
  const first = JSON.parse(h.requests.find(request => request.method === "POST")!.body!);
  h.dom.window.history.replaceState(null, "", "/GunnMap/find-room/");
  stop = h.observe(); await tick(); assert.equal(h.total(), 8);
  assert.ok(h.requests.filter(request => request.method === "POST").every(request => JSON.parse(request.body!).visitId === first.visitId));
  stop(); h.dom.window.close();
  const fresh = browser(); const stopFresh = fresh.observe(); await tick();
  assert.notEqual(JSON.parse(fresh.requests.find(request => request.method === "POST")!.body!).visitId, first.visitId);
  stopFresh(); fresh.dom.window.close();
});

test("development opt-out persists; explicit stats=on restores user visits", async () => {
  const h = browser("https://xmccc-glitch.github.io/GunnMap/?stats=off");
  assert.equal(excludedFromVisits(), true); h.dom.window.history.replaceState(null, "", "/GunnMap/find-room/");
  assert.equal(excludedFromVisits(), true); let stop = h.observe(); await tick();
  assert.deepEqual(h.requests.map(request => request.method), ["GET"]); stop();
  h.dom.window.history.replaceState(null, "", "/GunnMap/?stats=on");
  stop = h.observe(); await tick(); assert.equal(h.total(), 8);
  stop(); h.dom.window.close();
});

test("user-directed agents and webdriver browsers count without a challenge", async () => {
  const h = browser(); Object.defineProperty(navigator, "webdriver", { value: true });
  Object.defineProperty(navigator, "userAgent", { value: "ChatGPT Agent" });
  const stop = h.observe(); await tick(); assert.equal(h.total(), 8);
  assert.equal(document.querySelectorAll("script, iframe").length, 0);
  stop(); h.dom.window.close();
});

test("undo opts out, targets its own saved receipt and repeats the same deletion", async () => {
  const h = browser(); let stop = h.observe(); await tick(); stop();
  const receipt = JSON.parse(h.requests.find(request => request.method === "POST")!.body!);
  h.dom.window.history.replaceState(null, "", "/GunnMap/?stats=undo");
  stop = h.observe(); await tick(); assert.equal(h.total(), 7); assert.match(h.notice(), /removed/); stop();
  stop = h.observe(); await tick(); assert.equal(h.total(), 7); stop();
  const deletions = h.requests.filter(request => request.method === "DELETE");
  assert.equal(deletions.length, 2);
  assert.ok(deletions.every(request => request.url.endsWith(receipt.visitId) && JSON.parse(request.body!).undoToken === receipt.undoToken));
  assert.equal(h.requests.filter(request => request.method === "POST").length, 1);
  assert.equal(excludedFromVisits(), true); h.dom.window.close();
});

test("localhost, background tabs, undo without a receipt and discarded mounts do not count", async () => {
  const local = browser("http://localhost:8000/GunnMap/"); let stop = local.observe(); await tick();
  assert.deepEqual(local.requests.map(request => request.method), ["GET"]); stop(); local.dom.window.close();
  const h = browser(); let visible = false;
  Object.defineProperty(document, "visibilityState", { get: () => visible ? "visible" : "hidden" });
  stop = h.observe(); await tick(); assert.deepEqual(h.requests.map(request => request.method), ["GET"]);
  visible = true; document.dispatchEvent(new h.dom.window.Event("visibilitychange")); await tick(); assert.equal(h.total(), 8);
  stop(); h.dom.window.close();
  const empty = browser("https://xmccc-glitch.github.io/GunnMap/?stats=undo"); stop = empty.observe(); await tick();
  assert.match(empty.notice(), /No local/); assert.deepEqual(empty.requests.map(request => request.method), ["GET"]); stop(); empty.dom.window.close();
  const cancelled = browser(); stop = cancelled.observe(); stop(); await tick();
  assert.equal(cancelled.requests.filter(request => request.method === "POST").length, 0); cancelled.dom.window.close();
});
