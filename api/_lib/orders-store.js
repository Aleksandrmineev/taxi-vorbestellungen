// Redis-Kopie der Bestellungen.
//   orders:items   HASH  id -> JSON (Bestellung; `vat` = Schreibzeit von Vercel, ms)
//   orders:meta    JSON  { builtAt, usedIds }   (TTL: läuft die Synchronisation aus, antwortet Vercel 503 und der Client nutzt GAS)
//   orders:outbox  HASH  Feld -> JSON Operation (noch nicht von der Tabelle bestätigt; siehe orders-outbox.js)
import { parse, run } from "./redis.js";

export const ITEMS_KEY = "orders:items";
export const META_KEY = "orders:meta";
export const OUTBOX_KEY = "orders:outbox";
export const DEAD_KEY = "orders:outbox:dead";
export const LOCK_KEY = "orders:outbox:lock";
export const REQUEST_PREFIX = "orders:req:";
const META_TTL_SEC = 30 * 60;
const LOCK_TTL_SEC = 90;
// Von Vercel jünger als so viel vor dem Snapshot geschriebene Bestellungen überschreibt der Snapshot nicht.
const FRESH_WRITE_MARGIN_MS = 2 * 60 * 1000;
const CHUNK = 400;

export const publicOrder = ({ vat, ...order }) => order;

export async function readOrders() {
  const [rawItems, rawMeta] = await run((db) => Promise.all([db.hGetAll(ITEMS_KEY), db.get(META_KEY)]));
  if (!rawMeta) throw new Error("snapshot_missing");
  return { items: Object.values(rawItems || {}).map(parse), meta: parse(rawMeta), byId: null };
}

export async function readOrderMap() {
  const rawItems = (await run((db) => db.hGetAll(ITEMS_KEY))) || {};
  return new Map(Object.entries(rawItems).map(([id, value]) => [id, parse(value)]));
}

export async function readMeta() {
  const raw = await run((db) => db.get(META_KEY));
  if (!raw) throw new Error("snapshot_missing");
  return parse(raw);
}

export async function readQueuedIds() {
  const raw = (await run((db) => db.hGetAll(OUTBOX_KEY))) || {};
  const ids = new Set();
  Object.values(raw).forEach((value) => (parse(value).ids || []).forEach((id) => ids.add(String(id))));
  return ids;
}

export async function writeSnapshot({ builtAt, orders, usedIds }) {
  const builtAtMs = Date.parse(builtAt) || Date.now();
  const [existingRaw, queued] = await Promise.all([run((db) => db.hGetAll(ITEMS_KEY)), readQueuedIds()]);
  const existing = existingRaw || {};
  const isProtected = (id) => {
    if (queued.has(id)) return true;
    const current = existing[id] ? parse(existing[id]) : null;
    return Boolean(current?.vat && current.vat > builtAtMs - FRESH_WRITE_MARGIN_MS);
  };
  const incoming = {};
  const keep = new Set();
  orders.forEach((order) => {
    const id = String(order.id);
    if (isProtected(id)) keep.add(id);
    else incoming[id] = JSON.stringify(order);
  });
  const stale = Object.keys(existing).filter((id) => !incoming[id] && !keep.has(id) && !isProtected(id));
  const entries = Object.entries(incoming);
  await run(async (db) => {
    for (let i = 0; i < entries.length; i += CHUNK) await db.hSet(ITEMS_KEY, Object.fromEntries(entries.slice(i, i + CHUNK)));
    for (let i = 0; i < stale.length; i += CHUNK) await db.hDel(ITEMS_KEY, stale.slice(i, i + CHUNK));
    await db.set(META_KEY, JSON.stringify({ builtAt, usedIds: usedIds || [] }), { EX: META_TTL_SEC });
  });
  return { orders: entries.length, removed: stale.length, kept: keep.size };
}

// Schreibt Bestellungen (mit vat) nach Redis.
export async function putOrders(orders) {
  if (!orders.length) return;
  const now = Date.now();
  const fields = {};
  orders.forEach((order) => { fields[String(order.id)] = JSON.stringify({ ...order, vat: now }); });
  await run((db) => db.hSet(ITEMS_KEY, fields));
}

/* ---------- Outbox ---------- */
let sequence = 0;
// ops: [{ op, ids, payload }] – Reihenfolge = Reihenfolge der Ausführung
export async function enqueue(ops) {
  if (!ops.length) return;
  const at = Date.now();
  const fields = {};
  ops.forEach((operation) => {
    sequence += 1;
    fields[`${String(at).padStart(14, "0")}-${String(sequence).padStart(6, "0")}-${Math.random().toString(36).slice(2, 8)}`] =
      JSON.stringify({ ...operation, at, attempts: 0 });
  });
  await run((db) => db.hSet(OUTBOX_KEY, fields));
}

export async function readOutbox() {
  const raw = (await run((db) => db.hGetAll(OUTBOX_KEY))) || {};
  return Object.entries(raw).map(([field, value]) => ({ field, ...parse(value) })).sort((a, b) => (a.field < b.field ? -1 : 1));
}

export async function ack(fields) {
  if (fields.length) await run((db) => db.hDel(OUTBOX_KEY, fields));
}

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

export async function acquireLock() {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ok = await run((db) => db.set(LOCK_KEY, token, { NX: true, EX: LOCK_TTL_SEC }));
  return ok ? token : null;
}

export async function releaseLock(token) {
  await run(async (db) => { if ((await db.get(LOCK_KEY)) === token) await db.del(LOCK_KEY); });
}

// Idempotenz für „create“: gleiche requestId -> gleiche Antwort, keine zweite Bestellung.
export async function rememberRequest(requestId, result) {
  await run((db) => db.set(REQUEST_PREFIX + requestId, JSON.stringify(result), { EX: 24 * 60 * 60 }));
}
export async function recallRequest(requestId) {
  const raw = await run((db) => db.get(REQUEST_PREFIX + requestId));
  return raw ? parse(raw) : null;
}

// Nummer für kurze Zeit reservieren (atomar), damit zwei gleichzeitige Bestellungen nie dieselbe Nummer bekommen.
export async function reserveId(id) {
  const ok = await run((db) => db.set(`orders:id:${id}`, "1", { NX: true, EX: 3600 }));
  return Boolean(ok);
}

// GAS hat wegen einer Nummern-Kollision eine neue Nummer vergeben: Redis-Kopie umbenennen.
export async function renameOrders(mapping) {
  const entries = Object.entries(mapping || {});
  if (!entries.length) return;
  const map = await readOrderMap();
  await run(async (db) => {
    for (const [oldId, newId] of entries) {
      const current = map.get(String(oldId));
      if (!current) continue;
      await db.hSet(ITEMS_KEY, String(newId), JSON.stringify({ ...current, id: String(newId), vat: Date.now() }));
      await db.hDel(ITEMS_KEY, String(oldId));
    }
  });
}
