import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { rooms as inventory, buildings } from "../project.js";
import type { Period, ScheduleTemplate } from "../../web/src/features/schedule/types.js";

// Mount the shipped React components and autocomplete implementation. Only
// browser primitives missing in jsdom and external I/O are substituted.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLDialogElement", "CustomEvent", "Event", "Node", "DocumentFragment", "sessionStorage", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => dom.window.requestAnimationFrame(callback) });
dom.window.HTMLElement.prototype.scrollIntoView = function () { this.dataset.scrolled = "true"; };
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
  this.dispatchEvent(new dom.window.Event("close"));
};

const { createRoot } = await import("react-dom/client");
const { MemoryRouter, Routes, Route, useNavigate } = await import("react-router-dom");
const { SchedulePage } = await import("../../web/src/pages/SchedulePage.js");
const { ToastProvider } = await import("../../web/src/shared/toast.js");
const storage = await import("../../web/src/features/schedule/schedule-storage.js");

const blank = () => storage.defaultPeriods();
const schedule = (room: string): Period[] => {
  const periods = blank();
  periods[0] = { ...periods[0], building: room[0], room };
  return periods;
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
};
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
let allowCookieWrites = true;
const cookieWrites: string[] = [];
const cookieDescriptor = Object.getOwnPropertyDescriptor(dom.window.Document.prototype, "cookie")!;
Object.defineProperty(dom.window.document, "cookie", {
  configurable: true,
  get: () => cookieDescriptor.get!.call(dom.window.document) as string,
  set: (value: string) => { cookieWrites.push(value); if (allowCookieWrites) cookieDescriptor.set!.call(dom.window.document, value); },
});

async function harness(options: { draft?: Period[]; shared?: Period[]; legacy?: Period[]; legacyTemplates?: ScheduleTemplate[]; blocked?: boolean } = {}) {
  allowCookieWrites = true;
  for (const item of document.cookie.split(";")) document.cookie = `${item.split("=")[0].trim()}=; max-age=0; path=/`;
  sessionStorage.clear();
  dom.window.history.replaceState(null, "", options.shared ? `/#schedule=${encodeURIComponent(JSON.stringify(options.shared))}` : "/");
  if (options.draft) storage.saveDraft(options.draft);
  if (options.legacy) document.cookie = `gunnmap_schedule_draft=${encodeURIComponent(JSON.stringify({ version: 1, periods: options.legacy }))}; path=/`;
  if (options.legacyTemplates) document.cookie = `gunnmap_schedule_templates=${encodeURIComponent(JSON.stringify(options.legacyTemplates))}; path=/`;
  allowCookieWrites = !options.blocked;
  const requests: Period[][] = [];
  const io = {
    render: async (_periods: Period[]): Promise<Response> => response({ image_url: "/output/period_map_11111111111111111111111111111111.png" }),
    decode: async () => {},
  };
  Object.defineProperty(globalThis, "Image", { configurable: true, value: class {
    src = "";
    decode() { return io.decode(); }
  } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: string, init?: RequestInit) => {
    assert.equal(init?.credentials, "omit", "public room and render requests must not carry the local draft cookie");
    if (url === "/api/rooms") return response({ rooms: inventory.map(room => ({ ...room, floor: room.floor ?? 1, aliases: room.aliases ?? [] })), buildings });
    assert.equal(url, "/api/render");
    const periods = (JSON.parse(String(init?.body)) as { periods: Period[] }).periods;
    requests.push(periods);
    return io.render(periods);
  } });
  let navigate!: ReturnType<typeof useNavigate>;
  function NavigationProbe() {
    navigate = useNavigate();
    return createElement(Routes, null,
      createElement(Route, { path: "/", element: createElement(SchedulePage) }),
      createElement(Route, { path: "/generate-map", element: createElement("p", { id: "generated-page" }, "Generated map") }),
      createElement(Route, { path: "/other", element: createElement("p", { id: "other-page" }, "Other page") }));
  }
  const container = document.querySelector("#root")!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(NavigationProbe))));
    await tick();
  });
  const get = <T extends Element = HTMLElement>(selector: string): T => {
    const found = container.querySelector<T>(selector);
    assert.ok(found, `Missing ${selector}`);
    return found;
  };
  const byText = (text: string) => {
    const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === text);
    assert.ok(found, `Missing button ${text}`);
    return found;
  };
  const click = async (text: string) => { await act(async () => { byText(text).click(); await tick(); }); };
  const clickLabel = async (label: string) => { await act(async () => { get<HTMLButtonElement>(`button[aria-label="${label}"]`).click(); await tick(); }); };
  const input = async (value: string, period = 1) => {
    await act(async () => {
      const field = get<HTMLInputElement>(`#period-${period}-room`);
      field.value = value;
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await tick();
    });
  };
  const submit = async () => { await act(async () => { get("form[aria-busy]").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await tick(); }); };
  const route = async (path: string) => { await act(async () => { navigate(path); await tick(); }); };
  const cookie = (name: string): unknown => {
    const entry = document.cookie.split("; ").find(value => value.startsWith(`${name}=`));
    return entry ? JSON.parse(decodeURIComponent(entry.slice(name.length + 1))) : null;
  };
  const saveTemplate = async (name?: string) => {
    await click("Save current");
    if (name !== undefined) {
      await act(async () => {
        const field = get<HTMLInputElement>("#template-name");
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(field, name);
        field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        await tick();
      });
    }
    await act(async () => {
      get("#template-name").closest("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      await tick();
    });
  };
  const close = async () => {
    await act(async () => { root.unmount(); await tick(); });
    allowCookieWrites = true;
  };
  return { get, click, clickLabel, input, submit, route, cookie, requests, io, saveTemplate, close };
}

