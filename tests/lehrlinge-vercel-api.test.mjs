// Интеграционный тест /api/lehrlinge/*: Redis заменён in-memory клиентом с API node-redis, GAS — подменой global fetch.
import assert from "node:assert/strict";
import test from "node:test";

process.env.JWT_SECRET = "j".repeat(40);
process.env.SYNC_SECRET = "sync-secret-for-tests";

const { __setClientForTests, outboxStats } = await import("../api/_lib/lehrlinge-store.js");
const { settleBackground } = await import("../api/_lib/background.js");
const { flushOutbox } = await import("../api/_lib/lehrlinge-outbox.js");
const { signJwt, verifyJwt } = await import("../api/_lib/jwt.js");
const { issueDriverJwt } = await import("../api/_lib/driver-jwt.js");
const sync = (await import("../api/lehrlinge/sync.js")).default;
const schedule = (await import("../api/lehrlinge/schedule.js")).default;
const studentPlan = (await import("../api/lehrlinge/student-plan.js")).default;
const planSave = (await import("../api/lehrlinge/plan-save.js")).default;
const session = (await import("../api/lehrlinge/session.js")).default;
const sharedLogin = (await import("../api/lehrlinge/shared-login.js")).default;
const students = (await import("../api/lehrlinge/students.js")).default;

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
  set: (key, value, options) => {
    if (options?.NX && kv.has(key)) return null;
    kv.set(key, String(value));
    setOptions.push(options);
    return "OK";
  },
  del: (key) => (kv.delete(key) ? 1 : 0),
  incr: (key) => { const value = Number(kv.get(key) || 0) + 1; kv.set(key, String(value)); return value; },
  expire: () => 1,
  hGetAll: (key) => Object.fromEntries(kv.get(key) || []),
  hLen: (key) => kv.get(key)?.size || 0,
  hSet: (key, fieldOrFields, value) => {
    const fields = typeof fieldOrFields === "object" ? fieldOrFields : { [fieldOrFields]: value };
    Object.entries(fields).forEach(([f, v]) => hashOf(key).set(f, String(v)));
    return Object.keys(fields).length;
  },
  hDel: (key, fields) => [].concat(fields).reduce((n, f) => n + (kv.get(key)?.delete(f) ? 1 : 0), 0),
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
let gasGate = null; // Promise: пока не выполнен, ответ GAS задерживается
let gasNetworkDown = false;

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href.includes("script.google.com")) {
    const body = JSON.parse(init.body);
    gasCalls.push(body);
    if (gasGate) await gasGate;
    if (gasNetworkDown) throw new TypeError("fetch failed");
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
  await settleBackground();
  assert.equal(gasCalls.length, 1);
  assert.equal(gasCalls[0].action, "driver_plan_save");
  assert.equal(gasCalls[0].serverKey, process.env.SYNC_SECRET);
  assert.equal(JSON.parse(gasCalls[0].driverJson).id, "d1");
  assert.equal(gasCalls[0].updatedBy, "driver:80");

  const plan = await call(studentPlan, { query: { studentId: "anna", from: "2026-09-21", to: "2026-09-25" }, headers: auth() });
  assert.deepEqual(plan.body.items.map((i) => [i.date, i.status, i.updated_by]), [["2026-09-21", "out", "driver:80"]]);
});

test("plan-save: неверные данные не попадают ни в очередь, ни в GAS", async () => {
  kv.clear();
  await call(sync, { method: "POST", headers: syncAuth, body: snapshotBody() });
  await settleBackground();
  gasCalls = [];
  const bad = (row) => call(planSave, { method: "POST", headers: auth(), body: { rows: [row] } });

  assert.equal((await bad({ date: "21.09.2026", student_id: "anna", status: "out" })).statusCode, 400);
  assert.equal((await bad({ date: "2026-09-21", student_id: "nobody", status: "out" })).statusCode, 400);
  assert.equal((await bad({ date: "2026-09-21", student_id: "anna", status: "evil" })).statusCode, 400);
  assert.equal((await call(planSave, { method: "POST", body: { rows: [] } })).statusCode, 401);
  await settleBackground();
  assert.equal(gasCalls.length, 0);
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 0 });
});

async function fresh() {
  kv.clear();
  gasCalls = [];
  gasGate = null;
  gasNetworkDown = false;
  gasReply = () => ({ ok: true, saved: { ok: true, saved: 1 } });
  await call(sync, { method: "POST", headers: syncAuth, body: snapshotBody() });
  await settleBackground();
  gasCalls = [];
}
const save = (rows) => call(planSave, { method: "POST", headers: auth(), body: { rows } });
const annaPlan = () => call(studentPlan, { query: { studentId: "anna", from: "2026-09-21", to: "2026-09-25" }, headers: auth() });

