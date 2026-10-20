import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { test } from "node:test";
import worker, { handleVisitRequest } from "../worker.js";
const id = "a71ed45c-84b5-484f-8c96-24775a267d3d";
const token = "bc0cf302-3db0-4479-a608-340733ad058f";
const otherToken = "9aa76ec4-9820-4c30-a3df-4dffcb9b5b21";
const origin = "https://xmccc-glitch.github.io";

function harness() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new NodeURL("../migrations/0001_visits.sql", import.meta.url), "utf8"));
  class Statement {
    args: SQLInputValue[] = [];
    constructor(readonly sql: string) {}
    bind(...args: SQLInputValue[]) { this.args = args; return this; }
    async first() { return db.prepare(this.sql).get(...this.args) ?? null; }
    async run() { return db.prepare(this.sql).run(...this.args); }
  }
  const env: VisitsEnv = {
    SITE_ORIGIN: origin,
    VISIT_LIMITER: { limit: async () => ({ success: true }) } as VisitsEnv["VISIT_LIMITER"],
    DB: {
      prepare: (sql: string) => new Statement(sql),
      batch: async (statements: Statement[]) => {
        db.exec("BEGIN");
        try {
          const result = statements.map(statement => {
            const query = db.prepare(statement.sql);
            if (statement.sql.startsWith("SELECT")) return { results: query.all(...statement.args) };
            return { results: [], meta: { changes: Number(query.run(...statement.args).changes) } };
          });
          db.exec("COMMIT"); return result;
        } catch (error) { db.exec("ROLLBACK"); throw error; }
      },
    } as unknown as VisitsEnv["DB"],
  };
  const headers = { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" };
  const post = (value: unknown = { visitId: id, undoToken: token }, extra: Record<string, string> = {}) => new Request("https://counter.example/visits", {
    method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(value),
  });
  const undo = (undoToken = token, visitId = id) => new Request(`https://counter.example/visits/${visitId}`, {
    method: "DELETE", headers, body: JSON.stringify({ undoToken }),
  });
  const get = () => new Request("https://counter.example/visits", { headers: { Origin: origin } });
  const count = () => Number(db.prepare("SELECT total FROM visit_counter").get()!.total);
  const send = (request: Request) => handleVisitRequest(request, env);
  return { db, env, post, undo, get, count, send };
}

test("reads and explicit development requests never increment; user-directed agents count", async () => {
  const h = harness();
  try {
    const response = await h.send(h.get());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    const data = await response.json() as { total: number; startedAt: string };
    assert.equal(data.total, 0); assert.ok(Number.isFinite(Date.parse(data.startedAt)));
    await h.send(h.post({ purpose: "development" }));
    assert.equal(h.count(), 0);
    for (const agent of ["Mozilla/5.0", "ChatGPT Agent", "Codex", "HeadlessChrome", "curl/8"]) {
      const result = await h.send(h.post({ visitId: crypto.randomUUID(), undoToken: crypto.randomUUID() }, { "User-Agent": agent }));
      assert.equal(result.status, 200, agent);
    }
    assert.equal(h.count(), 5);
  } finally { h.db.close(); }
});

test("concurrent retries count an opening once and cannot replace its undo capability", async () => {
  const h = harness();
  try {
    const results = await Promise.all(Array.from({ length: 15 }, () => h.send(h.post())));
    assert.ok(results.every(result => result.status === 200)); assert.equal(h.count(), 1);
    await h.send(h.post({ visitId: id, undoToken: otherToken }));
    await h.send(h.undo(otherToken)); assert.equal(h.count(), 1);
    await h.send(h.undo()); assert.equal(h.count(), 0);
  } finally { h.db.close(); }
});

test("undo affects only the matching receipt and is idempotent", async () => {
  const h = harness();
  try {
    await h.send(h.post());
    await h.send(h.post({ visitId: crypto.randomUUID(), undoToken: token }));
    await h.send(h.undo(otherToken)); assert.equal(h.count(), 2);
    const result = await h.send(h.undo());
    assert.equal((await result.json() as { removed: number }).removed, 1);
    assert.equal(h.count(), 1);
    await h.send(h.undo()); assert.equal(h.count(), 1);
    await h.send(h.post()); assert.equal(h.count(), 1, "a retried POST cannot restore an excluded opening");
  } finally { h.db.close(); }
});

test("undo tombstone prevents an interrupted opening from arriving later", async () => {
  const h = harness();
  try {
    await h.send(h.undo()); await h.send(h.post()); assert.equal(h.count(), 0);
  } finally { h.db.close(); }
});

test("origin, input size, token shape and rate limits bound mutations", async () => {
  const h = harness();
  try {
    for (const extra of [{ Origin: "https://evil.example" }, { Origin: "http://localhost:8000" }, { "Content-Type": "text/plain" }] as Record<string, string>[]) {
      assert.equal((await h.send(h.post(undefined, extra))).status, 403);
    }
    for (const value of [null, {}, { visitId: id, undoToken: "bad" }, { visitId: "bad", undoToken: token }, { value: "x".repeat(5000) }]) {
      assert.equal((await h.send(h.post(value))).status, 400);
    }
    h.env.VISIT_LIMITER = { limit: async () => ({ success: false }) } as VisitsEnv["VISIT_LIMITER"];
    assert.equal((await h.send(h.post())).status, 429); assert.equal(h.count(), 0);
  } finally { h.db.close(); }
});

test("pruning receipt metadata preserves the lifetime total and database failures never fabricate zero", async () => {
  const h = harness();
  try {
    await h.send(h.post()); h.db.exec("UPDATE counted_visits SET counted_at = 0");
    await worker.scheduled({} as ScheduledController, h.env);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM counted_visits").get()!.n, 0);
    assert.equal(h.count(), 1);
    h.db.exec("DROP TABLE visit_counter");
    assert.equal((await h.send(h.get())).status, 503);
  } finally { h.db.close(); }
});
