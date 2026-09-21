// GET /api/lehrlinge/students — список Lehrlinge для выбора. Водитель: с адресом; общий доступ: только id и имя.
import { readState } from "../_lib/lehrlinge-store.js";
import { getDriverStudents } from "../_lib/lehrlinge-schedule.js";
import { cors, fail, requireAccess } from "../_lib/http.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const { snapshot } = await readState();
    const access = requireAccess(req, snapshot);
    const students = getDriverStudents(snapshot);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      students: access.role === "shared" ? students.map(({ id, name }) => ({ id, name })) : students,
    });
  } catch (error) {
    return fail(res, error);
  }
}
