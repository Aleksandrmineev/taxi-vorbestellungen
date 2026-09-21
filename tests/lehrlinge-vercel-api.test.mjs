// Интеграционный тест /api/lehrlinge/*: Redis заменён in-memory клиентом с API node-redis, GAS — подменой global fetch.
import assert from "node:assert/strict";
import test from "node:test";

process.env.JWT_SECRET = "j".repeat(40);
process.env.SYNC_SECRET = "sync-secret-for-tests";

const { __setClientForTests } = await import("../api/_lib/lehrlinge-store.js");
const { signJwt, verifyJwt } = await import("../api/_lib/jwt.js");
const { issueDriverJwt } = await import("../api/_lib/driver-jwt.js");
const sync = (await import("../api/lehrlinge/sync.js")).default;
const schedule = (await import("../api/lehrlinge/schedule.js")).default;
const studentPlan = (await import("../api/lehrlinge/student-plan.js")).default;
const planSave = (await import("../api/lehrlinge/plan-save.js")).default;
const session = (await import("../api/lehrlinge/session.js")).default;

/* ---------- Эмуляция Redis (подмножество API node-redis) ---------- */
const kv = new Map();
let redisDown = false;
const setOptions = [];

const hashOf = (key) => {
  if (!kv.has(key)) kv.set(key, new Map());
  return kv.get(key);
};

const commands = {
  get: (key) => kv.get(key) ?? null,
  set: (key, value, options) => { kv.set(key, String(value)); setOptions.push(options); return "OK"; },
  hGetAll: (key) => Object.fromEntries(kv.get(key) || []),
  hSet: (key, fields) => { Object.entries(fields).forEach(([f, v]) => hashOf(key).set(f, String(v))); return Object.keys(fields).length; },
  hDel: (key, fields) => fields.reduce((n, f) => n + (kv.get(key)?.delete(f) ? 1 : 0), 0),
};

const fakeRedis = {
  ...Object.fromEntries(Object.entries(commands).map(([name, fn]) => [name, async (...args) => {
    if (redisDown) throw new Error("connection refused");
    return fn(...args);
  }])),
  multi() {
    const queue = [];
    const tx = { exec: async () => { if (redisDown) throw new Error("connection refused"); return queue.map(([n, a]) => commands[n](...a)); } };
    Object.keys(commands).forEach((name) => { tx[name] = (...args) => { queue.push([name, args]); return tx; }; });
    return tx;
  },
  destroy() {},
};
__setClientForTests(fakeRedis);

let gasCalls = [];
let gasReply = () => ({ ok: true, saved: { ok: true, saved: 1 } });

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href.includes("script.google.com")) {
    const body = JSON.parse(init.body);
    gasCalls.push(body);
    return new Response(JSON.stringify(gasReply(body)), { status: 200 });
  }
  throw new Error(`unexpected fetch ${href}`);
};

/* ---------- Хелперы вызова хендлеров ---------- */
async function call(handler, { method = "GET", query = {}, body, headers = {} } = {}) {
  const req = { method, query, body, headers };
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
  await handler(req, res);
  return res;
}

const snapshotBody = (overrides = {}) => ({
  builtAt: "2026-09-21T06:00:00.000Z",
  points: [
    { id: "P1", name: "Bahnhof 1", route: "1", active: "1", url: "", phone: "", arrival_time: "06:10" },
    { id: "P2", name: "Schule 2", route: "1", active: "1", url: "", phone: "", arrival_time: "06:20" },
  ],
  students: [
    { id: "anna", name: "Anna A", pointId: "P1", active: "1" },
    { id: "cara", name: "Cara C", pointId: "P2", active: "1" },
  ],
  drivers: [
    { id: "d1", name: "Max", surname: "Muster", taxiNumber: "80", active: "1" },
    { id: "d2", name: "Off", surname: "Duty", taxiNumber: "12", active: "0" },
  ],
  plan: [{ date: "2026-09-22", student_id: "cara", status: "none", note: "", updated_by: "admin", updated_at: "" }],
  ...overrides,
});

const auth = (driver = { id: "d1", name: "Max", surname: "Muster", taxiNumber: "80" }) => ({
  authorization: `Bearer ${issueDriverJwt(driver)}`,
});
const syncAuth = { authorization: `Bearer ${process.env.SYNC_SECRET}` };

