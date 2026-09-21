// GET /api/lehrlinge/student-plan?studentId&from&to — план одного ученика из Redis.
import { readState } from "../_lib/lehrlinge-store.js";
import { getDriverStudentPlan } from "../_lib/lehrlinge-schedule.js";
import { cors, fail, requireAccess } from "../_lib/http.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const { snapshot, plan } = await readState();
    const access = requireAccess(req, snapshot);
    const { studentId, from, to } = req.query;
    const result = getDriverStudentPlan(snapshot, plan, studentId, from, to, access);
    if (access.role === "shared") {
      // Общий доступ: без домашнего адреса ученика и без данных водителя.
      const { address, ...student } = result.student;
      result.student = student;
      delete result.driver;
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, syncedAt: snapshot.builtAt, ...result });
  } catch (error) {
    return fail(res, error);
  }
}