test("plan-save отвечает сразу, не дожидаясь GAS; изменение уже видно в Redis, таблица получает его в фоне", async () => {
  await fresh();
  let release;
  gasGate = new Promise((resolve) => { release = resolve; });

  const res = await save([{ date: "2026-09-21", student_id: "anna", status: "out" }]);
  assert.equal(res.statusCode, 200); // GAS ещё «висит»
  assert.equal((await annaPlan()).body.items[0].status, "out");
  assert.deepEqual(await outboxStats(), { pending: 1, dead: 0 });

  release();
  await settleBackground();
  assert.equal(gasCalls.length, 1);
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 0 });
});

test("сбой сети GAS: запись остаётся в очереди и доходит при следующем сливе (sync)", async () => {
  await fresh();
  gasNetworkDown = true;
  assert.equal((await save([{ date: "2026-09-21", student_id: "anna", status: "back" }])).statusCode, 200);
  await settleBackground();
  assert.deepEqual(await outboxStats(), { pending: 1, dead: 0 });
  assert.equal((await annaPlan()).body.items[0].status, "back");

  gasNetworkDown = false;
  gasCalls = [];
  const synced = await call(sync, { method: "POST", headers: syncAuth, body: snapshotBody({ builtAt: "2026-09-21T06:05:00.000Z" }) });
  assert.equal(synced.body.outbox.pending, 1); // на момент ответа слив ещё идёт в фоне
  await settleBackground();
  assert.equal(gasCalls.length, 1);
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 0 });
});

test("осмысленный отказ GAS: запись уходит в «мёртвые», очередь не крутится вечно", async () => {
  await fresh();
  gasReply = () => ({ ok: false, error: "driver_auth_required" });
  await save([{ date: "2026-09-21", student_id: "anna", status: "none" }]);
  await settleBackground();
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 1 });
  assert.equal(gasCalls.length, 1); // без повторов
});

test("после 8 неудачных попыток запись уходит в «мёртвые»", async () => {
  await fresh();
  gasNetworkDown = true;
  await save([{ date: "2026-09-21", student_id: "anna", status: "out" }]);
  await settleBackground();
  for (let i = 0; i < 7; i++) await flushOutbox();
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 1 });
});

test("две быстрые записи одного ключа: в таблицу уходит последняя, один вызов", async () => {
  await fresh();
  let release;
  gasGate = new Promise((resolve) => { release = resolve; });
  await save([{ date: "2026-09-21", student_id: "anna", status: "out" }]);
  await save([{ date: "2026-09-21", student_id: "anna", status: "back" }]);
  release();
  await settleBackground();
  const sent = gasCalls.flatMap((call) => JSON.parse(call.rows));
  assert.equal(sent[sent.length - 1].status, "back");
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 0 });
  assert.equal((await annaPlan()).body.items[0].status, "back");
});

test("параллельные сливы не дублируются: второй пропускается по блокировке", async () => {
  await fresh();
  let release;
  gasGate = new Promise((resolve) => { release = resolve; });
  await save([{ date: "2026-09-21", student_id: "anna", status: "out" }]);
  await new Promise((resolve) => setTimeout(resolve, 20)); // первый слив держит блокировку
  assert.deepEqual(await flushOutbox(), { skipped: true });
  release();
  await settleBackground();
});

test("снапшот, собранный до фоновой записи, не откатывает изменение водителя", async () => {
  await fresh();
  let release;
  gasGate = new Promise((resolve) => { release = resolve; });
  await save([{ date: "2026-09-21", student_id: "anna", status: "out" }]);

  // Снапшот собран ПОСЛЕ записи водителя (builtAt свежий), но таблица ещё старая: в плане нет строки anna
  const staleButNewer = snapshotBody({ builtAt: new Date(Date.now() + 1000).toISOString(), plan: [] });
  const synced = await call(sync, { method: "POST", headers: syncAuth, body: staleButNewer });
  assert.equal(synced.statusCode, 200);
  assert.equal((await annaPlan()).body.items[0].status, "out");
  release();
  await settleBackground();
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
  assert.ok(setOptions.some((options) => options?.EX === 1800));
});

test("записи в одну и ту же миллисекунду не перезаписывают друг друга в очереди", async () => {
  await fresh();
  const realNow = Date.now;
  Date.now = () => 1790000000000;
  try {
    let release;
    gasGate = new Promise((resolve) => { release = resolve; });
    await save([{ date: "2026-09-21", student_id: "anna", status: "out" }]);
    await save([{ date: "2026-09-21", student_id: "anna", status: "back" }]);
    assert.equal((await outboxStats()).pending, 2);
    release();
    await settleBackground();
  } finally {
    Date.now = realNow;
  }
  const sent = gasCalls.flatMap((c) => JSON.parse(c.rows));
  assert.equal(sent[sent.length - 1].status, "back");
  assert.deepEqual(await outboxStats(), { pending: 0, dead: 0 });
});

