// /api/orders?op=… – Vorbestellungen aus der Redis-Kopie (Tabelle bleibt die Wahrheit).
//   op=sync    POST  (Bearer SYNC_SECRET, von GAS)  Snapshot aller Bestellungen
//   op=list    GET   ?date=&includeAll=1            wie GAS ordersbydate
//   op=todos   GET   ?hours=                        wie GAS todos
//   op=create|update|status  POST                   Redis zuerst, Tabelle im Hintergrund
// Lesen nur mit ORDERS_REDIS=on, Schreiben zusätzlich mit ORDERS_REDIS_WRITES=on (Vercel-Umgebung);
// sonst 503 und der Client nutzt GAS.
import crypto from "node:crypto";
import { buildOrders, listOrders, normalizePhone, pickOrderId, todoOrders } from "./_lib/orders-core.js";
import {
  enqueue, outboxStats, publicOrder, putOrders, readMeta, readOrderMap, readOrders, readQueuedIds,
  recallRequest, rememberRequest, reserveId, writeSnapshot,
} from "./_lib/orders-store.js";
import { flushOrdersOutbox } from "./_lib/orders-outbox.js";
import { background } from "./_lib/background.js";

export const config = { maxDuration: 30, api: { bodyParser: { sizeLimit: "4mb" } } };

const API_SECRET = "102030"; // gleicher gemeinsamer Wert wie im Client und in GAS

const same = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

export const ordersEnabled = () => process.env.ORDERS_REDIS === "on";
// Schreiben (anlegen/ändern/Status) separat einschaltbar: erst Lesen beobachten, dann Schreiben.
export const writesEnabled = () => ordersEnabled() && process.env.ORDERS_REDIS_WRITES === "on";
const requireWrites = () => { if (!writesEnabled()) throw new Error("orders_disabled"); };

// Fehler, die der Benutzer beheben kann (gleiche Codes wie in GAS): Antwort 400
const BUSINESS = new Set([
  "date_and_time_required", "invalid_dates", "too_many_dates", "invalid_recurrence", "recurrence_until_required",
  "invalid_recurrence_until", "short_order_id_unavailable", "order_update_invalid", "invalid_status", "invalid_order",
]);
// 503 = „nichts angenommen“: der Client darf den bisherigen GAS-Weg nehmen (auch beim Anlegen, ohne Doppelbestellung)
const NOT_ACCEPTED = new Set(["orders_disabled", "snapshot_missing", "store_not_configured", "store_unavailable", "order_unknown_here"]);

function status(error) {
  const message = String(error?.message || error);
  if (message === "forbidden") return 403;
  if (NOT_ACCEPTED.has(message)) return 503;
  if (message === "method_not_allowed") return 405;
  if (error?.business || BUSINESS.has(message)) return 400;
  return 500;
}

export function fail(res, error) {
  const message = String(error?.message || error || "error");
  return res.status(status(error)).json({ ok: false, error: message });
}

export function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,x-api-secret");
  if (req.method === "OPTIONS") { res.status(200).end(); return true; }
  return false;
}

export function requireClient(req) {
  const given = req.query?.secret || req.headers["x-api-secret"] || req.body?.secret || "";
  if (!same(given, API_SECRET)) throw new Error("forbidden");
}

export function requireSync(req) {
  const expected = String(process.env.SYNC_SECRET || "");
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !same(given, expected)) throw new Error("forbidden");
}

const handlers = {
  async sync(req, res) {
    if (req.method !== "POST") throw new Error("method_not_allowed");
    requireSync(req);
    const body = req.body || {};
    if (!Array.isArray(body.orders)) return res.status(400).json({ ok: false, error: "invalid_snapshot" });
    const result = await writeSnapshot({ builtAt: body.builtAt, orders: body.orders, usedIds: body.usedIds });
    background(flushOrdersOutbox()); // regelmäßige Synchronisation wiederholt auch hängende Schreibvorgänge
    return res.status(200).json({ ok: true, ...result, outbox: await outboxStats() });
  },

  async list(req, res) {
    if (req.method !== "GET") throw new Error("method_not_allowed");
    requireClient(req);
    const { items, meta } = await readOrders();
    res.setHeader("Cache-Control", "no-store");
    const includeAll = String(req.query.includeAll || "") === "1";
    return res.status(200).json({ ok: true, items: listOrders(items, req.query.date || "", includeAll).map(publicOrder), syncedAt: meta.builtAt, source: "redis" });
  },

  async todos(req, res) {
    if (req.method !== "GET") throw new Error("method_not_allowed");
    requireClient(req);
    const { items, meta } = await readOrders();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, items: todoOrders(items, Number(req.query.hours || 24)).map(publicOrder), syncedAt: meta.builtAt, source: "redis" });
  },
};