test("real React shared preview survives edits and route changes without replacing the device draft", async () => {
  const original = schedule("M3");
  const h = await harness({ draft: original, shared: schedule("N214") });
  try {
    assert.deepEqual(storage.loadDraft(), original);
    await h.click("Use once");
    await h.input("n – 211");
    assert.deepEqual(storage.loadDraft(), original);
    assert.ok(h.get(".shared-preview-banner"));
    await h.route("/other");
    await h.route("/");
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "n – 211");
    assert.deepEqual(storage.loadDraft(), original);
    await h.click("Save to this device");
    assert.equal(storage.loadDraft()![0].room, "n – 211");
    await h.clickLabel("Undo");
    assert.deepEqual(storage.loadDraft(), original);
    await h.click("Return to my draft");
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "M3");
    assert.deepEqual(storage.loadDraft(), original);
  } finally { await h.close(); }
});

test("shared example, clear, undo and redo keep the original device draft", async () => {
  const original = schedule("M3");
  const h = await harness({ draft: original, shared: schedule("N214") });
  try {
    await h.click("Use once");
    await h.click("Load Example");
    assert.deepEqual(storage.loadDraft(), original);
    await h.click("Clear Schedule");
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "");
    assert.deepEqual(storage.loadDraft(), original);
    await h.clickLabel("Undo");
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "F4");
    await h.clickLabel("Redo");
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "");
    assert.deepEqual(storage.loadDraft(), original);
  } finally { await h.close(); }
});

test("failed explicit save keeps a shared schedule in preview mode", async () => {
  const original = schedule("M3");
  const h = await harness({ draft: original, shared: schedule("N214"), blocked: true });
  try {
    await h.click("Save and use");
    assert.ok(h.get(".shared-preview-banner"));
    await h.input("N211");
    await h.click("Save to this device");
    assert.ok(h.get(".shared-preview-banner"));
    assert.deepEqual(storage.loadDraft(), original);
    assert.match(h.get(".toast-region").textContent!, /could not be saved/);
  } finally { await h.close(); }
});

test("real React rows resolve merged K5 and the remaining K6, and focus invalid rooms", async () => {
  const h = await harness();
  try {
    await h.input("n – 2 14");
    assert.match(h.get("#period-1-feedback").textContent!, /Found N214/);
    await h.input("library", 2);
    assert.match(h.get("#period-2-feedback").textContent!, /D-LIB/);
    await h.input("K6 (upper map location)", 3);
    assert.match(h.get("#period-3-feedback").textContent!, /Found K5/);
    await h.input("K6", 3);
    assert.match(h.get("#period-3-feedback").textContent!, /Found K6/);
    await h.input("N999", 5);
    await h.submit();
    assert.equal(h.requests.length, 0);
    assert.match(h.get(".schedule-validation-message").textContent!, /period 5/);
    assert.equal(document.activeElement?.id, "period-5-room");
    assert.equal(h.get("#period-5-room").getAttribute("aria-invalid"), "true");
    assert.equal(h.get("#period-5-room").getAttribute("aria-describedby"), "period-5-feedback");
    await h.input("", 5);
    await h.submit();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0][0].building, "N");
    assert.equal(h.requests[0][1].building, "D");
    assert.ok(h.get("#generated-page"));
  } finally { await h.close(); }
});

