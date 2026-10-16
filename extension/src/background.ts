import {
  CAMPUS_CHANNEL, CAMPUS_LOGIN_URL, DEFAULT_APP_URL, isAppUrl, isCampusUrl,
  isCampusCommand, isRecord, isRequestId, parseCampusPeriods, parseSavedCampusImport,
  type CampusConnectionState, type SavedCampusImport,
} from "../../src/domain/campus-contract.js";

interface ImportJob {
  id: string;
  origin: string;
  returnTab: number;
  loginTabs: number[];
  deadline: number;
  phase: "waiting" | "reading";
}
interface StoredImport { origin: string; saved: SavedCampusImport }
interface LastState { origin: string; phase: "idle" | "error"; message: string }
const APP_PATTERNS = ["https://xmccc-glitch.github.io/GunnMap/*", "http://127.0.0.1:8000/*", "http://localhost:8000/*"];
const TIMEOUT_ALARM = "campus-import-timeout";
const LOGIN_TIMEOUT = 15 * 60 * 1000;
let queue: Promise<unknown> = Promise.resolve();

function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => undefined);
  return result;
}

async function readJob(): Promise<ImportJob | null> {
  const { job } = await chrome.storage.session.get("job");
  if (!isRecord(job) || !isRequestId(job.id) || typeof job.origin !== "string"
    || typeof job.returnTab !== "number" || !Number.isSafeInteger(job.returnTab)
    || !Array.isArray(job.loginTabs) || job.loginTabs.length > 12
    || !job.loginTabs.every(id => typeof id === "number" && Number.isSafeInteger(id))
    || typeof job.deadline !== "number" || !Number.isFinite(job.deadline)
    || (job.phase !== "waiting" && job.phase !== "reading")) return null;
  return {
    id: job.id, origin: job.origin, returnTab: job.returnTab, loginTabs: job.loginTabs,
    deadline: job.deadline, phase: job.phase,
  };
}

async function readSaved(): Promise<StoredImport | null> {
  const { campusImport } = await chrome.storage.local.get("campusImport");
  if (!isRecord(campusImport) || typeof campusImport.origin !== "string") return null;
  try {
    return { origin: campusImport.origin, saved: parseSavedCampusImport(campusImport.saved) };
  } catch { return null; }
}

async function stateFor(origin: string): Promise<CampusConnectionState> {
  const [job, stored, session] = await Promise.all([
    readJob(), readSaved(), chrome.storage.session.get("lastState"),
  ]);
  const saved = stored?.origin === origin ? stored.saved : null;
  if (job?.origin === origin) return {
    phase: job.phase, message: job.phase === "reading"
      ? "Reading your schedule on this device…" : "Finish signing in on the official Campus page.", saved,
  };
  const last = session.lastState as LastState | undefined;
  if (last?.origin === origin) return { phase: last.phase, message: last.message, saved };
  return { phase: saved ? "saved" : "idle", message: saved ? "Saved on this device." : "Connect once to import your schedule.", saved };
}

async function notify(origin: string): Promise<void> {
  const tabs = await chrome.tabs.query({ url: APP_PATTERNS });
  await Promise.all(tabs.filter(tab => tab.id !== undefined && tab.url && isAppUrl(tab.url)
    && new URL(tab.url).origin === origin).map(tab => chrome.tabs.sendMessage(tab.id!, {
    channel: CAMPUS_CHANNEL, kind: "changed",
  }).catch(() => undefined)));
}

async function finishJob(job: ImportJob, message?: string): Promise<void> {
  await chrome.storage.session.remove("job");
  await chrome.alarms.clear(TIMEOUT_ALARM);
  if (message) await chrome.storage.session.set({ lastState: { origin: job.origin, phase: "error", message } satisfies LastState });
  else await chrome.storage.session.remove("lastState");
  await notify(job.origin);
}

async function expireJob(): Promise<void> {
  const job = await readJob();
  if (job && job.deadline <= Date.now()) await finishJob(job, "Sign-in timed out. Your saved schedule is still available; connect again when ready.");
}

async function collect(tabId: number): Promise<void> {
  const job = await readJob();
  if (!job || !job.loginTabs.includes(tabId) || job.deadline <= Date.now()) return;
  await chrome.tabs.sendMessage(tabId, {
    channel: CAMPUS_CHANNEL, kind: "collect", jobId: job.id,
  }).catch(() => undefined); // The content script will announce itself when ready.
}

async function connect(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || !tab.url || !isAppUrl(tab.url)) throw new Error("Open GunnWatt before connecting.");
  const previous = await readJob();
  if (previous) throw new Error("An import is already open. Finish it or cancel before starting another.");
  const job: ImportJob = {
    id: crypto.randomUUID(), origin: new URL(tab.url).origin, returnTab: tab.id,
    loginTabs: [], deadline: Date.now() + LOGIN_TIMEOUT, phase: "waiting",
  };
  await chrome.storage.session.set({ job });
  await chrome.storage.session.remove("lastState");
  try {
    const login = await chrome.tabs.create({ url: CAMPUS_LOGIN_URL, active: true });
    if (login.id === undefined) throw new Error("Could not open Campus Student.");
    job.loginTabs.push(login.id);
    await chrome.storage.session.set({ job });
    await chrome.alarms.create(TIMEOUT_ALARM, { when: job.deadline });
    await collect(login.id);
    await notify(job.origin);
  } catch {
    await finishJob(job, "Could not open Campus Student. Try connecting again.");
    throw new Error("Could not open Campus Student.");
  }
}