test("JWT: подпись, срок действия и подделка", () => {
  const token = signJwt({ sub: "d1" }, 60);
  assert.equal(verifyJwt(token).sub, "d1");
  assert.throws(() => verifyJwt(token.slice(0, -2) + "xx"), /driver_auth_required/);
  assert.throws(() => verifyJwt(signJwt({ sub: "d1" }, -10)), /driver_auth_required/);
  assert.throws(() => verifyJwt("a.b.c"), /driver_auth_required/);
});

test("sync требует SYNC_SECRET и валидный снапшот", async () => {
  assert.equal((await call(sync, { method: "POST", body: snapshotBody() })).statusCode, 403);
  assert.equal((await call(sync, { method: "POST", headers: { authorization: "Bearer wrong" }, body: snapshotBody() })).statusCode, 403);
  assert.equal((await call(sync, { method: "POST", headers: syncAuth, body: { points: [] } })).statusCode, 400);
  const ok = await call(sync, { method: "POST", headers: syncAuth, body: snapshotBody() });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.plan, 1);
});

test("schedule: без токена 401, с токеном — данные из Redis, неактивный водитель отклонён", async () => {
  await call(sync, { method: "POST", headers: syncAuth, body: snapshotBody() });
  const query = { from: "2026-09-21", to: "2026-09-23", route: "all", direction: "all" };

  assert.equal((await call(schedule, { query })).statusCode, 401);
  assert.equal((await call(schedule, { query, headers: auth({ id: "d2", taxiNumber: "12" }) })).statusCode, 401);

  const res = await call(schedule, { query, headers: auth() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.driver.taxiNumber, "80");
  assert.equal(res.body.students.find((s) => s.id === "anna").address, "Bahnhof 1");
  // 22.09. Cara отменена (plan: none), 21. и 23. — обе едут
  const days = Object.fromEntries(res.body.days.map((d) => [d.date, d]));
  assert.ok(days["2026-09-21"]);
  assert.equal(days["2026-09-22"].routes.every((r) => r.points.every((p) => p.students.every((s) => s.id !== "cara"))), true);
});

test("schedule до первой синхронизации даёт 503 (клиент уйдёт на запасной путь через GAS)", async () => {
  kv.clear();
  const res = await call(schedule, { query: { from: "2026-09-21", to: "2026-09-22" }, headers: auth() });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "snapshot_missing");
});

