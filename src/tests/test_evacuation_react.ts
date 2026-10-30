import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { register } from "node:module";
import type { LocatedRoom } from "../../web/src/features/rooms/types.js";
import type { EvacuationOverview } from "../../web/src/features/evacuation/types.js";

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/evacuation", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLDialogElement", "CustomEvent", "Event", "Node", "NodeList", "DocumentFragment", "sessionStorage", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => dom.window.requestAnimationFrame(callback) });
Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: (id: number) => dom.window.cancelAnimationFrame(id) });
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { observe() {} disconnect() {} } });
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event("close")); };

// Select the same real Panzoom ES module that Vite selects in the browser.
// Its package main points Node at a UMD file within a type:module package.
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  return specifier === "@panzoom/panzoom" ? { ...result, url: result.url.replace(/panzoom\\.js$/, "panzoom.es.js") } : result;
}`)}`, import.meta.url);

const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");
const { EvacuationPage } = await import("../../web/src/pages/EvacuationPage.js");
const { FindRoomPage } = await import("../../web/src/pages/FindRoomPage.js");
const { ToastProvider } = await import("../../web/src/shared/toast.js");
const storage = await import("../../web/src/features/schedule/schedule-storage.js");
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

const room = (label: string, building: string, floor: number, group: string | null): LocatedRoom => ({
  id: label,
  label,
  building,
  floor,
  aliases: [],
  polygon: [[100, 100], [200, 100], [200, 200], [100, 200]],
  marker: building === "N" ? [1224, 792] : [612, 396],
  evacuation: {
    status: group ? "mapped" : "unconfirmed",
    group,
    color: group === "green" ? "#527d32" : group === "black" ? "#202529" : null,
    destination: group ? `Historical reference: ${group} group markings` : "Assembly area not confirmed",
    short_destination: group === "black" ? "Football field" : group === "green" ? "Bow Gym" : null,
    reference_label: group === "black" ? "N201-N217" : group === "green" ? "A" : null,
    note: group ? "Matched to the older supplied reference; current instructions remain unverified." : "E01 and E02 have not been confirmed as either source reference room.",
  },
});
const n214 = room("N214", "N", 2, "black");
const a134 = room("A134", "A", 1, "green");
const e01 = room("E01", "E", 1, null);
const overview: EvacuationOverview = {
  provenance: {
    sourceKind: "supplied_reference",
    originalFilename: "截屏2026-09-23 上午9.00.56.png",
    sourceFile: "src/map/gunn_evacuation_map.png",
    sourceImageSha256: "reference-hash",
    sourceRevisionDate: null,
    verifiedOn: null,
    imageSize: [1852, 1156],
  },
  routesAvailable: true,
  groups: {},
  inventoryExceptions: {},
  validationIssues: [],
};

async function harness(labels: string[], page = EvacuationPage, overviewFails = false) {
  for (const cookie of document.cookie.split(";")) document.cookie = `${cookie.split("=")[0].trim()}=; max-age=0; path=/`;
  sessionStorage.clear();
  const periods = storage.defaultPeriods();
  labels.forEach((label, index) => { periods[index] = { ...periods[index], building: label[0], room: label }; });
  storage.saveDraft(periods);
  const original = storage.loadDraft();
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: string, init?: RequestInit) => {
    assert.equal(init?.credentials, "omit");
    if (url === "/api/evacuation-data") {
      if (overviewFails) throw new Error("Network unavailable");
      return response(overview);
    }
    if (url === "/api/rooms") return response({ rooms: [n214, a134, e01], buildings: ["N", "A", "E"] });
    const query = new URL(url, "http://localhost").searchParams.get("q");
    const found = [n214, a134, e01].filter(candidate => candidate.label === query);
    return response({ rooms: found, map_size: [2448, 1584] });
  } });
  const container = document.querySelector("#root")!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(page))));
    await tick();
  });
  const get = <T extends Element = HTMLElement>(selector: string) => {
    const found = container.querySelector<T>(selector);
    assert.ok(found, `Missing ${selector}`);
    return found;
  };
  const click = async (selector: string) => { await act(async () => { get<HTMLButtonElement>(selector).click(); await tick(); }); };
  const close = async () => { await act(async () => { root.unmount(); await tick(); }); };
  return { container, get, click, close, original };
}

