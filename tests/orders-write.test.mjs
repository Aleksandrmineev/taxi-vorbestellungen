process.env.TZ = "Europe/Vienna";
import assert from "node:assert/strict";
import test from "node:test";
import { makeFakeRedis } from "./helpers/fake-redis.mjs";

process.env.ORDERS_REDIS = "on";
process.env.SYNC_SECRET = "sync-secret-for-tests";

const { __setRedisClientForTests } = await import("../api/_lib/redis.js");
const { settleBackground } = await import("../api/_lib/background.js");
const { flushOrdersOutbox } = await import("../api/_lib/orders-outbox.js");
const { outboxStats } = await import("../api/_lib/orders-store.js");
const ordersApi = (await import("../api/orders.js")).default;

const fake = makeFakeRedis();
__setRedisClientForTests(fake.client);

/* ---- GAS-Ersatz (global fetch) ---- */
let gasCalls = [];
let gasReply = () => ({ ok: true });
let gasGate = null;
let gasDown = false;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).includes("script.google.com")) throw new Error(`unexpected fetch ${url}`);
  const body = JSON.parse(init.body);
  gasCalls.push(body);
  if (gasGate) await gasGate;
  if (gasDown) throw new TypeError("fetch failed");
  return new Response(JSON.stringify(gasReply(body)), { status: 200 });
};

async function call({ method = "GET", query = {}, body } = {}) {
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; }, end() { return this; },
  };
  await ordersApi({ method, query, body, headers: {} }, res);
  return res;
}
const SECRET = "102030";
const post = (op, body) => call({ method: "POST", query: { op, secret: SECRET }, body });
const list = (query = {}) => call({ query: { op: "list", secret: SECRET, ...query } });
const day = (offset = 1) => new Date(Date.now() + offset * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });

const baseOrder = (id, date, extra = {}) => ({
  id, created_at: "2026-09-01T08:00:00.000Z", date, time: "08:00", type: "Orts", duration_min: 15, phone: "+43 660 1", phone_norm: "+436601",
  message: `Msg ${id}`, rrule: "", until: "", series_id: "", gcal_event_id: "", status: "open", status_comment: "", created_by_name: "x", created_by_device: "y",
  confirmation_sent_at: "", reminder_sent_at: "", ...extra,
});
async function seed(orders = [], builtAt = new Date().toISOString()) {
  fake.kv.clear(); fake.state.down = false; gasCalls = []; gasReply = () => ({ ok: true }); gasGate = null; gasDown = false;
  const res = await call({
    method: "POST", query: { op: "sync" }, body: { builtAt, orders, usedIds: orders.map((o) => o.id) },
  }); // (ohne Bearer -> 403; siehe unten: eigener Aufruf mit Header)
  return res;
}
async function seedOk(orders = [], builtAt = new Date().toISOString()) {
  fake.kv.clear(); fake.state.down = false; gasCalls = []; gasReply = () => ({ ok: true }); gasGate = null; gasDown = false;
  const res = { statusCode: 200, headers: {}, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; }, end() { return this; } };
  await ordersApi({ method: "POST", query: { op: "sync" }, headers: { authorization: `Bearer ${process.env.SYNC_SECRET}` }, body: { builtAt, orders, usedIds: orders.map((o) => o.id) } }, res);
  await settleBackground();
  gasCalls = [];
  assert.equal(res.statusCode, 200);
}
const createData = (date, extra = {}) => ({ date, time: "08:00", type: "Orts", duration_min: 15, phone: "+43 660 2", message: "Neu", created_by_name: "Fahrer", created_by_device: "dev1", ...extra });

test("create answers at once, the order is in the list immediately and reaches the sheet in the background", async () => {
  await seedOk([baseOrder("101", day(2))]);
  let release;
  gasGate = new Promise((resolve) => { release = resolve; });
  const res = await post("create", { data: createData(day(1)), requestId: "r1" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.recurrence_count, 1);
  assert.equal(res.body.data.status, "open");
  const id = res.body.data.id;
  assert.match(id, /^\d{3}$/);
  assert.ok(!["101"].includes(id));
  // GAS hängt noch: trotzdem schon sichtbar und in der Warteschlange
  assert.ok((await list({ date: day(1) })).body.items.some((o) => o.id === id && o.message === "Neu"));
  assert.deepEqual(await outboxStats(), { pending: 1, dead: 0 });
  release();
  await settleBackground();
  assert.equal(gasCalls.length, 1);
  assert.equal(gasCalls[0].action, "orders_import");
  assert.equal(gasCalls[0].serverKey, process.env.SYNC_SECRET);
  assert.equal(JSON.parse(gasCalls[0].items)[0].id, id);
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 0 });
});