async function forget(origin: string | null): Promise<void> {
  const [job, stored] = await Promise.all([readJob(), readSaved()]);
  if (job && (origin === null || job.origin === origin)) await finishJob(job);
  if (stored && (origin === null || stored.origin === origin)) {
    await chrome.storage.local.remove("campusImport");
    await notify(stored.origin);
  }
  await chrome.storage.session.remove("lastState");
}

function appSender(sender: chrome.runtime.MessageSender): string | null {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.url || !sender.url
    || !isAppUrl(sender.url) || !isAppUrl(sender.tab.url)
    || new URL(sender.url).origin !== new URL(sender.tab.url).origin) return null;
  return new URL(sender.url).origin;
}

function popupSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("popup.html");
}

async function handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (!isRecord(message) || message.channel !== CAMPUS_CHANNEL) return { ok: false, error: "Unknown request." };
  await expireJob();
  if (message.kind === "page" && isCampusCommand(message.command) && isRequestId(message.requestId)) {
    const origin = appSender(sender);
    if (!origin) return { ok: false, error: "This page cannot access the Campus connector." };
    if (message.command === "connect") await connect(sender.tab!);
    else if (message.command === "forget") await forget(origin);
    else if (message.command === "cancel") {
      const job = await readJob();
      if (job?.origin === origin) await finishJob(job);
    }
    return { ok: true, state: await stateFor(origin) };
  }
  if (message.kind === "popup" && popupSender(sender)) {
    const stored = await readSaved();
    const currentJob = await readJob();
    let origin = currentJob?.origin ?? stored?.origin ?? new URL(DEFAULT_APP_URL).origin;
    if (message.command === "connect") {
      const tabs = await chrome.tabs.query({});
      const candidates = tabs.filter(tab => tab.url && isAppUrl(tab.url));
      let tab = candidates.find(item => item.active) ?? candidates[0];
      if (!tab) tab = { ...await chrome.tabs.create({ url: DEFAULT_APP_URL, active: false }), url: DEFAULT_APP_URL };
      await connect(tab);
      origin = new URL(tab.url ?? DEFAULT_APP_URL).origin;
    } else if (message.command === "forget") await forget(null);
    else if (message.command === "cancel") {
      if (currentJob) await finishJob(currentJob);
    } else if (message.command !== "status") return { ok: false, error: "Unknown request." };
    return { ok: true, state: await stateFor(origin) };
  }
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || sender.tab?.id === undefined
    || !sender.url || !isCampusUrl(sender.url) || !sender.tab.url || !isCampusUrl(sender.tab.url)) {
    return { ok: false, error: "This page cannot collect Campus data." };
  }
  const job = await readJob();
  if (!job || !job.loginTabs.includes(sender.tab.id)) return { ok: false, error: "No import is waiting for this tab." };
  if (message.kind === "ready") {
    await collect(sender.tab.id);
    return { ok: true };
  }
  if (message.jobId !== job.id) return { ok: false, error: "This import was cancelled or replaced." };
  if (message.kind === "reading" || message.kind === "login-required") {
    job.phase = message.kind === "reading" ? "reading" : "waiting";
    await chrome.storage.session.set({ job });
    await notify(job.origin);
  } else if (message.kind === "result") {
    let data;
    try { data = parseCampusPeriods(message.data); }
    catch {
      await finishJob(job, "Campus returned an unsupported schedule. Your previous saved import is unchanged.");
      return { ok: false, error: "Invalid Campus schedule." };
    }
    const saved: SavedCampusImport = { version: 1, imported_at: new Date().toISOString(), data };
    try {
      await chrome.storage.local.set({ campusImport: { origin: job.origin, saved } satisfies StoredImport });
    } catch {
      await finishJob(job, "The schedule could not be saved in this browser. Your previous import is unchanged.");
      return { ok: false, error: "Browser storage is unavailable." };
    }
    await finishJob(job);
    // Return to the initiating app only if that tab still belongs to the approved site.
    const tab = await chrome.tabs.get(job.returnTab).catch(() => null);
    if (tab?.url && isAppUrl(tab.url) && new URL(tab.url).origin === job.origin) {
      await chrome.tabs.update(job.returnTab, { active: true }).catch(() => undefined);
    }
  } else if (message.kind === "failure") {
    await finishJob(job, "Campus could not be read. Open Campus Student to check your schedule, then try again.");
  } else return { ok: false, error: "Unknown request." };
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  void exclusive(() => handle(message, sender)).then(sendResponse).catch(() => {
    sendResponse({ ok: false, error: "The Campus connector could not complete this request. Try again." });
  });
  return true;
});

chrome.tabs.onCreated.addListener(tab => {
  if (tab.id === undefined || tab.openerTabId === undefined) return;
  void exclusive(async () => {
    const job = await readJob();
    if (job && job.loginTabs.includes(tab.openerTabId!) && job.loginTabs.length < 12) {
      job.loginTabs.push(tab.id!);
      await chrome.storage.session.set({ job });
    }
  }).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== "complete" || !tab.url || !isCampusUrl(tab.url)) return;
  void exclusive(() => collect(tabId)).catch(() => undefined);
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === TIMEOUT_ALARM) void exclusive(expireJob).catch(() => undefined);
});

// Schedules stay in this browser profile, outside browser/account sync storage.
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