/* ---------- Общий пробный доступ учеников ---------- */
const sharedEnv = () => { process.env.SHARED_LOGIN_PASSWORD = "8761"; };
const loginCall = (body, ip = "1.2.3.4") => call(sharedLogin, { method: "POST", headers: { "x-forwarded-for": ip }, body });
const sharedAuth = async () => {
  sharedEnv();
  const res = await loginCall({ login: "lehrlinge", password: "8761" });
  return { authorization: `Bearer ${res.body.jwt}` };
};

test("shared-login: без SHARED_LOGIN_PASSWORD доступ выключен (503)", async () => {
  delete process.env.SHARED_LOGIN_PASSWORD;
  const res = await loginCall({ login: "lehrlinge", password: "8761" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "shared_access_disabled");
});

test("shared-login: верный логин/пароль даёт токен, неверные отклоняются, лимит попыток", async () => {
  await fresh();
  sharedEnv();
  const ok = await loginCall({ login: "Lehrlinge", password: "8761" });
  assert.equal(ok.statusCode, 200);
  assert.equal(verifyJwt(ok.body.jwt).role, "shared");
  assert.equal((await loginCall({ login: "lehrlinge", password: "0000" })).statusCode, 401);
  assert.equal((await loginCall({ login: "admin", password: "8761" })).statusCode, 401);
  // лимит: с одного IP не больше 10 попыток за окно
  for (let i = 0; i < 12; i++) await loginCall({ login: "lehrlinge", password: "x" }, "9.9.9.9");
  const blocked = await loginCall({ login: "lehrlinge", password: "8761" }, "9.9.9.9");
  assert.equal(blocked.statusCode, 429);
  assert.equal((await loginCall({ login: "lehrlinge", password: "8761" }, "5.5.5.5")).statusCode, 200); // другой IP не задет
});

test("общий доступ: список только id+имя, план без адреса, полное расписание запрещено", async () => {
  await fresh();
  const headers = await sharedAuth();
  const list = await call(students, { headers });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.students, [{ id: "anna", name: "Anna A" }, { id: "cara", name: "Cara C" }]);

  const driverList = await call(students, { headers: auth() });
  assert.equal(driverList.body.students[0].address, "Bahnhof 1"); // у водителя адрес остаётся

  const plan = await call(studentPlan, { headers, query: { studentId: "anna", from: "2026-09-21", to: "2026-09-25" } });
  assert.equal(plan.statusCode, 200);
  assert.equal(plan.body.student.name, "Anna A");
  assert.equal(plan.body.student.address, undefined);
  assert.equal(plan.body.driver, undefined);

  const sched = await call(schedule, { headers, query: { from: "2026-09-21", to: "2026-09-22" } });
  assert.equal(sched.statusCode, 403);
  assert.equal((await call(students, {})).statusCode, 401);
});

test("общий доступ: выключатель — после удаления env все токены перестают работать", async () => {
  await fresh();
  const headers = await sharedAuth();
  assert.equal((await call(students, { headers })).statusCode, 200);
  delete process.env.SHARED_LOGIN_PASSWORD;
  assert.equal((await call(students, { headers })).statusCode, 401);
});

test("общий доступ: сохранение идёт через очередь как portal:lehrlinge; сервер проверяет сроки", async () => {
  await fresh();
  const headers = await sharedAuth();
  const put = (date, status = "out") => call(planSave, { method: "POST", headers, body: { rows: [{ date, student_id: "anna", status }] } });

  const future = await put("2099-01-05");
  assert.equal(future.statusCode, 200);
  await settleBackground();
  assert.equal(gasCalls.length, 1);
  assert.equal(JSON.parse(gasCalls[0].driverJson).id, "shared");
  assert.equal(gasCalls[0].updatedBy, "portal:lehrlinge");
  const plan = await call(studentPlan, { headers, query: { studentId: "anna", from: "2099-01-05", to: "2099-01-05" } });
  assert.equal(plan.body.items[0].updated_by, "portal:lehrlinge");

  gasCalls = [];
  const past = await put("2020-01-06", "none"); // прошедший день: и Hin, и Zurück закрыты
  assert.equal(past.statusCode, 400);
  assert.equal(past.body.error, "morning_cutoff_passed");
  const pastBack = await put("2020-01-06", "out"); // «both» -> «out»: меняется только Zurück
  assert.equal(pastBack.body.error, "evening_cutoff_passed");
  await settleBackground();
  assert.equal(gasCalls.length, 0);
  assert.equal((await annaPlanFor("2020-01-06")).body.items.length, 0);

  // Изменение, не меняющее статус (both -> both) в прошлом, срок не нарушает
  assert.equal((await put("2020-01-07", "both")).statusCode, 200);
  // Водитель срок на сервере не проверяется (как раньше)
  const driver = await call(planSave, { method: "POST", headers: auth(), body: { rows: [{ date: "2020-01-06", student_id: "anna", status: "out" }] } });
  assert.equal(driver.statusCode, 200);
  await settleBackground();
});

async function annaPlanFor(date) {
  return call(studentPlan, { query: { studentId: "anna", from: date, to: date }, headers: auth() });
}
