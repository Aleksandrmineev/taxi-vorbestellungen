// Sendet die Redis-Schreibvorgänge (Anlegen, Ändern, Status) der Reihe nach an die Tabelle (GAS).
// Reihenfolge bleibt erhalten: bei einem vorübergehenden Fehler wird abgebrochen und später weitergemacht.
import { gasPost, serverKey } from "./gas.js";
import { ack, acquireLock, outboxStats, readOutbox, releaseLock, renameOrders, retryOrDeadLetter } from "./orders-store.js";

const GAS_TIMEOUT_MS = 20000;
const MAX_ROUNDS = 3;
// Diese Antworten von GAS sind endgültig (Wiederholen hilft nicht): der Eintrag geht in die „toten“ Einträge.
const FATAL = new Set(["order_not_found", "invalid_order", "invalid_status", "order_update_invalid", "too_many_orders"]);

async function apply(entry) {
  const key = serverKey();
  const payload = entry.payload || {};
  if (entry.op === "import") {
    return gasPost({ action: "orders_import", serverKey: key, items: JSON.stringify(payload.items || []) }, { timeoutMs: GAS_TIMEOUT_MS });
  }
  if (entry.op === "update") {
    return gasPost({ action: "updateorder", serverKey: key, id: payload.id, data: payload.data }, { timeoutMs: GAS_TIMEOUT_MS });
  }
  if (entry.op === "status") {
    return gasPost({
      action: "updatestatus", serverKey: key, id: payload.id, status: payload.status,
      comment: payload.comment || "", allSeries: payload.allSeries ? "1" : "0",
    }, { timeoutMs: GAS_TIMEOUT_MS });
  }
  throw Object.assign(new Error("unknown_op"), { business: true });
}

export async function flushOrdersOutbox() {
  const token = await acquireLock();
  if (!token) return { skipped: true };
  const result = { sent: 0, retry: 0, dead: 0 };
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const entries = await readOutbox();
      if (!entries.length) break;
      let stop = false;
      for (const entry of entries) {
        try {
          const reply = await apply(entry);
          await ack([entry.field]);
          result.sent += 1;
          if (reply?.renamed && Object.keys(reply.renamed).length) await renameOrders(reply.renamed);
        } catch (error) {
          const message = String(error?.message || error);
          const dead = await retryOrDeadLetter([entry], { fatal: FATAL.has(message) || message === "unknown_op", reason: message });
          result.dead += dead;
          result.retry += 1 - dead;
          if (!dead) { stop = true; break; } // vorübergehend: Reihenfolge wahren, später erneut
        }
      }
      if (stop) break;
    }
  } finally {
    await releaseLock(token).catch(() => {});
  }
  return result;
}

export { outboxStats };