test("the same requestId never creates a second order (idempotent retry); changed data does", async () => {
  await seedOk();
  const first = await post("create", { data: createData(day(1)), requestId: "same" });
  await settleBackground();
  const second = await post("create", { data: createData(day(1)), requestId: "same" });
  assert.equal(second.body.replay, true);
  assert.equal(second.body.data.id, first.body.data.id);
  await settleBackground();
  assert.equal(gasCalls.filter((c) => c.action === "orders_import").length, 1);
  assert.equal((await list({ date: day(1) })).body.items.length, 1);
  const changed = await post("create", { data: createData(day(1), { message: "Anders" }), requestId: "same" });
  assert.notEqual(changed.body.data.id, first.body.data.id);
  await settleBackground();
  assert.equal((await list({ date: day(1) })).body.items.length, 2);
});

test("several days and a weekly series: one import call, unique ids, shared series id", async () => {
  await seedOk();
  const multi = await post("create", { data: createData(day(1), { dates: [day(3), day(1), day(2)] }), requestId: "m" });
  assert.equal(multi.body.data.recurrence_count, 3);
  await settleBackground();
  const imported = JSON.parse(gasCalls.find((c) => c.action === "orders_import").items);
  assert.equal(imported.length, 3);
  assert.equal(new Set(imported.map((o) => o.id)).size, 3);
  assert.equal(new Set(imported.map((o) => o.series_id)).size, 1);
  assert.ok(imported[0].series_id.startsWith("s_"));
  assert.deepEqual(imported.map((o) => o.date), [day(1), day(2), day(3)]);

  gasCalls = [];
  const weekly = await post("create", { data: createData(day(1), { rrule: "WEEKLY", until: day(15) }), requestId: "w" });
  assert.equal(weekly.body.data.recurrence_count, 3);
  await settleBackground();
  assert.equal(JSON.parse(gasCalls[0].items).length, 3);
});

test("ids are unique against the snapshot, the sheet's used ids and parallel requests", async () => {
  const existing = Array.from({ length: 300 }, (_, i) => baseOrder(String(100 + i), day(5)));
  await seedOk(existing);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => post("create", { data: createData(day(1), { message: `P${i}` }), requestId: `p${i}` })));
  const ids = results.map((r) => r.body.data.id);
  assert.equal(new Set(ids).size, 12);
  const used = new Set(existing.map((o) => o.id));
  ids.forEach((id) => assert.ok(!used.has(id), id));
  await settleBackground();
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 0 });
});

test("update and status show up immediately and are forwarded in order (create -> update -> status)", async () => {
  await seedOk();
  gasDown = true; // GAS nicht erreichbar: die Reihenfolge muss trotzdem erhalten bleiben
  const created = await post("create", { data: createData(day(2)), requestId: "u1" });
  const id = created.body.data.id;
  await settleBackground();
  const upd = await post("update", { id, data: { date: day(3), time: "09:30", type: "KT", duration_min: 120, phone: "+43 1", message: "Geändert" } });
  assert.equal(upd.statusCode, 200);
  const st = await post("status", { id, status: "cancelled", comment: "Kunde storniert" });
  assert.equal(st.body.updated_count, 1);
  await settleBackground();
  // sofort sichtbar
  const all = (await list({ date: day(3), includeAll: "1" })).body.items.find((o) => o.id === id);
  assert.equal(all.time, "09:30"); assert.equal(all.type, "KT"); assert.equal(all.message, "Geändert"); assert.equal(all.status, "cancelled");
  assert.equal((await list({ date: day(3) })).body.items.length, 0); // storniert: aus der offenen Liste
  assert.deepEqual(await outboxStats(), { pending: 3, dead: 0 });

  gasDown = false; gasCalls = [];
  await flushOrdersOutbox();
  assert.deepEqual(gasCalls.map((c) => c.action), ["orders_import", "updateorder", "updatestatus"]);
  assert.equal(gasCalls[1].id, id); assert.equal(gasCalls[1].data.time, "09:30");
  assert.equal(gasCalls[2].status, "cancelled"); assert.equal(gasCalls[2].comment, "Kunde storniert"); assert.equal(gasCalls[2].allSeries, "0");
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 0 });
});

