/** Run after npm run build:pages. Uses a fresh browser profile and synthetic IC responses. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext } from "playwright";
import { campusRoster, campusDays, campusEvents } from "./fixtures/campus.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = join(root, "dist/web");
const extension = join(root, "dist/campus-extension");
const appUrl = "http://127.0.0.1:8000/GunnMap/";
const campusOrigin = "https://pausdca.infinitecampus.org";
const profile = await mkdtemp(join(tmpdir(), "gunnwatt-extension-test-"));
const output = join(root, "output/playwright");
await mkdir(output, { recursive: true });

async function executable(): Promise<string> {
  if (process.env.CAMPUS_BROWSER_PATH) return process.env.CAMPUS_BROWSER_PATH;
  const current = chromium.executablePath();
  try { await access(current); return current; } catch { /* Try an installed compatible Chromium. */ }
  if (process.platform === "darwin") {
    const cache = join(homedir(), "Library/Caches/ms-playwright");
    for (const folder of (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
      const path = join(cache, folder, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
      try { await access(path); return path; } catch { /* Check the next installed revision. */ }
    }
  }
  throw new Error("Install Chromium with npx playwright install chromium or set CAMPUS_BROWSER_PATH.");
}

const mime: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".zip": "application/zip",
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", appUrl);
    const pathname = url.pathname.replace(/^\/GunnMap(?=\/|$)/, "") || "/";
    const path = resolve(web, `.${decodeURIComponent(pathname)}${pathname.endsWith("/") ? "index.html" : ""}`);
    if (!path.startsWith(web + sep)) { response.writeHead(403).end(); return; }
    const body = await readFile(path);
    response.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(8000, "127.0.0.1", done); });

let mode: "login" | "ready" | "error" | "delayed" = "login";
let release: (() => void) | undefined;
let readStarted: (() => void) | undefined;
const requests: string[] = [];
const navigationPaths: string[] = [];
let context: BrowserContext | null = null;

