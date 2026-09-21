// GET /api/lehrlinge/portal-students — публичный список для выпадающего списка на странице входа портала учеников.
// Только id и имя (без адресов и прочих данных). sharedEnabled показывает, включён ли общий пробный доступ.
import { readSnapshot } from "../_lib/lehrlinge-store.js";
import { cors, fail, sharedAccessEnabled } from "../_lib/http.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const snapshot = await readSnapshot();
    const students = (snapshot.students || [])
      .filter((student) => student.id && String(student.active) === "1")
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ ok: true, students, sharedEnabled: sharedAccessEnabled() });
  } catch (error) {
    return fail(res, error);
  }
}
