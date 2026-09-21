// POST /api/lehrlinge/session { token } — обменивает действующий токен GAS на JWT
// (для водителей, уже вошедших до появления JWT, чтобы не просить их логиниться заново).
import { gasPost } from "../_lib/gas.js";
import { cors, fail } from "../_lib/http.js";
import { issueDriverJwt } from "../_lib/driver-jwt.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) throw new Error("driver_auth_required");
    const result = await gasPost({ action: "driver_whoami", driverToken: token }, { timeoutMs: 15000 });
    if (!result.driver) throw new Error("driver_auth_required");
    return res.status(200).json({ ok: true, jwt: issueDriverJwt(result.driver), driver: result.driver });
  } catch (error) {
    return fail(res, error?.message === "gas_http_403" ? new Error("driver_auth_required") : error);
  }
}
