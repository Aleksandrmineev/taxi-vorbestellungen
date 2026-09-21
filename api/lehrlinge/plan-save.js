// POST /api/lehrlinge/plan-save — водитель сохраняет изменения плана.
// Порядок: валидация -> очередь + Redis (мгновенно, ответ водителю) -> запись в таблицу через GAS в фоне.
// Таблица остаётся источником правды: очередь повторяет запись, пока GAS не подтвердит; чужие снапшоты
// не перезаписывают ожидающие строки.
import { enqueueOutbox, readState, upsertPlanRows } from "../_lib/lehrlinge-store.js";
import { getDriverStudents } from "../_lib/lehrlinge-schedule.js";
import { cors, fail, requireDriver } from "../_lib/http.js";
import { flushOutbox } from "../_lib/lehrlinge-outbox.js";
import { background } from "../_lib/background.js";

export const config = { maxDuration: 30 };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["both", "out", "back", "none"];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const { snapshot } = await readState();
    const driver = requireDriver(req, snapshot);
    const body = req.body || {};
    const requested = Array.isArray(body.rows) ? body.rows : null;
    if (!requested || requested.length > 400) throw new Error("invalid_plan_rows");
    if (!requested.length) return res.status(200).json({ ok: true, saved: 0, rows: [] });

    const active = new Set(getDriverStudents(snapshot).map((student) => student.id));
    const holidays = Array.isArray(body.holidays) ? body.holidays.map(String).filter((d) => DATE_RE.test(d)) : [];
    const holidaySet = new Set(holidays);
    const rows = requested.map((item) => {
      const date = String(item?.date || "").trim();
      const studentId = String(item?.student_id || "").trim().toLowerCase();
      const status = String(item?.status || "").trim();
      if (!DATE_RE.test(date)) throw new Error("invalid_date");
      if (!active.has(studentId)) throw new Error("student_not_found");
      if (!STATUSES.includes(status)) throw new Error("invalid_status");
      return { date, student_id: studentId, status, note: String(item?.note || "").trim() };
    });

    const updatedBy = "driver:" + String(driver.taxiNumber || driver.id || "unknown");
    // Сначала намерение (очередь), потом видимое изменение (Redis). Если что-то из этого упадёт,
    // клиент получит 5xx и запишет напрямую через GAS.
    await enqueueOutbox(rows.map((row) => ({ row, driver, updatedBy, holidays })));
    const saved = rows.map((row) => ({
      ...row,
      note: holidaySet.has(row.date) ? "holiday" : row.note,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    }));
    await upsertPlanRows(saved);

    background(flushOutbox());
    return res.status(200).json({ ok: true, saved: saved.length, rows: saved });
  } catch (error) {
    return fail(res, error);
  }
}
