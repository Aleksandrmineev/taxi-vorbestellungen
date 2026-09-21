// Хранилище Lehrlinge в Redis (соединение по REDIS_URL, node-redis).
//   lehrlinge:snapshot  — JSON { builtAt, points, students, drivers }
//   lehrlinge:plan      — HASH  "date|studentId" -> JSON { status, note, updated_by, updated_at, vat? }
// vat = время записи с Vercel (ms). Синхронизация из таблицы не затирает строки, записанные позже её снапшота.
import { randomUUID } from "node:crypto";
import { createClient } from "redis";

const SNAPSHOT_KEY = "lehrlinge:snapshot";
const PLAN_KEY = "lehrlinge:plan";
const COMMAND_TIMEOUT_MS = 5000;
const SNAPSHOT_TTL_SEC = 30 * 60;
const OUTBOX_KEY = "lehrlinge:outbox"; // записи водителей, ещё не подтверждённые таблицей (см. lehrlinge-outbox.js)
const DEAD_KEY = "lehrlinge:outbox:dead"; // отклонённые/безнадёжные записи для разбора
const LOCK_KEY = "lehrlinge:outbox:lock";
const LOCK_TTL_SEC = 90;
// Строки, записанные с Vercel менее чем за это время до сборки снапшота, снапшот не перезаписывает:
// он мог быть собран до того, как фоновая запись дошла до таблицы.
const FRESH_WRITE_MARGIN_MS = 2 * 60 * 1000;

let clientPromise = null;
let injectedClient = null;

// Для тестов: подменяет клиент (объект с тем же API, что у node-redis).
export function __setClientForTests(client) {
  injectedClient = client;
  clientPromise = null;
}

async function connect() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("store_not_configured");
  const client = createClient({
    url,
    socket: { connectTimeout: COMMAND_TIMEOUT_MS, reconnectStrategy: (attempt) => (attempt > 2 ? false : attempt * 100) },
  });
  client.on("error", () => {}); // ошибки приходят через промисы команд; без обработчика процесс упал бы
  await client.connect();
  return client;
}

function getClient() {
  if (injectedClient) return Promise.resolve(injectedClient);
  if (!clientPromise) {
    clientPromise = connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("store_unavailable")), COMMAND_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Выполняет операцию; при сбое соединения (например, после «заморозки» функции) переподключается и повторяет один раз.
async function run(operation) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await withTimeout(getClient().then(operation));
    } catch (error) {
      if (error.message === "store_not_configured") throw error;
      const stale = clientPromise;
      clientPromise = null;
      if (stale) stale.then((client) => client.destroy?.() ?? client.disconnect?.()).catch(() => {});
      if (attempt === 1) throw new Error("store_unavailable");
    }
  }
  throw new Error("store_unavailable");
}

const parse = (value) => (typeof value === "string" ? JSON.parse(value) : value);

export async function readState() {
  const [snapshot, planHash] = await run((db) => Promise.all([db.get(SNAPSHOT_KEY), db.hGetAll(PLAN_KEY)]));
  if (!snapshot) throw new Error("snapshot_missing");
  const plan = new Map();
  Object.entries(planHash || {}).forEach(([key, value]) => plan.set(key, parse(value)));
  return { snapshot: parse(snapshot), plan };
}

export async function writeSnapshot({ builtAt, points, students, drivers, plan }) {
  const builtAtMs = Date.parse(builtAt) || Date.now();
  const [existingRaw, outboxRaw] = await run((db) => Promise.all([db.hGetAll(PLAN_KEY), db.hGetAll(OUTBOX_KEY)]));
  const existing = existingRaw || {};
  // Ключи, ожидающие записи в таблицу: снапшот их не трогает, пока очередь не разберётся.
  const queuedKeys = new Set(Object.values(outboxRaw || {}).map((value) => {
    const { row } = parse(value);
    return `${row.date}|${row.student_id}`;
  }));
  const isProtected = (key) => {
    if (queuedKeys.has(key)) return true;
    const current = existing[key] ? parse(existing[key]) : null;
    return Boolean(current?.vat && current.vat > builtAtMs - FRESH_WRITE_MARGIN_MS);
  };
  const incoming = {};
  const keep = new Set();
  (plan || []).forEach((row) => {
    const key = `${row.date}|${row.student_id}`;
    if (isProtected(key)) {
      keep.add(key);
      return;
    }
    incoming[key] = JSON.stringify({
      status: row.status,
      note: row.note || "",
      updated_by: row.updated_by || "",
      updated_at: row.updated_at || "",
    });
  });
  // Строки, которых больше нет в таблице (или вышли за окно), удаляем — кроме свежих записей с Vercel.
  const stale = Object.keys(existing).filter((key) => !incoming[key] && !keep.has(key) && !isProtected(key));
  await run((db) => {
    const tx = db.multi();
    // TTL: если синхронизацию отключат/сломают, через SNAPSHOT_TTL_SEC Vercel перестанет отдавать устаревшее
    // (ответ 503, клиент уйдёт на запасной путь через GAS). Синхронизация идёт каждые 5 минут.
    tx.set(SNAPSHOT_KEY, JSON.stringify({ builtAt, points, students, drivers }), { EX: SNAPSHOT_TTL_SEC });
    if (Object.keys(incoming).length) tx.hSet(PLAN_KEY, incoming);
    if (stale.length) tx.hDel(PLAN_KEY, stale);
    return tx.exec();
  });
  return { plan: Object.keys(incoming).length, removed: stale.length, kept: keep.size };
}

