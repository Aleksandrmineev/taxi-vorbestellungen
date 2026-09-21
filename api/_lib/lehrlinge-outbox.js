// Слив очереди записей водителей в Google Sheet через GAS (доверенный вызов).
// Redis принимает запись мгновенно, таблица получает её здесь, в фоне. Сбой -> запись остаётся в очереди и повторяется.
import { gasPost, trustedFields } from "./gas.js";
import {
  acquireOutboxLock,
  ackOutbox,
  outboxStats,
  readOutbox,
  releaseOutboxLock,
  retryOrDeadLetter,
} from "./lehrlinge-store.js";

const GAS_TIMEOUT_MS = 20000;
const MAX_ROUNDS = 3;

function groupByDriver(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    const id = String(entry.driver?.id || "");
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry);
  });
  return [...groups.values()];
}

export async function flushOutbox() {
  const token = await acquireOutboxLock();
  if (!token) return { skipped: true };
  const result = { sent: 0, retry: 0, dead: 0 };
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const entries = await readOutbox();
      if (!entries.length) break;
      let failed = false;
      for (const group of groupByDriver(entries)) {
        // Несколько записей одного ключа: в таблицу идёт только последняя (GAS не любит дубли ключа в одном вызове).
        const latest = new Map();
        group.forEach((entry) => latest.set(`${entry.row.date}|${entry.row.student_id}`, entry));
        const driver = group[group.length - 1].driver;
        const holidays = [...new Set(group.flatMap((entry) => entry.holidays || []))];
        try {
          await gasPost({
            action: "driver_plan_save",
            ...trustedFields(driver),
            rows: JSON.stringify([...latest.values()].map((entry) => entry.row)),
            holidays: JSON.stringify(holidays),
            updatedBy: group[group.length - 1].updatedBy,
          }, { timeoutMs: GAS_TIMEOUT_MS });
          await ackOutbox(group.map((entry) => entry.field));
          result.sent += group.length;
        } catch (error) {
          failed = true;
          // business: GAS осмысленно отказал (водитель отключён и т.п.), повторять бессмысленно.
          const dead = await retryOrDeadLetter(group, { fatal: Boolean(error.business), reason: String(error.message || error) });
          result.dead += dead;
          result.retry += group.length - dead;
        }
      }
      if (failed) break;
    }
  } finally {
    await releaseOutboxLock(token).catch(() => {});
  }
  return result;
}

export { outboxStats };