test("plan-save: пишет в GAS доверенным вызовом, потом обновляет Redis", async () => {
  kv.clear();
  await call(sync, { method: "POST", headers: syncAuth, body: snapshotBody() });
  gasCalls = [];

  const res = await call(planSave, {
    method: "POST",
    headers: auth(),
    body: { rows: [{ date: "2026-09-21", student_id: "anna", status: "out", note: "" }], holidays: [] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(gasCalls.length, 1);
  assert.equal(gasCalls[0].action, "driver_plan_save");
  assert.equal(gasCalls[0].serverKey, process.env.SYNC_SECRET);
  assert.equal(JSON.parse(gasCalls[0].driverJson).id, "d1");
  assert.equal(gasCalls[0].updatedBy, "driver:80");

  const plan = await call(studentPlan, { query: { studentId: "anna", from: "2026-09-21", to: "2026-09-25" }, headers: auth() });
  assert.deepEqual(plan.body.items.map((i) => [i.date, i.status, i.updated_by]), [["2026-09-21", "out", "driver:80"]]);
});

test("plan-save: неверные данные не доходят до GAS; ошибка GAS не меняет Redis", async () => {
  kv.clear();
  await call(sync, { method: "POST", headers: syncAuth, body: snapshotBody() });
  gasCalls = [];
  const bad = (row) => call(planSave, { method: "POST", headers: auth(), body: { rows: [row] } });

  assert.equal((await bad({ date: "21.09.2026", student_id: "anna", status: "out" })).statusCode, 400);
  assert.equal((await bad({ date: "2026-09-21", student_id: "nobody", status: "out" })).statusCode, 400);
  assert.equal((await bad({ date: "2026-09-21", student_id: "anna", status: "evil" })).statusCode, 400);
  assert.equal((await call(planSave, { method: "POST", body: { rows: [] } })).statusCode, 401);
  assert.equal(gasCalls.length, 0);

  gasReply = () => ({ ok: false, error: "morning_cutoff_passed" });
  const failed = await bad({ date: "2026-09-21", student_id: "anna", status: "none" });
  gasReply = () => ({ ok: true, saved: { ok: true, saved: 1 } });
  assert.equal(failed.statusCode, 400); // осмысленная ошибка GAS: клиент не должен повторять через запасной путь
  assert.equal(failed.body.error, "morning_cutoff_passed");
  const plan = await call(studentPlan, { query: { studentId: "anna", from: "2026-09-21", to: "2026-09-25" }, headers: auth() });
  assert.deepEqual(plan.body.items, []);
});

test("sync не затирает запись Vercel, сделанную позже снапшота, но применяет остальное", async () => {
  kv.clear();
  await call(sync, { method: "POST", headers: syncAuth, body: snapshotBody({ builtAt: "2026-09-21T06:00:00.000Z" }) });
  // Запись водителя «сейчас» (vat = now, позже builtAt устаревшего снапшота)
  await call(planSave, { method: "POST", headers: auth(), body: { rows: [{ date: "2026-09-21", student_id: "anna", status: "back" }] } });

  // Снапшот, собранный ДО этой записи, приходит после неё: старое значение для anna, новое для cara
  const stale = snapshotBody({
    builtAt: "2020-01-01T00:00:00.000Z",
    plan: [
      { date: "2026-09-21", student_id: "anna", status: "both", note: "", updated_by: "admin", updated_at: "" },
      { date: "2026-09-22", student_id: "cara", status: "out", note: "", updated_by: "admin", updated_at: "" },
    ],
  });
  const result = await call(sync, { method: "POST", headers: syncAuth, body: stale });
  assert.equal(result.body.kept, 1);

  const anna = await call(studentPlan, { query: { studentId: "anna", from: "2026-09-21", to: "2026-09-25" }, headers: auth() });
  assert.equal(anna.body.items[0].status, "back");
  const cara = await call(studentPlan, { query: { studentId: "cara", from: "2026-09-21", to: "2026-09-25" }, headers: auth() });
  assert.equal(cara.body.items[0].status, "out");
});

test("sync удаляет строки, которых больше нет в таблице", async () => {
  kv.clear();
  await call(sync, { method: "POST", headers: syncAuth, body: snapshotBody() });
  const later = snapshotBody({ builtAt: "2026-09-21T07:00:00.000Z", plan: [] });
  const result = await call(sync, { method: "POST", headers: syncAuth, body: later });
  assert.equal(result.body.removed, 1);
});

test("session: токен GAS обменивается на JWT; недействительный токен даёт 401", async () => {
  gasReply = (body) => body.driverToken === "good"
    ? { ok: true, driver: { id: "d1", name: "Max", surname: "Muster", taxiNumber: "80" } }
    : { ok: false, error: "driver_auth_required" };
  const ok = await call(session, { method: "POST", body: { token: "good" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(verifyJwt(ok.body.jwt).sub, "d1");
  assert.equal((await call(session, { method: "POST", body: { token: "dead" } })).statusCode, 401);
  assert.equal((await call(session, { method: "POST", body: {} })).statusCode, 401);
  gasReply = () => ({ ok: true, saved: { ok: true, saved: 1 } });
});

test("Redis недоступен: schedule даёт 503 store_unavailable (клиент уйдёт на GAS), а не зависает", async () => {
  redisDown = true;
  try {
    const res = await call(schedule, { query: { from: "2026-09-21", to: "2026-09-22" }, headers: auth() });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, "store_unavailable");
    const saved = await call(planSave, { method: "POST", headers: auth(), body: { rows: [{ date: "2026-09-21", student_id: "anna", status: "out" }] } });
    assert.equal(saved.statusCode, 503);
  } finally {
    redisDown = false;
  }
});

test("снапшот пишется с TTL, чтобы отключённая синхронизация не оставляла устаревшие данные", async () => {
  setOptions.length = 0;
  await call(sync, { method: "POST", headers: syncAuth, body: snapshotBody() });
  assert.deepEqual(setOptions, [{ EX: 1800 }]);
});
