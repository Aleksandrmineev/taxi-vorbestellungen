import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
globalThis.window = {};
globalThis.self = globalThis;
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
const { Api } = await import("../assets/js/api.js");

let calls = [];
let plan = () => new Response("{}", { status: 200 });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  calls.push({ url, init });
  return plan(url, init);
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const isOrders = (c) => c.url.pathname === "/api/orders";
const isGas = (c) => c.url.pathname === "/api/gas";
function fresh() { calls = []; storage.clear(); }

test("reads use the Redis endpoint first (with secret and parameters), GAS is not called", async () => {
  fresh();
  plan = (url) => json({ ok: true, items: [{ id: "101" }], source: "redis" });
  const res = await Api.ordersByDate("2026-09-22", true);
  assert.equal(res.items[0].id, "101");
  assert.equal(calls.length, 1);
  const { url } = calls[0];
  assert.equal(url.origin, "https://taxi-murtal.vercel.app");
  assert.equal(url.searchParams.get("op"), "list");
  assert.equal(url.searchParams.get("date"), "2026-09-22");
  assert.equal(url.searchParams.get("includeAll"), "1");
  assert.equal(url.searchParams.get("secret"), "102030");

  calls = [];
  const todos = await Api.todos(24 * 366);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get("op"), "todos");
  assert.equal(calls[0].url.searchParams.get("hours"), String(24 * 366));
  assert.ok(Array.isArray(todos.items));
});

test("503 (disabled / snapshot missing / Redis down), 404 and network errors fall back to GAS", async () => {
  for (const failure of [
    () => json({ ok: false, error: "orders_disabled" }, 503),
    () => json({ ok: false, error: "snapshot_missing" }, 503),
    () => new Response("not found", { status: 404 }),
    () => json({ ok: false, error: "boom" }, 500),
    () => { throw new TypeError("fetch failed"); },
  ]) {
    fresh();
    plan = (url) => (url.pathname === "/api/orders" ? failure() : json({ ok: true, items: [{ id: "gas" }] }));
    const res = await Api.ordersByDate("2026-09-22");
    assert.equal(res.items[0].id, "gas");
    assert.equal(calls.filter(isOrders).length, 1);
    const gas = calls.filter(isGas);
    assert.equal(gas.length, 1);
    assert.equal(gas[0].url.searchParams.get("action"), "ordersbydate");
    assert.equal(gas[0].url.searchParams.get("date"), "2026-09-22");
    assert.equal(gas[0].url.searchParams.get("includeAll"), "0");
    const todos = await Api.todos(24);
    assert.equal(todos.items[0].id, "gas");
  }
});

test("a slow Redis endpoint is abandoned and GAS is used", async () => {
  fresh();
  plan = (url, init) => (url.pathname === "/api/orders"
    ? new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
    : json({ ok: true, items: [{ id: "gas" }] }));
  const started = Date.now();
  const res = await Api.todos(24);
  assert.equal(res.items[0].id, "gas");
  assert.ok(Date.now() - started < 9000);
});

test("device kill switch mt_orders_redis=off goes straight to GAS", async () => {
  fresh();
  storage.set("mt_orders_redis", "off");
  plan = () => json({ ok: true, items: [{ id: "gas" }] });
  await Api.ordersByDate("2026-09-22");
  assert.equal(calls.filter(isOrders).length, 0);
  assert.equal(calls.filter(isGas).length, 1);
});

/* ---------- Schreiben ---------- */
const orderData = { date: "2026-09-23", time: "08:00", type: "Orts", duration_min: 15, phone: "+43 1", message: "Test" };
const gasBody = (c) => JSON.parse(c.init.body);

