// POST /api/lehrlinge/sync — GAS присылает снапшот таблицы. Авторизация: Bearer SYNC_SECRET.
import crypto from "node:crypto";
import { writeSnapshot } from "../_lib/lehrlinge-store.js";
import { flushOutbox, outboxStats } from "../_lib/lehrlinge-outbox.js";
import { background } from "../_lib/background.js";
import { bearer, fail } from "../_lib/http.js";

export const config = { maxDuration: 30, api: { bodyParser: { sizeLimit: "4mb" } } };

function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const expected = String(process.env.SYNC_SECRET || "");
    if (!expected || !sameSecret(bearer(req), expected)) throw new Error("forbidden");
    const body = req.body || {};
    if (!Array.isArray(body.points) || !Array.isArray(body.students) || !Array.isArray(body.drivers) || !Array.isArray(body.plan)) {
      return res.status(400).json({ ok: false, error: "invalid_snapshot" });
    }
    const result = await writeSnapshot(body);
    // Регулярная синхронизация заодно повторяет зависшие записи водителей.
    background(flushOutbox());
    return res.status(200).json({ ok: true, ...result, outbox: await outboxStats() });
  } catch (error) {
    return fail(res, error);
  }
}