test("status for a whole series changes every order of the series", async () => {
  await seedOk();
  const created = await post("create", { data: createData(day(1), { dates: [day(1), day(2), day(3)] }), requestId: "s1" });
  await settleBackground();
  gasCalls = [];
  const items = (await list({ includeAll: "1" })).body.items;
  const one = items.find((o) => o.date === day(2));
  const st = await post("status", { id: one.id, status: "cancelled", comment: "Serie storniert", allSeries: "1" });
  assert.equal(st.body.updated_count, 3);
  await settleBackground();
  assert.equal((await list({})).body.items.length, 0);
  assert.equal(gasCalls[0].allSeries, "1");
  const single = await post("status", { id: one.id, status: "open" });
  assert.equal(single.body.updated_count, 1);
});

test("unknown order: 503 order_unknown_here (client asks GAS), validation errors are 400 with GAS codes", async () => {
  await seedOk([baseOrder("101", day(2))]);
  const unknown = await post("update", { id: "999", data: { date: day(1), time: "08:00" } });
  assert.equal(unknown.statusCode, 503);
  assert.equal(unknown.body.error, "order_unknown_here");
  assert.equal((await post("status", { id: "999", status: "done" })).statusCode, 503);

  const cases = [
    [post("create", { data: { date: day(1) } }), "date_and_time_required"],
    [post("create", { data: createData(day(1), { dates: ["x"] }) }), "invalid_dates"],
    [post("create", { data: createData(day(1), { rrule: "WEEKLY" }) }), "recurrence_until_required"],
    [post("create", { data: createData(day(1), { rrule: "MONTHLY", until: day(9) }) }), "invalid_recurrence"],
    [post("create", {}), "invalid_order"],
    [post("update", { id: "101", data: { date: day(1) } }), "order_update_invalid"],
    [post("status", { id: "101", status: "weird" }), "invalid_status"],
  ];
  for (const [promise, code] of cases) {
    const res = await promise;
    assert.equal(res.statusCode, 400, code);
    assert.equal(res.body.error, code);
  }
  await settleBackground();
  assert.equal(gasCalls.length, 0);
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 0 });
});

test("transient GAS failures keep the write pending and a later flush delivers it once; sync triggers the retry", async () => {
  await seedOk();
  gasDown = true;
  const created = await post("create", { data: createData(day(1)), requestId: "t1" });
  assert.equal(created.statusCode, 200); // angenommen, auch wenn GAS gerade nicht antwortet
  await settleBackground();
  assert.deepEqual(await outboxStats(), { pending: 1, dead: 0 });
  gasDown = false; gasCalls = [];
  const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; }, end() { return this; } };
  await ordersApi({ method: "POST", query: { op: "sync" }, headers: { authorization: `Bearer ${process.env.SYNC_SECRET}` }, body: { builtAt: new Date().toISOString(), orders: [], usedIds: [] } }, res);
  await settleBackground();
  assert.equal(gasCalls.filter((c) => c.action === "orders_import").length, 1);
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 0 });
  // Die Bestellung bleibt trotz Snapshot ohne sie sichtbar (geschützt), bis die Tabelle sie enthält
  assert.equal((await list({ date: day(1) })).body.items.length, 1);
});

test("wrong SYNC_SECRET in GAS ('forbidden') is retried, never thrown away; a fatal GAS answer goes to the dead list and does not block the rest", async () => {
  await seedOk();
  gasReply = () => ({ ok: false, error: "forbidden" });
  await post("create", { data: createData(day(1)), requestId: "f1" });
  await settleBackground();
  assert.deepEqual(await outboxStats(), { pending: 1, dead: 0 });

  gasReply = (b) => (b.action === "orders_import" ? { ok: false, error: "invalid_order" } : { ok: true });
  await flushOrdersOutbox();
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 1 });

  await seedOk();
  const a = await post("create", { data: createData(day(1), { message: "A" }), requestId: "a" });
  await settleBackground();
  gasReply = (b) => (b.action === "updateorder" ? { ok: false, error: "order_not_found" } : { ok: true });
  await post("update", { id: a.body.data.id, data: { date: day(1), time: "10:00", message: "A2" } });
  await post("status", { id: a.body.data.id, status: "done" });
  await settleBackground();
  await flushOrdersOutbox();
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 1 }); // nur das Ändern war endgültig fehlgeschlagen
  assert.ok(gasCalls.some((c) => c.action === "updatestatus")); // Status kam trotzdem durch
});