async function launch(): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: await executable(), headless: process.env.CAMPUS_TEST_HEADED !== "1",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      "--host-resolver-rules=MAP pausdca.infinitecampus.org ~NOTFOUND"],
    viewport: { width: 1280, height: 1000 },
  });
  ctx.setDefaultTimeout(15000);
  await ctx.route(`${campusOrigin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/campus/portal/students/paloalto.jsp") {
      navigationPaths.push(url.pathname);
      await route.fulfill({ contentType: "text/html", body: '<!doctype html><h1>Campus Student test sign-in</h1><a href="/campus/student-test">Finish test sign-in</a>' });
    } else if (url.pathname === "/campus/student-test") {
      if (mode === "login") mode = "ready";
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>Signed in with synthetic test data</h1>" });
    } else if (url.pathname === "/campus/resources/portal/roster") {
      requests.push(url.pathname);
      if (mode === "delayed") {
        readStarted?.();
        await new Promise<void>(done => { release = done; });
      }
      await route.fulfill({ status: mode === "login" ? 401 : mode === "error" ? 500 : 200,
        contentType: "application/json", body: JSON.stringify(mode === "login" ? {} : campusRoster) });
    } else if (url.pathname === "/campus/resources/calendar/instructionalDay") {
      requests.push(url.pathname);
      assert.equal(url.searchParams.get("structureID"), "42");
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(campusDays) });
    } else if (url.pathname === "/campus/resources/portal/dayEvent/byEnrollment") {
      requests.push(url.pathname);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(campusEvents) });
    } else await route.fulfill({ status: 404, body: "Unsupported test path" });
  });
  return ctx;
}

async function worker(ctx: BrowserContext) {
  return ctx.serviceWorkers()[0] ?? await ctx.waitForEvent("serviceworker");
}

try {
  context = await launch();
  const extensionWorker = await worker(context);
  const page = await context.newPage();
  await page.goto(appUrl);
  await page.waitForFunction(() => {
    const button = document.querySelector<HTMLButtonElement>(".campus-sync .primary-button");
    return button && !button.disabled;
  });
  assert.equal(requests.length, 0, "opening GunnWatt must not contact IC");
  assert.equal(await extensionWorker.evaluate(async () => (await chrome.tabs.query({ url: "http://127.0.0.1:8000/*" })).length), 1,
    "the extension must be able to find its app tab for result delivery");
  const portalOpened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Connect Infinite Campus", exact: true }).click();
  const portal = await portalOpened;
  // Extension-created tabs may start navigation before Playwright attaches its route.
  // DNS is blocked above; this attached navigation is fulfilled by the fixture.
  await portal.goto(`${campusOrigin}/campus/portal/students/paloalto.jsp`);
  await portal.getByText("Finish test sign-in").click({ timeout: 8000 });
  await page.locator(".campus-sync [role=status]").filter({ hasText: "Saved on this device" }).waitFor();
  await page.locator("#campus-date").fill("2026-10-15");
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>("#period-1-room")?.value === "M-03");
  assert.equal(await page.locator("#period-2-room").inputValue(), "N-214");
  const saved = await extensionWorker.evaluate(async () => (await chrome.storage.local.get("campusImport")).campusImport);
  assert.ok(saved);
  assert.doesNotMatch(JSON.stringify(saved), /personID|rosterID|structureID|Not exported|987654/);
  assert.deepEqual((saved as { saved: { data: { terms: string[] } } }).saved.data.terms, ["S1", "S2"]);
  await page.getByRole("button", { name: "Generate Map", exact: false }).click();
  await page.locator(".generated-map-result img").first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(output, "campus-extension-connected.png"), fullPage: true });
  console.log("PASS: official-page import, local projection, annual data, and static map generation");

  const beforeRestart = requests.length;
  await context.close();
  mode = "login"; // The remote session no longer works.
  context = await launch();
  const resumedWorker = await worker(context);
  const resumed = await context.newPage();
  await resumed.goto(appUrl);
  await resumed.locator(".campus-sync [role=status]").filter({ hasText: "Saved on this device" }).waitFor();
  await resumed.locator("#campus-date").fill("2027-01-07");
  await resumed.waitForFunction(() => document.querySelector<HTMLInputElement>("#period-1-room")?.value === "N-214");
  assert.equal(requests.length, beforeRestart, "browser restart and next-term lookup must use the saved import");
  await context.setOffline(true);
  await resumed.locator("#campus-date").fill("2026-10-15");
  await resumed.waitForFunction(() => document.querySelector<HTMLInputElement>("#period-1-room")?.value === "M-03");
  await context.setOffline(false);
  console.log("PASS: browser restart, expired IC session, and offline date changes use saved data");

  mode = "error";
  const failedPortal = context.waitForEvent("page");
  await resumed.getByRole("button", { name: "Update saved schedule" }).click();
  await (await failedPortal).goto(`${campusOrigin}/campus/portal/students/paloalto.jsp`);
  await resumed.locator(".campus-sync [role=status]").filter({ hasText: "Campus could not be read" }).waitFor();
  assert.equal(await resumed.locator("#period-1-room").inputValue(), "M-03");
  assert.deepEqual(await resumedWorker.evaluate(async () => (await chrome.storage.local.get("campusImport")).campusImport), saved);
  console.log("PASS: failed update keeps the previous saved import");

  mode = "login";
  const cancelledPortal = context.waitForEvent("page");
  await resumed.getByRole("button", { name: "Update saved schedule" }).click();
  const cancelled = await cancelledPortal;
  await cancelled.goto(`${campusOrigin}/campus/portal/students/paloalto.jsp`);
  await resumed.getByRole("button", { name: "Cancel import" }).click();
  await resumed.locator(".campus-sync [role=status]").filter({ hasText: "Saved on this device" }).waitFor();
  const afterCancel = requests.length;
  await cancelled.getByText("Finish test sign-in").click();
  await cancelled.waitForTimeout(150);
  assert.equal(requests.length, afterCancel, "finishing sign-in after cancellation must not start a new read");
  assert.deepEqual(await resumedWorker.evaluate(async () => (await chrome.storage.local.get("campusImport")).campusImport), saved);
  console.log("PASS: cancelling sign-in keeps the saved import and rejects later navigation");

  const rogue = await context.newPage();
  await rogue.goto(`${campusOrigin}/campus/student-test`);
  const beforeRogue = requests.length;
  mode = "delayed";
  const started = new Promise<void>(done => { readStarted = done; });
  const pendingPortal = context.waitForEvent("page");
  await resumed.getByRole("button", { name: "Update saved schedule" }).click();
  const pending = await pendingPortal;
  await pending.goto(`${campusOrigin}/campus/portal/students/paloalto.jsp`);
  await started;
  await rogue.reload();
  await rogue.waitForTimeout(150);
  assert.equal(requests.length, beforeRogue + 1, "an unrelated Campus tab must not be adopted into the import");
  await resumed.getByRole("button", { name: "Forget Campus import" }).click();
  await resumed.locator(".campus-sync [role=status]").filter({ hasText: "Connect once" }).waitFor();
  release?.();
  await pending.waitForTimeout(300);
  assert.equal((await resumedWorker.evaluate(async () => chrome.storage.local.get("campusImport"))).campusImport, undefined);
  assert.equal(await resumed.getByRole("button", { name: "Forget Campus import" }).count(), 0);
  console.log("PASS: unrelated tabs are rejected and a late result cannot resurrect a forgotten import");
  await context.close();
  context = null;

  // The same static website remains usable without an installed connector.
  const browser = await chromium.launch({ executablePath: await executable(), headless: true,
    args: ["--host-resolver-rules=MAP pausdca.infinitecampus.org ~NOTFOUND, MAP xmccc-glitch.github.io ~NOTFOUND"] });
  try {
    const manualContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const manual = await manualContext.newPage();
    await manual.goto(appUrl);
    await manual.getByText("Import into GunnWatt", { exact: true }).waitFor();
    await manual.locator("#period-1-room").fill("M3");
    await manual.getByRole("button", { name: "Generate Map", exact: false }).click();
    await manual.locator(".generated-map-result img").first().waitFor({ timeout: 30000 });
    await manual.screenshot({ path: join(output, "campus-extension-manual-mobile.png"), fullPage: true });
    console.log("PASS: disconnected manual schedule and narrow layout still generate a map");

    const bookmarklet = await manual.locator(".campus-bookmark-button").getAttribute("href");
    assert.ok(bookmarklet);
    assert.ok(bookmarklet.startsWith("javascript:"));
    assert.doesNotMatch(bookmarklet, /javascript%3Athrow/);
    const ctx = manual.context();
    let bookmarkReads = 0;
    let bookmarkMode: "ready" | "expired" | "delayed" = "ready";
    let unblock: (() => void) | undefined;
    let began: (() => void) | undefined;
    let latestBookmarkRequestId = "";
    ctx.on("request", request => {
      const id = new URL(request.url()).searchParams.get("campus-import");
      if (request.isNavigationRequest() && id) latestBookmarkRequestId = id;
    });
    await ctx.route("https://xmccc-glitch.github.io/**", async route => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith("/GunnMap/")) { await route.abort(); return; }
      const pathname = url.pathname.slice("/GunnMap".length);
      const path = resolve(web, `.${pathname}${pathname.endsWith("/") ? "index.html" : ""}`);
      if (!path.startsWith(web + sep)) { await route.abort(); return; }
      try { await route.fulfill({ contentType: mime[extname(path)] ?? "application/octet-stream", body: await readFile(path) }); }
      catch { await route.fulfill({ status: 404 }); }
    });
    await ctx.route(`${campusOrigin}/**`, async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/campus/student-test") {
        await route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>Synthetic Campus portal</h1>" });
      } else if (url.pathname === "/campus/resources/portal/roster") {
        bookmarkReads++;
        if (bookmarkMode === "delayed") { began?.(); await new Promise<void>(done => { unblock = done; }); }
        await route.fulfill({ status: bookmarkMode === "expired" ? 401 : 200,
          contentType: "application/json", body: JSON.stringify(campusRoster) });
      } else if (url.pathname === "/campus/resources/calendar/instructionalDay") {
        assert.equal(url.searchParams.get("structureID"), "42");
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(campusDays) });
      } else if (url.pathname === "/campus/resources/portal/dayEvent/byEnrollment") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(campusEvents) });
      } else await route.fulfill({ status: 404 });
    });
    const portal = await ctx.newPage();
    await portal.goto(`${campusOrigin}/campus/student-test`);
    const importedOpened = ctx.waitForEvent("page");
    await portal.goto(bookmarklet!).catch(() => undefined);
    const imported = await importedOpened;
    await imported.locator(".campus-sync [role=status]").filter({ hasText: "Saved on this device" }).waitFor();
    await imported.locator("#campus-date").fill("2026-10-15");
    await imported.waitForFunction(() => document.querySelector<HTMLInputElement>("#period-1-room")?.value === "M-03");
    assert.equal(new URL(imported.url()).search, "", "request ID is removed after opening the return tab");
    const localSnapshot = await imported.evaluate(() => localStorage.getItem("gunnwatt_campus_import_v1"));
    assert.ok(localSnapshot);
    assert.doesNotMatch(localSnapshot!, /personID|rosterID|987654|Not exported/);
    assert.equal(bookmarkReads, 1);
    await imported.reload();
    await imported.locator("#campus-date").fill("2027-01-07");
    await imported.waitForFunction(() => document.querySelector<HTMLInputElement>("#period-1-room")?.value === "N-214");
    assert.equal(bookmarkReads, 1, "reloading and changing semesters must use local storage");
    await imported.screenshot({ path: join(output, "campus-bookmark-imported.png"), fullPage: true });
    console.log("PASS: install-free bookmark transfers a projected import between tabs, persists and changes semesters locally");

    bookmarkMode = "expired";
    const expiredOpened = ctx.waitForEvent("page");
    await portal.goto(bookmarklet!).catch(() => undefined);
    const expired = await expiredOpened;
    await expired.locator(".campus-sync [role=status]").filter({ hasText: "Sign in to Campus Student" }).waitFor();
    assert.equal(await expired.evaluate(() => localStorage.getItem("gunnwatt_campus_import_v1")), localSnapshot);
    console.log("PASS: an expired Campus session preserves the previous bookmark import");

    bookmarkMode = "delayed";
    const startedReading = new Promise<void>(done => { began = done; });
    // Exercise the fallback used when the browser blocks an automatic popup.
    await portal.evaluate(() => {
      const open = window.open.bind(window);
      let first = true;
      window.open = (...args: Parameters<typeof window.open>) => { if (first) { first = false; return null; } return open(...args); };
    });
    await portal.goto(bookmarklet!).catch(() => undefined);
    const pendingOpened = ctx.waitForEvent("page");
    await portal.getByRole("button", { name: "Continue to GunnWatt" }).click();
    const pending = await pendingOpened;
    await startedReading;
    await pending.getByRole("button", { name: "Cancel import" }).waitFor();
    assert.ok(latestBookmarkRequestId);
    await pending.evaluate(id => window.postMessage({ channel: "gunnwatt-campus-bookmark-v1", kind: "result", id, data: {} }, location.origin), latestBookmarkRequestId);
    assert.equal(await pending.evaluate(() => localStorage.getItem("gunnwatt_campus_import_v1")), localSnapshot,
      "a message sent by the app itself cannot replace a Campus import");
    await imported.getByRole("button", { name: "Forget Campus import" }).click();
    unblock?.();
    await pending.waitForTimeout(600);
    assert.equal(await pending.getByRole("button", { name: "Forget Campus import" }).count(), 0);
    const forgotten = await pending.evaluate(() => JSON.parse(localStorage.getItem("gunnwatt_campus_import_v1")!));
    assert.equal(forgotten.saved, null);
    await pending.reload();
    assert.equal(await pending.locator("#campus-date").count(), 0);
    console.log("PASS: popup fallback works, unsolicited messages are rejected, and forgetting in another tab rejects an in-flight bookmark result");
  } finally { await browser.close(); }
  console.log("Campus bookmark and extension browser checks passed.");
} catch (error) {
  if (context) {
    for (const [index, page] of context.pages().entries()) {
      const url = new URL(page.url());
      console.log(`Test page ${index}: ${url.origin}${url.pathname}; title=${await page.title().catch(() => "unavailable")}`);
    }
    console.log(`Mocked Campus navigations: ${navigationPaths.length}; API requests: ${requests.length}`);
    const app = context.pages().find(page => page.url().startsWith(appUrl));
    console.log(`App status: ${await app?.locator(".campus-sync [role=status]").textContent().catch(() => "unavailable")}`);
    const sw = context.serviceWorkers()[0];
    if (sw) console.log("Extension state:", await sw.evaluate(async () => {
      const stored = await chrome.storage.local.get("campusImport");
      const session = await chrome.storage.session.get(["job", "lastState"]);
      return { hasSaved: Boolean(stored.campusImport), job: session.job, lastState: session.lastState };
    }));
    const page = context.pages().at(-1);
    await page?.screenshot({ path: join(output, "campus-extension-test-failure.png") }).catch(() => undefined);
  }
  throw error;
} finally {
  release?.();
  await context?.close();
  await new Promise<void>(done => server.close(() => done()));
  await rm(profile, { recursive: true, force: true });
}