test("legacy cookies stay intact while clear and undo use the separate v2 draft", async () => {
  const original = schedule("M3");
  const legacyTemplates = [{ name: "Original Monday", periods: original }];
  const h = await harness({ legacy: original, legacyTemplates });
  try {
    await h.input("N214");
    assert.equal(storage.loadDraft()![0].room, "N214");
    assert.deepEqual(h.cookie("gunnmap_schedule_draft"), { version: 1, periods: original });
    await h.click("Clear Schedule");
    assert.equal(h.cookie(storage.DRAFT_COOKIE_NAME), null);
    assert.equal(storage.loadDraft(), null, "the legacy draft must not reappear after clear");
    await h.clickLabel("Undo");
    assert.equal(storage.loadDraft()![0].room, "N214");
    assert.deepEqual(h.cookie("gunnmap_schedule_draft"), { version: 1, periods: original });
    await h.saveTemplate("New Monday");
    assert.equal(storage.loadTemplates().length, 2);
    assert.deepEqual(h.cookie("gunnmap_schedule_templates"), legacyTemplates);
  } finally { await h.close(); }
});

test("saving and deleting templates participate in the existing undo history", async () => {
  const h = await harness({ draft: schedule("M3") });
  try {
    await h.saveTemplate();
    assert.equal(storage.loadTemplates().length, 1);
    await h.click("Delete");
    await h.click("Delete Template");
    assert.equal(storage.loadTemplates().length, 0);
    await h.clickLabel("Undo");
    assert.equal(storage.loadTemplates()[0].name, "Schedule 1");
    await h.clickLabel("Undo");
    assert.equal(storage.loadTemplates().length, 0);
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "M3");
  } finally { await h.close(); }
});

test("editing or leaving the React schedule page discards pending render responses", async () => {
  const h = await harness({ draft: schedule("M3") });
  try {
    const pending = deferred<Response>();
    h.io.render = () => pending.promise;
    await h.submit();
    await h.input("N214");
    await act(async () => { pending.resolve(response({ image_url: "/output/stale.png" })); await tick(); });
    assert.equal(document.querySelector("#generated-page"), null);
    assert.equal(sessionStorage.getItem(storage.GENERATED_MAP_SESSION_KEY), null);
    const leaving = deferred<Response>();
    h.io.render = () => leaving.promise;
    await h.submit();
    await h.route("/other");
    await act(async () => { leaving.resolve(response({ image_url: "/output/stale-after-leaving.png" })); await tick(); });
    assert.ok(h.get("#other-page"));
    assert.equal(sessionStorage.getItem(storage.GENERATED_MAP_SESSION_KEY), null);
  } finally { await h.close(); }
});

test("undo while a rendered image decodes prevents stale navigation", async () => {
  const h = await harness({ draft: schedule("M3") });
  try {
    await h.click("Load Example");
    const decode = deferred<void>();
    h.io.decode = () => decode.promise;
    await h.submit();
    await h.clickLabel("Undo");
    await act(async () => { decode.resolve(); await tick(); });
    assert.equal(document.querySelector("#generated-page"), null);
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "M3");
    assert.equal(sessionStorage.getItem(storage.GENERATED_MAP_SESSION_KEY), null);
  } finally { await h.close(); }
});

test("replacing a same-name template can be undone without changing the current schedule", async () => {
  const h = await harness({ draft: schedule("M3") });
  try {
    await h.saveTemplate("Monday");
    assert.equal(storage.loadTemplates()[0].name, "Monday");
    await h.input("N214");
    await h.saveTemplate("Monday");
    assert.equal(storage.loadTemplates().length, 1);
    assert.equal(storage.loadTemplates()[0].periods[0].room, "N214");
    await h.clickLabel("Undo");
    assert.equal(storage.loadTemplates()[0].periods[0].room, "M3");
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "N214");
  } finally { await h.close(); }
});

test("building changes preserve room text and Auto-detect submits the recognized building", async () => {
  const h = await harness({ draft: schedule("N214") });
  try {
    const select = h.get<HTMLSelectElement>('select[aria-label="Period 1 building"]');
    await act(async () => {
      select.value = "M";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await tick();
    });
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "N214");
    assert.equal(h.get("#period-1-room").getAttribute("aria-invalid"), "true");
    await act(async () => {
      select.value = "";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await tick();
    });
    assert.equal(h.get("#period-1-room").getAttribute("aria-invalid"), "false");
    await h.submit();
    assert.equal(h.requests[0][0].building, "N");
  } finally { await h.close(); }
});