test("after 8 failed attempts an entry goes to the dead list", async () => {
  await seedOk();
  gasDown = true;
  await post("create", { data: createData(day(1)), requestId: "d1" });
  await settleBackground();
  for (let i = 0; i < 7; i++) await flushOrdersOutbox();
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 1 });
});

test("id collision in the sheet: GAS returns a new id and the Redis copy is renamed", async () => {
  await seedOk();
  gasReply = (b) => {
    if (b.action !== "orders_import") return { ok: true };
    const ids = JSON.parse(b.items).map((o) => o.id);
    return { ok: true, imported: 1, skipped: [], renamed: { [ids[0]]: "9001" } };
  };
  const created = await post("create", { data: createData(day(1)), requestId: "c1" });
  const oldId = created.body.data.id;
  await settleBackground();
  const items = (await list({ date: day(1) })).body.items;
  assert.deepEqual(items.map((o) => o.id), ["9001"]);
  assert.ok(!items.some((o) => o.id === oldId));
});

test("a snapshot never overwrites pending or very fresh writes, but later corrects the copy from the sheet", async () => {
  await seedOk([baseOrder("101", day(2))]);
  gasDown = true;
  await post("status", { id: "101", status: "cancelled", comment: "x" });
  await settleBackground();
  const stale = { builtAt: new Date().toISOString(), orders: [baseOrder("101", day(2))], usedIds: ["101"] }; // Tabelle kennt die Stornierung noch nicht
  const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; }, end() { return this; } };
  await ordersApi({ method: "POST", query: { op: "sync" }, headers: { authorization: `Bearer ${process.env.SYNC_SECRET}` }, body: stale }, res);
  await settleBackground();
  assert.equal((await list({ date: day(2), includeAll: "1" })).body.items[0].status, "cancelled"); // geschützt
  // GAS geht wieder, Schreibvorgang kommt an; ein viel späterer Snapshot gilt wieder als Wahrheit
  gasDown = false;
  await flushOrdersOutbox();
  const later = { builtAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), orders: [baseOrder("101", day(2), { status: "done" })], usedIds: ["101"] };
  await ordersApi({ method: "POST", query: { op: "sync" }, headers: { authorization: `Bearer ${process.env.SYNC_SECRET}` }, body: later }, res);
  await settleBackground();
  assert.equal((await list({ date: day(2), includeAll: "1" })).body.items[0].status, "done");
});

test("Redis down / no snapshot / disabled: writes answer 503 before anything is accepted (client may use GAS)", async () => {
  await seedOk();
  fake.state.down = true;
  const down = await post("create", { data: createData(day(1)), requestId: "x" });
  assert.equal(down.statusCode, 503);
  assert.equal(down.body.error, "store_unavailable");
  fake.state.down = false;
  fake.kv.delete("orders:meta");
  const missing = await post("create", { data: createData(day(1)), requestId: "y" });
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.body.error, "snapshot_missing");
  await seedOk();
  delete process.env.ORDERS_REDIS;
  const off = await post("create", { data: createData(day(1)) });
  assert.equal(off.statusCode, 503);
  assert.equal(off.body.error, "orders_disabled");
  process.env.ORDERS_REDIS = "on";
  await settleBackground();
  assert.equal(gasCalls.length, 0);
  assert.equal(fake.kv.get("orders:outbox")?.size || 0, 0);
});

test("writes need the shared secret", async () => {
  await seedOk();
  const res = await call({ method: "POST", query: { op: "create" }, body: { data: createData(day(1)) } });
  assert.equal(res.statusCode, 403);
  const bad = await call({ method: "POST", query: { op: "create", secret: "x" }, body: { data: createData(day(1)) } });
  assert.equal(bad.statusCode, 403);
});
