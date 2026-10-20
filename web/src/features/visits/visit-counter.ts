const excludeKey = "gunnmap.visits.exclude.v1";
const receiptKey = "gunnmap.visits.receipts.v1";
export type VisitSummary = { total: number; startedAt: string; removed?: number };
type Receipt = { visitId: string; undoToken: string; openedAt: number };
const documentVisits = new WeakMap<Document, Receipt>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function receipts(): Receipt[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(receiptKey) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Receipt => typeof item === "object" && item !== null &&
      typeof item.visitId === "string" && uuid.test(item.visitId) && typeof item.undoToken === "string" &&
      uuid.test(item.undoToken) && typeof item.openedAt === "number");
  } catch { return []; }
}

export function excludedFromVisits(): boolean {
  const mode = new URLSearchParams(location.search).get("stats");
  try {
    if (mode === "off" || mode === "undo") localStorage.setItem(excludeKey, "1");
    else if (mode === "on") localStorage.removeItem(excludeKey);
    return mode === "off" || mode === "undo" || localStorage.getItem(excludeKey) === "1";
  } catch { return true; }
}

async function readSummary(response: Response): Promise<VisitSummary> {
  if (!response.ok) throw new Error("Visits unavailable");
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null) throw new Error("Invalid visit count");
  const { total, startedAt, removed } = value as Record<string, unknown>;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 ||
      typeof startedAt !== "string" || !Number.isFinite(Date.parse(startedAt))) throw new Error("Invalid visit count");
  return { total, startedAt, ...(typeof removed === "number" ? { removed } : {}) };
}

export function observeVisits(options: {
  apiUrl: string; onSummary: (summary: VisitSummary) => void;
  onUnavailable: () => void; onNotice?: (notice: string) => void;
}): () => void {
  const controller = new AbortController();
  const excluded = excludedFromVisits();
  const query = new URLSearchParams(location.search);
  const production = location.origin === "https://xmccc-glitch.github.io" && location.pathname.startsWith("/GunnMap/");
  let started = false;
  let revision = 0;
  const publish = (summary: VisitSummary) => { if (!controller.signal.aborted) options.onSummary(summary); };
  const unavailable = () => { if (!controller.signal.aborted) options.onUnavailable(); };
  const notice = (value: string) => { if (!controller.signal.aborted) options.onNotice?.(value); };
  const request = (url: string, init: RequestInit = {}) => fetch(url, {
    ...init, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
  }).then(readSummary);

  // A late initial read must not overwrite a newer increment or undo.
  void request(options.apiUrl).then(summary => { if (revision === 0) publish(summary); }).catch(() => {
    if (revision === 0) unavailable();
  });
  if (excluded) notice("Development visits excluded");

  const start = async () => {
    if (started || controller.signal.aborted || !production) return;
    if (query.get("stats") === "undo") {
      started = true;
      const list = receipts();
      const requestedId = query.get("visit");
      const receipt = requestedId ? list.find(item => item.visitId === requestedId) : list.at(-1);
      if (!receipt) { notice("No local visit to undo"); return; }
      revision++;
      // Retain the receipt: repeating this URL retries the same idempotent undo.
      const summary = await request(`${options.apiUrl}/${receipt.visitId}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ undoToken: receipt.undoToken }),
      });
      publish(summary);
      notice(summary.removed ? "Development visit removed" : "Visit already excluded, absent, or past the 30-day undo window");
      return;
    }
    if (excluded || document.visibilityState !== "visible") return;
    started = true;
    let receipt = documentVisits.get(document);
    if (!receipt) {
      receipt = { visitId: crypto.randomUUID(), undoToken: crypto.randomUUID(), openedAt: Date.now() };
      // Persist before sending so an interrupted request can still be undone.
      try { localStorage.setItem(receiptKey, JSON.stringify([...receipts(), receipt].slice(-100))); }
      catch { return; }
      documentVisits.set(document, receipt);
    }
    revision++;
    publish(await request(options.apiUrl, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(receipt),
    }));
  };
  // Defer writes past React's discarded StrictMode mount; retries reuse the ID.
  const onVisible = () => { void Promise.resolve().then(start).catch(unavailable); };
  document.addEventListener("visibilitychange", onVisible);
  onVisible();
  return () => {
    controller.abort();
    document.removeEventListener("visibilitychange", onVisible);
  };
}