test("the actual autocomplete accepts normalized input and selecting a suggestion updates React state", async () => {
  const h = await harness();
  try {
    await h.input("n – 214");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const suggestion = h.get<HTMLLIElement>("#period-1-room-suggestions li");
    assert.equal(document.querySelectorAll("#period-1-room-suggestions").length, 1);
    assert.match(suggestion.textContent!, /N214/);
    let selected: unknown;
    h.get("#period-1-room").addEventListener("selection", event => { selected = (event as CustomEvent).detail; });
    await act(async () => {
      const field = h.get<HTMLInputElement>("#period-1-room");
      field.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", keyCode: 40, bubbles: true }));
      field.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
      await tick();
    });
    assert.ok(selected, `Selection event missing: ${suggestion.outerHTML}`);
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "N214");
    assert.equal(storage.loadDraft()![0].room, "N214");
    await act(async () => {
      h.get("#period-1-room").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
      await tick();
    });
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "");
    assert.equal(storage.loadDraft()![0].room, "", "Escape must clear React state as well as the visible input");
    await h.input("K6");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const k6Suggestions = [...document.querySelectorAll("#period-1-room-suggestions li")];
    assert.equal(k6Suggestions.length, 1);
    assert.match(k6Suggestions[0].textContent!, /K6/);
    assert.doesNotMatch(k6Suggestions[0].textContent!, /upper map location/i);
  } finally { await h.close(); }
});

test("editing enables a fresh generation while a superseded request is still pending", async () => {
  const h = await harness({ draft: schedule("M3") });
  try {
    const older = deferred<Response>();
    h.io.render = () => older.promise;
    await h.submit();
    assert.equal(h.get<HTMLButtonElement>('form[aria-busy] button[type="submit"]').disabled, true);
    await h.input("N214");
    assert.equal(h.get<HTMLButtonElement>('form[aria-busy] button[type="submit"]').disabled, false);
    const currentUrl = "/output/period_map_22222222222222222222222222222222.png";
    h.io.render = async () => response({ image_url: currentUrl });
    await h.submit();
    assert.ok(h.get("#generated-page"));
    await act(async () => { older.resolve(response({ error: "Old request failed" }, false)); await tick(); });
    assert.equal(sessionStorage.getItem(storage.GENERATED_MAP_SESSION_KEY), currentUrl);
    assert.doesNotMatch(h.get(".toast-region").textContent!, /Old request/);
  } finally { await h.close(); }
});

test("autocomplete suggestions keep distinct IDs and active descendants for separate periods", async () => {
  const h = await harness();
  try {
    await h.input("N214", 1);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    await h.input("N214", 2);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const first = h.get("#period-1-room-suggestions li");
    const second = h.get("#period-2-room-suggestions li");
    assert.notEqual(first.id, second.id);
    await act(async () => {
      h.get("#period-2-room").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", keyCode: 40, bubbles: true }));
      await tick();
    });
    assert.equal(h.get("#period-2-room").getAttribute("aria-activedescendant"), second.id);
  } finally { await h.close(); }
});

test("shared preview and generated-map schedule survive route changes when session storage is blocked", async () => {
  const original = schedule("M3");
  const h = await harness({ draft: original, shared: schedule("N214") });
  const storagePrototype = dom.window.Storage.prototype;
  const originalGet = storagePrototype.getItem;
  const originalSet = storagePrototype.setItem;
  const originalRemove = storagePrototype.removeItem;
  const denied = () => { throw new dom.window.DOMException("Storage blocked", "SecurityError"); };
  storagePrototype.getItem = denied;
  storagePrototype.setItem = denied;
  storagePrototype.removeItem = denied;
  try {
    await h.click("Use once");
    await h.input("N211");
    await h.route("/other");
    assert.equal(storage.readCurrentSchedule()[0].room, "N211");
    await h.route("/");
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "N211");
    assert.ok(h.get(".shared-preview-banner"));
    assert.deepEqual(storage.loadDraft(), original);
    await h.click("Return to my draft");
    await h.route("/other");
    await h.route("/");
    assert.equal(h.get<HTMLInputElement>("#period-1-room").value, "M3");
  } finally {
    storagePrototype.getItem = originalGet;
    storagePrototype.setItem = originalSet;
    storagePrototype.removeItem = originalRemove;
    await h.close();
  }
});