test("reference image stays separate from current classroom coordinates and viewer selection persists", async () => {
  const h = await harness(["N214", "A134", "N214"]);
  try {
    assert.equal(h.get<HTMLImageElement>(".evacuation-map-frame img").getAttribute("src"), "/evacuation-map.webp");
    assert.equal(h.container.querySelector(".evacuation-map-frame .evacuation-period-marker"), null);
    assert.equal(h.get<HTMLAnchorElement>("a[download]").download, overview.provenance.originalFilename);
    assert.match(h.get(".reference-status").textContent!, /older reference.*unverified/i);

    await h.click('button[aria-label="Open original evacuation reference map"]');
    const viewer = h.get<HTMLDialogElement>(".evacuation-map-dialog");
    assert.equal(viewer.open, true);
    assert.equal(h.get<HTMLImageElement>(".evacuation-map-dialog img").getAttribute("src"), "/evacuation-map.webp");
    assert.equal(viewer.querySelector(".evacuation-period-marker"), null);
    await h.click('button[aria-label="Close full map"]');

    await h.click(".schedule-evacuation .panel-heading button");
    assert.equal(h.get<HTMLImageElement>(".evacuation-map-dialog img").getAttribute("src"), "/map.webp");
    assert.equal(viewer.querySelectorAll(".evacuation-period-marker").length, 3);
    const first = h.get<HTMLButtonElement>('.evacuation-period-marker[aria-label="Period 1, room N214"]');
    const repeated = h.get<HTMLButtonElement>('.evacuation-period-marker[aria-label="Period 3, room N214"]');
    assert.equal(first.style.top, "50%");
    assert.notEqual(first.style.left, repeated.style.left, "repeated periods must remain separately selectable");
    await h.click('.evacuation-period-marker[aria-label="Period 2, room A134"]');
    assert.match(h.get(".schedule-room-details").textContent!, /P2 · A134/);
    assert.match(h.get(".schedule-room-details").textContent!, /Reference green group · A · Bow Gym/);
    assert.match(h.get(".schedule-room-details").textContent!, /Matched to the older supplied reference/);
    assert.equal(h.get('.evacuation-period-marker[aria-label="Period 2, room A134"]').getAttribute("aria-pressed"), "true");

    await h.click(".evacuation-period-tabs button:nth-child(3)");
    assert.match(h.get(".schedule-room-details").textContent!, /P3 · N214.*Floor 2.*Reference black group · N201-N217 · Football field/s);
    assert.match(h.get(".schedule-room-details").textContent!, /not a verified current school evacuation plan/);
    await h.click('button[aria-label="Close full map"]');
    await h.click(".schedule-evacuation .panel-heading button");
    assert.match(h.get(".schedule-room-details").textContent!, /P3 · N214/);
    assert.deepEqual(storage.loadDraft(), h.original, "viewing classroom references must preserve the saved draft");
  } finally { await h.close(); }
});

test("unconfirmed and unresolved saved rooms display no invented reference assignment", async () => {
  const h = await harness(["E01", "K1"]);
  try {
    await h.click(".schedule-evacuation-item");
    assert.match(h.get(".schedule-room-details").textContent!, /No matching reference group/);
    assert.match(h.get(".schedule-room-details").textContent!, /E01 and E02 have not been confirmed/);
    assert.equal(h.container.querySelector(".schedule-room-details .route-swatch"), null);
    await h.click(".evacuation-period-tabs button:nth-child(2)");
    assert.match(h.get(".schedule-room-details").textContent!, /Room reference details unavailable/);
    assert.equal(h.container.querySelector('.evacuation-period-marker[aria-label="Period 2, room K1"]'), null);
    assert.deepEqual(storage.loadDraft(), h.original);
  } finally { await h.close(); }
});

test("Find Room labels mapped groups as older references and displays the backend note", async () => {
  const h = await harness([], FindRoomPage);
  try {
    await act(async () => {
      const input = h.get<HTMLInputElement>("#find-room-input");
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "A134");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await tick();
    });
    await act(async () => {
      h.get(".find-room-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      await tick();
    });
    assert.match(h.get(".find-room-details").textContent!, /Older evacuation reference.*Current plan unverified/s);
    assert.match(h.get(".room-lookup-destination").textContent!, /Reference green group · A · Bow Gym/);
    assert.match(h.get(".find-room-details").textContent!, /Matched to the older supplied reference/);
    assert.equal(h.get<HTMLImageElement>(".room-locator-art img").getAttribute("src"), "/map.webp");
  } finally { await h.close(); }
});

test("failed reference metadata loading displays an error without inventing provenance", async () => {
  const h = await harness([], EvacuationPage, true);
  try {
    await h.click('button[aria-label="Read the reference map source and groups"]');
    const notes = h.get(".map-reference-notes");
    assert.match(notes.textContent!, /Reference information could not be loaded/);
    assert.doesNotMatch(notes.textContent!, /Loading reference information|Source revision date/);
    assert.equal(h.container.querySelector("a[download]"), null);
    assert.equal(h.get<HTMLImageElement>(".evacuation-map-frame img").getAttribute("src"), "/evacuation-map.webp");
  } finally { await h.close(); }
});
