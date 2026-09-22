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
