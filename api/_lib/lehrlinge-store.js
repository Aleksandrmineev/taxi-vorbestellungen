// Хранилище Lehrlinge в Redis (соединение по REDIS_URL, node-redis).
//   lehrlinge:snapshot  — JSON { builtAt, points, students, drivers }
//   lehrlinge:plan      — HASH  "date|studentId" -> JSON { status, note, updated_by, updated_at, vat? }
// vat = время записи с Vercel (ms). Синхронизация из таблицы не затирает строки, записанные позже её снапшота.
import { createClient } from "redis";

const SNAPSHOT_KEY = "lehrlinge:snapshot";
const PLAN_KEY = "lehrlinge:plan";
const COMMAND_TIMEOUT_MS = 5000;
const SNAPSHOT_TTL_SEC = 30 * 60;

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
  const existing = (await run((db) => db.hGetAll(PLAN_KEY))) || {};
  const incoming = {};
  const keep = new Set();
  (plan || []).forEach((row) => {
    const key = `${row.date}|${row.student_id}`;
    const current = existing[key] ? parse(existing[key]) : null;
    if (current?.vat && current.vat > builtAtMs) {
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
  const stale = Object.keys(existing).filter((key) => {
    if (incoming[key] || keep.has(key)) return false;
    const current = parse(existing[key]);
    return !(current?.vat && current.vat > builtAtMs);
  });
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
