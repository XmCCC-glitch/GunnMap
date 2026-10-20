/// <reference path="./worker-configuration.d.ts" />

const visitIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const summarySql = "SELECT total, started_at AS startedAt FROM visit_counter WHERE id = 1";
type Summary = { total: number; startedAt: string };

function reply(request: Request, env: VisitsEnv, body: unknown, status = 200): Response {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  };
  if (request.headers.get("Origin") === env.SITE_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = env.SITE_ORIGIN;
    headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("missing body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        throw new Error("body too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function handleVisitRequest(request: Request, env: VisitsEnv): Promise<Response> {
  const send = (body: unknown, status = 200) => reply(request, env, body, status);
  const path = new URL(request.url).pathname;
  const undoId = path.startsWith("/visits/") ? path.slice("/visits/".length) : null;
  if (path !== "/visits" && !(undoId && visitIdPattern.test(undoId))) return send({ error: "not_found" }, 404);
  if (request.method === "OPTIONS") {
    return request.headers.get("Origin") === env.SITE_ORIGIN ? send(null, 204) : send({ error: "forbidden" }, 403);
  }
  if (undoId ? request.method !== "DELETE" : request.method !== "GET" && request.method !== "POST") {
    return send({ error: "method_not_allowed" }, 405);
  }
  try {
    // Reading the total, including agent checks and monitoring, never increments it.
    if (request.method === "GET") {
      const summary = await env.DB.prepare(summarySql).first<Summary>();
      if (!summary) throw new Error("counter not initialized");
      return send(summary);
    }
    if (request.headers.get("Origin") !== env.SITE_ORIGIN ||
        request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") return send({ error: "forbidden" }, 403);

    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) return send({ error: "forbidden" }, 403);
    const limit = await env.VISIT_LIMITER.limit({ key: ip });
    if (!limit.success) return send({ error: "rate_limited" }, 429);
    let body: unknown;
    try { body = await readBody(request); }
    catch { return send({ error: "invalid_request" }, 400); }
    if (typeof body !== "object" || body === null) return send({ error: "invalid_request" }, 400);
    const { visitId, undoToken, purpose } = body as Record<string, unknown>;
    // Agents reading for a user count normally; development agents can opt out.
    if (!undoId && purpose === "development") {
      return send(await env.DB.prepare(summarySql).first<Summary>());
    }
    const id = undoId ?? visitId;
    if (typeof id !== "string" || !visitIdPattern.test(id) ||
        typeof undoToken !== "string" || !visitIdPattern.test(undoToken)) return send({ error: "invalid_request" }, 400);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(undoToken));
    const undoHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (undoId) {
      // A tombstone also prevents a late/retried opening from restoring a QA visit.
      const result = await env.DB.batch<Summary>([
        env.DB.prepare("INSERT OR IGNORE INTO counted_visits (id, undo_hash, counted_at, excluded) VALUES (?, ?, ?, 1)").bind(id, undoHash, Date.now()),
        env.DB.prepare("UPDATE counted_visits SET excluded = 1 WHERE id = ? AND undo_hash = ? AND excluded = 0").bind(id, undoHash),
        env.DB.prepare(summarySql),
      ]);
      return send({ ...result[2].results[0], removed: result[1].meta.changes });
    }
    const result = await env.DB.batch<Summary>([
      env.DB.prepare("INSERT OR IGNORE INTO counted_visits (id, undo_hash, counted_at) VALUES (?, ?, ?)").bind(id, undoHash, Date.now()),
      env.DB.prepare(summarySql),
    ]);
    return send(result[1].results[0]);
  } catch {
    // Do not log undo capabilities, client IPs, or request bodies.
    return send({ error: "visits_unavailable" }, 503);
  }
}

export default {
  fetch(request, env) { return handleVisitRequest(request, env); },
  async scheduled(_event, env) {
    // Keep only 30 days of random opening IDs and undo hashes. The lifetime total is retained.
    await env.DB.prepare("DELETE FROM counted_visits WHERE counted_at < ?").bind(Date.now() - 30 * 86_400_000).run();
  },
} satisfies ExportedHandler<VisitsEnv>;
