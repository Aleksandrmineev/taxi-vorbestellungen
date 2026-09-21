// POST /api/lehrlinge/plan-save — водитель сохраняет изменения плана.
// Порядок: валидация -> запись в таблицу через GAS (источник правды) -> обновление Redis.
import { readState, upsertPlanRows } from "../_lib/lehrlinge-store.js";
import { getDriverStudents } from "../_lib/lehrlinge-schedule.js";
import { cors, fail, requireDriver } from "../_lib/http.js";
import { gasPost, trustedFields } from "../_lib/gas.js";

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
    const result = await gasPost({
      action: "driver_plan_save",
      ...trustedFields(driver),
      rows: JSON.stringify(rows),
      holidays: JSON.stringify(holidays),
      updatedBy,
    });

    const saved = rows.map((row) => ({
      ...row,
      note: holidaySet.has(row.date) ? "holiday" : row.note,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    }));
    await upsertPlanRows(saved);
    return res.status(200).json({ ok: true, saved: result.saved?.saved ?? saved.length, rows: saved });
  } catch (error) {
    return fail(res, error);
  }
}