export async function upsertPlanRows(rows) {
  if (!rows.length) return;
  const now = Date.now();
  const fields = {};
  rows.forEach((row) => {
    fields[`${row.date}|${row.student_id}`] = JSON.stringify({
      status: row.status,
      note: row.note || "",
      updated_by: row.updated_by || "",
      updated_at: row.updated_at || new Date(now).toISOString(),
      vat: now,
    });
  });
  await run((db) => db.hSet(PLAN_KEY, fields));
}

/* ---------- Очередь записи в таблицу (outbox) ---------- */

// entries: [{ row: {date, student_id, status, note}, driver, updatedBy, holidays }]
export async function enqueueOutbox(entries) {
  if (!entries.length) return;
  const at = Date.now();
  const fields = {};
  entries.forEach((entry) => {
    // Уникальный ключ на каждую запись: ack удаляет ровно ту запись, которую отправили,
    // а не более новую с тем же временем.
    const field = `${entry.row.date}|${entry.row.student_id}|${at}|${randomUUID()}`;
    fields[field] = JSON.stringify({ ...entry, at, attempts: 0 });
  });
  await run((db) => db.hSet(OUTBOX_KEY, fields));
}

// Возвращает записи очереди по возрастанию времени: [{ field, row, driver, updatedBy, holidays, at, attempts }]
export async function readOutbox() {
  const raw = (await run((db) => db.hGetAll(OUTBOX_KEY))) || {};
  return Object.entries(raw)
    .map(([field, value]) => ({ field, ...parse(value) }))
    .sort((a, b) => a.at - b.at || (a.field < b.field ? -1 : 1));
}

export async function ackOutbox(fields) {
  if (fields.length) await run((db) => db.hDel(OUTBOX_KEY, fields));
}

// Увеличивает счётчик попыток; при превышении лимита или fatal=true переносит запись в «мёртвые».
export async function retryOrDeadLetter(entries, { fatal = false, reason = "", maxAttempts = 8 } = {}) {
  let dead = 0;
  await run(async (db) => {
    const tx = db.multi();
    entries.forEach((entry) => {
      const { field, ...rest } = entry;
      const attempts = (rest.attempts || 0) + 1;
      if (fatal || attempts >= maxAttempts) {
        tx.hSet(DEAD_KEY, field, JSON.stringify({ ...rest, attempts, reason, deadAt: new Date().toISOString() }));
        tx.hDel(OUTBOX_KEY, field);
        dead += 1;
      } else {
        tx.hSet(OUTBOX_KEY, field, JSON.stringify({ ...rest, attempts }));
      }
    });
    return tx.exec();
  });
  return dead;
}

export async function outboxStats() {
  const [pending, dead] = await run((db) => Promise.all([db.hLen(OUTBOX_KEY), db.hLen(DEAD_KEY)]));
  return { pending, dead };
}

// Блокировка: один «сливатель» очереди за раз, чтобы записи одного ключа доходили до таблицы по порядку.
export async function acquireOutboxLock() {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ok = await run((db) => db.set(LOCK_KEY, token, { NX: true, EX: LOCK_TTL_SEC }));
  return ok ? token : null;
}

export async function releaseOutboxLock(token) {
  await run(async (db) => {
    if ((await db.get(LOCK_KEY)) === token) await db.del(LOCK_KEY);
  });
}

// Простой лимит попыток: не более `limit` обращений с ключом за `windowSec` секунд. Возвращает false, если лимит превышен.
export async function allowAttempt(key, limit, windowSec) {
  const count = await run(async (db) => {
    const value = await db.incr(`lehrlinge:rl:${key}`);
    if (value === 1) await db.expire(`lehrlinge:rl:${key}`, windowSec);
    return value;
  });
  return count <= limit;
}