test("create goes to Redis with a requestId; GAS is not called", async () => {
  fresh();
  plan = () => json({ ok: true, data: { id: "123", recurrence_count: 1 }, queued: true });
  const res = await Api.createOrder({ ...orderData, requestId: "req-1" });
  assert.equal(res.data.id, "123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get("op"), "create");
  assert.equal(calls[0].init.method, "POST");
  const body = gasBody(calls[0]);
  assert.equal(body.requestId, "req-1");
  assert.equal(body.data.message, "Test");
  assert.equal(body.data.requestId, undefined);
  assert.equal(body.data.type, "Orts");
  assert.ok(body.data.created_by_device);
  // ohne mitgegebene requestId wird eine erzeugt
  calls = [];
  await Api.createOrder({ ...orderData });
  assert.ok(gasBody(calls[0]).requestId.length > 8);
});

test("create: only 'nothing accepted' (503/404/device off) may fall back to GAS", async () => {
  for (const failure of [() => json({ ok: false, error: "orders_disabled" }, 503), () => json({ ok: false, error: "snapshot_missing" }, 503), () => new Response("nf", { status: 404 })]) {
    fresh();
    plan = (url) => (isOrders({ url }) ? failure() : json({ ok: true, data: { id: "gas1", recurrence_count: 1 } }));
    const res = await Api.createOrder({ ...orderData });
    assert.equal(res.data.id, "gas1");
    const gas = calls.filter(isGas);
    assert.equal(gas.length, 1);
    assert.equal(gasBody(gas[0]).action, "create");
    assert.equal(gasBody(gas[0]).data.requestId, undefined);
  }
  fresh();
  storage.set("mt_orders_redis", "off");
  plan = () => json({ ok: true, data: { id: "gas2" } });
  await Api.createOrder({ ...orderData });
  assert.equal(calls.filter(isOrders).length, 0);
  assert.equal(calls.filter(isGas).length, 1);
});

test("create: unclear outcomes (network error, 500) never fall back to GAS, so no duplicate order", async () => {
  for (const failure of [() => { throw new TypeError("fetch failed"); }, () => json({ ok: false, error: "boom" }, 500)]) {
    fresh();
    plan = (url) => (isOrders({ url }) ? failure() : json({ ok: true, data: { id: "gas1" } }));
    await assert.rejects(() => Api.createOrder({ ...orderData, requestId: "r" }), /Verbindung unklar/);
    assert.equal(calls.filter(isGas).length, 0);
    assert.equal(calls.filter(isOrders).length, 1);
  }
});

test("create: business errors are shown as they are (GAS codes), without fallback", async () => {
  fresh();
  plan = () => json({ ok: false, error: "date_and_time_required" }, 400);
  await assert.rejects(() => Api.createOrder({ ...orderData }), /date_and_time_required/);
  assert.equal(calls.filter(isGas).length, 0);
});

test("update and status: any problem falls back to GAS (safe to repeat), with the same payload", async () => {
  for (const failure of [() => json({ ok: false, error: "order_unknown_here" }, 503), () => { throw new TypeError("fetch failed"); }, () => json({ ok: false, error: "boom" }, 500)]) {
    fresh();
    plan = (url) => (isOrders({ url }) ? failure() : json({ ok: true, id: "5" }));
    await Api.updateOrder("5", { ...orderData, message: "neu" });
    let gas = calls.filter(isGas);
    assert.equal(gas.length, 1);
    assert.equal(gasBody(gas[0]).action, "updateorder");
    assert.equal(gasBody(gas[0]).id, "5");
    assert.equal(gasBody(gas[0]).data.message, "neu");

    calls = [];
    await Api.updateStatus("5", "cancelled", "Grund", true);
    gas = calls.filter(isGas);
    assert.equal(gasBody(gas[0]).action, "updatestatus");
    assert.equal(gasBody(gas[0]).status, "cancelled");
    assert.equal(gasBody(gas[0]).allSeries, "1");
  }
});

test("update and status use Redis when available", async () => {
  fresh();
  plan = () => json({ ok: true, queued: true, updated_count: 3 });
  const st = await Api.updateStatus({ id: "7", status: "done", comment: "ok", allSeries: true });
  assert.equal(st.updated_count, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get("op"), "status");
  assert.deepEqual(gasBody(calls[0]), { id: "7", status: "done", comment: "ok", allSeries: true });
  calls = [];
  await Api.updateOrder("7", { ...orderData });
  assert.equal(calls[0].url.searchParams.get("op"), "update");
  assert.equal(gasBody(calls[0]).id, "7");
});
