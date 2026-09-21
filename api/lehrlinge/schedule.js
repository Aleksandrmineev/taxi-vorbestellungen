// GET /api/lehrlinge/schedule?from&to&route&direction — расписание из Redis (без обращения к GAS).
import { readState } from "../_lib/lehrlinge-store.js";
import { getDriverSchedule, getDriverStudents } from "../_lib/lehrlinge-schedule.js";
import { cors, fail, requireAccess } from "../_lib/http.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const { snapshot, plan } = await readState();
    const access = requireAccess(req, snapshot);
    const { from, to, route, direction } = req.query;
    const result = {
      ok: true,
      driver: access,
      syncedAt: snapshot.builtAt,
      students: getDriverStudents(snapshot),
      ...getDriverSchedule(snapshot, plan, { from, to, route, direction }),
    };
    if (access.role === "shared") {
      // Общий доступ учеников: полное расписание, но без телефонов остановок, данных водителя и подробностей об учениках.
      delete result.driver;
      result.students = result.students.map(({ id, name }) => ({ id, name }));
      result.days.forEach((day) => day.routes.forEach((entry) => entry.points.forEach((point) => { delete point.phone; })));
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(result);
  } catch (error) {
    return fail(res, error);
  }
}
