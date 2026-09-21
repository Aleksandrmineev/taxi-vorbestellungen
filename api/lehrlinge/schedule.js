// GET /api/lehrlinge/schedule?from&to&route&direction — расписание из Redis (без обращения к GAS).
import { readState } from "../_lib/lehrlinge-store.js";
import { getDriverSchedule, getDriverStudents } from "../_lib/lehrlinge-schedule.js";
import { cors, fail, requireDriver } from "../_lib/http.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const { snapshot, plan } = await readState();
    const driver = requireDriver(req, snapshot);
    const { from, to, route, direction } = req.query;
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      driver,
      syncedAt: snapshot.builtAt,
      students: getDriverStudents(snapshot),
      ...getDriverSchedule(snapshot, plan, { from, to, route, direction }),
    });
  } catch (error) {
    return fail(res, error);
  }
}