test("mobile building controls are mounted on request and continue to support manual selection", async () => {
  const original = dom.window.matchMedia;
  Object.defineProperty(dom.window, "matchMedia", { configurable: true, value: () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  }) });
  const h = await harness({ draft: schedule("M3") });
  try {
    assert.equal(document.querySelectorAll('.field-building select').length, 0);
    assert.equal(document.querySelectorAll('wa-select, wa-color-picker').length, 0);
    await h.click("Choose buildings manually");
    assert.equal(document.querySelectorAll('.field-building select').length, 7);
    const select = h.get<HTMLSelectElement>('select[aria-label="Period 1 building"]');
    await act(async () => { select.value = "N"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    assert.equal(storage.readCurrentSchedule()[0].building, "N");
    await h.click("Hide building choices");
    assert.equal(document.querySelectorAll('.field-building select').length, 0);
    assert.equal(storage.readCurrentSchedule()[0].building, "N");
  } finally { await h.close(); Object.defineProperty(dom.window, "matchMedia", { configurable: true, value: original }); }
});

test("one on-demand color dialog edits the selected period without submitting the schedule", async () => {
  const h = await harness({ draft: schedule("M3") });
  try {
    assert.equal(document.querySelectorAll('.color-editor').length, 0);
    assert.equal(document.querySelectorAll('.period-color-trigger').length, 7);
    await h.clickLabel("Period 2 color");
    await act(async () => { await import("../../web/src/features/schedule/ColorEditor.js"); await tick(); });
    const dialog = document.querySelector<HTMLDialogElement>('.color-editor');
    assert.ok(dialog?.open);
    assert.equal(dialog.closest('form'), null, "the modal must not nest a form inside the schedule form");
    const color = storage.PERIOD_COLORS[4];
    await act(async () => { dialog.querySelector<HTMLButtonElement>(`button[aria-label="Use ${color}"]`)!.click(); });
    await act(async () => { dialog.querySelector('form')!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await tick(); });
    assert.equal(storage.readCurrentSchedule()[1].color, color);
    assert.equal(h.requests.length, 0, "applying a color must not generate a map");
    assert.equal(document.querySelectorAll('.color-editor').length, 0);
    assert.equal(document.activeElement?.getAttribute("aria-label"), "Period 2 color");
    await h.clickLabel("Undo");
    assert.equal(storage.readCurrentSchedule()[1].color, storage.PERIOD_COLORS[1]);
  } finally { await h.close(); }
});

test("typing coalesces cookie writes and navigation and pagehide flush the latest draft", async () => {
  const h = await harness({ draft: schedule("M3") });
  try {
    cookieWrites.length = 0;
    await h.input("A");
    await h.input("A1");
    await h.input("A134");
    assert.equal(cookieWrites.length, 0, "typing must not synchronously write cookies");
    assert.equal(storage.loadDraft()![0].room, "A134", "Undo and other actions see the pending draft");
    assert.equal((h.cookie(storage.DRAFT_COOKIE_NAME) as {periods: Period[]}).periods[0].room, "M3");
    await h.route("/other");
    assert.equal(cookieWrites.length, 1);
    assert.equal((h.cookie(storage.DRAFT_COOKIE_NAME) as {periods: Period[]}).periods[0].room, "A134");
    await h.route("/");
    await h.input("L1");
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event("pagehide")); });
    assert.equal((h.cookie(storage.DRAFT_COOKIE_NAME) as {periods: Period[]}).periods[0].room, "L1");
    await h.input("M3");
    await h.click("Clear Schedule");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 280)); });
    assert.equal(h.cookie(storage.DRAFT_COOKIE_NAME), null, "a pending write must not resurrect a cleared draft");
  } finally { await h.close(); }
});

test("debounced drafts persist once after typing and Secure is used only over HTTPS", async () => {
  const h = await harness({ draft: schedule("M3") });
  try {
    cookieWrites.length = 0;
    await h.input("A134");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 280)); });
    assert.equal(cookieWrites.length, 1);
    assert.equal((h.cookie(storage.DRAFT_COOKIE_NAME) as {periods: Period[]}).periods[0].room, "A134");
    assert.doesNotMatch(cookieWrites[0], /; Secure/);
    dom.reconfigure({ url: "https://localhost/" });
    assert.equal(storage.saveDraft(schedule("L1")), true);
    assert.match(cookieWrites.at(-1)!, /; SameSite=Lax; Secure/);
    assert.equal(storage.saveTemplates([{ name: "Monday", periods: schedule("L1") }]), true);
    assert.match(cookieWrites.at(-1)!, /; SameSite=Lax; Secure/);
  } finally { await h.close(); dom.reconfigure({ url: "http://localhost/" }); }
});
