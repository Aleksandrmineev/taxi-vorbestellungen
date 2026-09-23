// GET /api/lehrlinge/plan-log?studentId= — Änderungsprotokoll des Fahrtenplans (liegt im Sheet, gelesen über GAS).
// Fahrer: alle Einträge (optional ein Lehrling). Gemeinsames Konto: nur ein Lehrling, ohne Taxinummern —
// die Einschränkung setzt GAS selbst durch (lehrlinge_log in code.gs), hier nur die Anmeldung.
import { readState } from "../_lib/lehrlinge-store.js";
import { gasPost, trustedFields } from "../_lib/gas.js";
import { cors, fail, requireAccess } from "../_lib/http.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const { snapshot } = await readState();
    const access = requireAccess(req, snapshot);
    const studentId = String(req.query?.studentId || "").trim().toLowerCase();
    if (access.role === "shared" && !studentId) throw new Error("student_not_found");
    const data = await gasPost({ action: "lehrlinge_log", ...trustedFields(access), studentId }, { timeoutMs: 25000 });
    res.setHeader("Cache-Control", "no-store");
    const result = { ok: true, entries: data.entries || [] };
    if (access.role !== "shared" && Array.isArray(data.accounts)) result.accounts = data.accounts;
    return res.status(200).json(result);
  } catch (error) {
    return fail(res, error);
  }
}
