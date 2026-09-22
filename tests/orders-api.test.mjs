process.env.TZ = "Europe/Vienna";
import assert from "node:assert/strict";
import test from "node:test";
import { makeFakeRedis } from "./helpers/fake-redis.mjs";

process.env.ORDERS_REDIS = "on";
process.env.SYNC_SECRET = "sync-secret-for-tests";

const { __setRedisClientForTests } = await import("../api/_lib/redis.js");
const ordersApi = (await import("../api/orders.js")).default;

const fake = makeFakeRedis();
__setRedisClientForTests(fake.client);

async function call({ method = "GET", query = {}, body, headers = {} } = {}) {
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; },
  };
  await ordersApi({ method, query, body, headers }, res);
  return res;
}
const sync = { authorization: `Bearer ${process.env.SYNC_SECRET}` };
const SECRET = "102030";

const order = (id, date, time, status = "open", extra = {}) => ({
  id, created_at: `2026-09-01T08:00:00.000Z`, date, time, type: "Orts", duration_min: 15, phone: "+43 660 1", phone_norm: "+436601",
  message: `Msg ${id}`, rrule: "", until: "", series_id: "", gcal_event_id: "", status, status_comment: "", created_by_name: "x", created_by_device: "y",
  confirmation_sent_at: "", reminder_sent_at: "", ...extra,
});
const snapshot = (orders, builtAt = new Date().toISOString()) => ({ builtAt, orders, usedIds: orders.map((o) => o.id) });
const list = (query) => call({ query: { op: "list", secret: SECRET, ...query } });

function reset() { fake.kv.clear(); fake.state.down = false; }

test("disabled by default: every op answers 503 orders_disabled (client falls back to GAS)", async () => {
  reset();
  delete process.env.ORDERS_REDIS;
  const res = await list({});
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "orders_disabled");
  assert.equal((await call({ method: "POST", query: { op: "sync" }, headers: sync, body: snapshot([]) })).statusCode, 503);
  process.env.ORDERS_REDIS = "on";
});

test("sync needs SYNC_SECRET and a valid body; client ops need the shared secret", async () => {
  reset();
  assert.equal((await call({ method: "POST", query: { op: "sync" }, body: snapshot([]) })).statusCode, 403);
  assert.equal((await call({ method: "POST", query: { op: "sync" }, headers: { authorization: "Bearer nope" }, body: snapshot([]) })).statusCode, 403);
  assert.equal((await call({ method: "POST", query: { op: "sync" }, headers: sync, body: { orders: "x" } })).statusCode, 400);
  assert.equal((await call({ method: "POST", query: { op: "sync" }, headers: sync, body: snapshot([order("101", "2026-09-22", "08:00")]) })).statusCode, 200);
  assert.equal((await call({ query: { op: "list" } })).statusCode, 403);
  assert.equal((await call({ query: { op: "list", secret: "wrong" } })).statusCode, 403);
  assert.equal((await call({ query: { op: "nope", secret: SECRET } })).statusCode, 400);
});

test("list and todos are served from the snapshot with the same shape as GAS", async () => {
  reset();
  const future = new Date(Date.now() + 3 * 3600 * 1000);
  const d = future.toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });
  const t = future.toLocaleTimeString("en-GB", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  await call({ method: "POST", query: { op: "sync" }, headers: sync, body: snapshot([
    order("101", d, t), order("102", d, "23:58", "cancelled"), order("103", "2020-01-01", "08:00"), order("104", d, "00:01", "done"),
  ]) });

  const day = await list({ date: d });
  assert.equal(day.statusCode, 200);
  assert.deepEqual(day.body.items.map((o) => o.id), ["101"]);
  assert.equal(day.body.items[0].phone, "+43 660 1");
  assert.equal(day.body.items[0].vat, undefined);
  assert.equal(day.body.source, "redis");
  assert.deepEqual((await list({ date: d, includeAll: "1" })).body.items.map((o) => o.id).sort(), ["101", "102", "104"]);
  assert.equal((await list({})).body.items.length, 2); // ohne Datum: alle offenen

  const todos = await call({ query: { op: "todos", hours: "24", secret: SECRET } });
  assert.deepEqual(todos.body.items.map((o) => o.id), ["101"]);
  assert.equal(todos.body.items[0].order_id, "101");
  assert.ok(todos.body.items[0].start_iso.endsWith("Z"));
});

test("no snapshot / expired snapshot / Redis down: 503 so the client uses GAS", async () => {
  reset();
  assert.equal((await list({})).body.error, "snapshot_missing");
  await call({ method: "POST", query: { op: "sync" }, headers: sync, body: snapshot([order("101", "2026-09-22", "08:00")]) });
  assert.equal((await list({})).statusCode, 200);
  assert.ok(fake.options.some((o) => o.key === "orders:meta" && o.EX === 1800)); // Snapshot läuft nach 30 Minuten ab
  fake.kv.delete("orders:meta"); // Ablauf simuliert
  assert.equal((await list({})).statusCode, 503);
  fake.state.down = true;
  const down = await list({});
  assert.equal(down.statusCode, 503);
  assert.equal(down.body.error, "store_unavailable");
  fake.state.down = false;
});

test("sync replaces the copy: changed, removed and new orders; status changes from the sheet arrive", async () => {
  reset();
  await call({ method: "POST", query: { op: "sync" }, headers: sync, body: snapshot([order("101", "2026-09-22", "08:00"), order("102", "2026-09-22", "09:00")]) });
  const second = await call({ method: "POST", query: { op: "sync" }, headers: sync, body: snapshot([order("101", "2026-09-22", "08:00", "cancelled"), order("103", "2026-09-22", "10:00")]) });
  assert.equal(second.body.removed, 1);
  const all = await list({ date: "2026-09-22", includeAll: "1" });
  assert.deepEqual(all.body.items.map((o) => [o.id, o.status]), [["101", "cancelled"], ["103", "open"]]);
});