const sha = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const asBool = (value) => value === true || value === "1" || value === "true";

Object.assign(handlers, {
  // Anlegen: Redis + Warteschlange, Antwort sofort; die Tabelle bekommt die Bestellung im Hintergrund (idempotent).
  async create(req, res) {
    if (req.method !== "POST") throw new Error("method_not_allowed");
    requireClient(req);
    requireWrites();
    const { data, requestId } = req.body || {};
    if (!data || typeof data !== "object") throw Object.assign(new Error("invalid_order"), { business: true });
    await readMeta(); // ohne frische Kopie nichts annehmen (503 -> Client nutzt GAS)

    const hash = sha(JSON.stringify(data));
    if (requestId) {
      const prior = await recallRequest(String(requestId));
      if (prior && prior.hash === hash) return res.status(200).json({ ...prior.result, replay: true });
    }

    const [map, meta, queued] = await Promise.all([readOrderMap(), readMeta(), readQueuedIds()]);
    const used = new Set([...map.keys(), ...(meta.usedIds || []), ...queued]);
    const items = buildOrders(data, { usedIds: used });
    for (const item of items) {
      while (!(await reserveId(item.id))) { used.add(item.id); item.id = pickOrderId(used); }
    }
  
    await enqueue([{ op: "import", ids: items.map((item) => item.id), payload: { items } }]);
    // Ab hier ist die Bestellung angenommen: nie mehr 5xx antworten (sonst würde der Client doppelt anlegen).
    const result = { ok: true, data: { ...items[0], recurrence_count: items.length }, queued: true };
    try {
      await putOrders(items);
      if (requestId) await rememberRequest(String(requestId), { hash, result });
    } catch { /* Kopie holt sich die nächste Synchronisation */ }
    background(flushOrdersOutbox());
    return res.status(200).json(result);
  },

  async update(req, res) {
    if (req.method !== "POST") throw new Error("method_not_allowed");
    requireClient(req);
    requireWrites();
    const { id, data = {} } = req.body || {};
    const orderId = String(id || "").trim();
    const date = String(data.date || "").trim();
    const time = String(data.time || "").trim();
    if (!orderId || !date || !time) throw Object.assign(new Error("order_update_invalid"), { business: true });
    await readMeta();
    const current = (await readOrderMap()).get(orderId);
    if (!current) throw new Error("order_unknown_here"); // vielleicht nur in der Tabelle: GAS entscheidet
    const updated = {
      ...current, date, time, type: String(data.type || "Orts"), duration_min: Number(data.duration_min || 15),
      phone: String(data.phone || data.phone_raw || "").trim(), phone_norm: normalizePhone(data.phone || data.phone_raw || ""),
      message: String(data.message || "").trim(),
    };
    if (current.date !== date || current.time !== time) updated.reminder_sent_at = "";
    await enqueue([{ op: "update", ids: [orderId], payload: { id: orderId, data: {
      date, time, type: updated.type, duration_min: updated.duration_min, phone: updated.phone, message: updated.message,
    } } }]);
    try { await putOrders([updated]); } catch { /* siehe create */ }
    background(flushOrdersOutbox());
    return res.status(200).json({ ok: true, data: { id: orderId, date, time }, queued: true });
  },

  async status(req, res) {
    if (req.method !== "POST") throw new Error("method_not_allowed");
    requireClient(req);
    requireWrites();
    const { id, comment = "" } = req.body || {};
    const newStatus = String(req.body?.status || "").toLowerCase();
    if (!["done", "cancelled", "open"].includes(newStatus)) throw Object.assign(new Error("invalid_status"), { business: true });
    await readMeta();
    const map = await readOrderMap();
    const current = map.get(String(id || ""));
    if (!current) throw new Error("order_unknown_here");
    const allSeries = asBool(req.body?.allSeries);
    const targets = allSeries && current.series_id ? [...map.values()].filter((o) => o.series_id === current.series_id) : [current];
    await enqueue([{ op: "status", ids: targets.map((o) => o.id), payload: { id: String(id), status: newStatus, comment: String(comment), allSeries } }]);
    try { await putOrders(targets.map((o) => ({ ...o, status: newStatus, status_comment: String(comment) }))); } catch { /* siehe create */ }
    background(flushOrdersOutbox());
    return res.status(200).json({ ok: true, id: String(id), status: newStatus, comment: String(comment), updated_count: targets.length, queued: true });
  },
});

export async function dispatch(req, res, extra = {}) {
  const table = { ...handlers, ...extra };
  try {
    if (!ordersEnabled()) throw new Error("orders_disabled");
    const op = String(req.query?.op || "");
    if (!table[op]) return res.status(400).json({ ok: false, error: "unknown_op" });
    return await table[op](req, res);
  } catch (error) {
    return fail(res, error);
  }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  return dispatch(req, res);
}
