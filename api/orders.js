// /api/orders?op=… – Vorbestellungen aus der Redis-Kopie (Tabelle bleibt die Wahrheit).
//   op=sync   POST  (Bearer SYNC_SECRET, von GAS)  Snapshot aller Bestellungen
//   op=list   GET   ?date=&includeAll=1            wie GAS ordersbydate
//   op=todos  GET   ?hours=                        wie GAS todos
// Nur aktiv mit ORDERS_REDIS=on in den Vercel-Umgebungsvariablen; sonst 503 und der Client nutzt GAS.
import crypto from "node:crypto";
import { listOrders, todoOrders } from "./_lib/orders-core.js";
import { publicOrder, readOrders, writeSnapshot, outboxStats } from "./_lib/orders-store.js";

export const config = { maxDuration: 30, api: { bodyParser: { sizeLimit: "4mb" } } };

const API_SECRET = "102030"; // gleicher gemeinsamer Wert wie im Client und in GAS

const same = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

export const ordersEnabled = () => process.env.ORDERS_REDIS === "on";

function status(error) {
  const message = String(error?.message || error);
  if (["forbidden"].includes(message)) return 403;
  if (["orders_disabled", "snapshot_missing", "store_not_configured", "store_unavailable"].includes(message)) return 503;
  if (["method_not_allowed"].includes(message)) return 405;
  if (error?.business) return 400;
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
