// Общие хелперы для /api/lehrlinge/*: CORS, авторизация водителя по JWT, ответы.
import { verifyJwt } from "./jwt.js";

export function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}

export function bearer(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

// Проверяет JWT и то, что водитель по-прежнему активен в снапшоте.
export function requireDriver(req, snapshot) {
  const claims = verifyJwt(bearer(req));
  if (snapshot) {
    const driver = (snapshot.drivers || []).find((item) => String(item.id) === String(claims.sub));
    if (!driver || String(driver.active) !== "1") throw new Error("driver_auth_required");
    return { id: driver.id, name: driver.name, surname: driver.surname, taxiNumber: driver.taxiNumber };
  }
  return { id: claims.sub, name: claims.name, surname: claims.surname, taxiNumber: claims.tn };
}

export function fail(res, error) {
  const message = String(error?.message || error || "error");
  if (error?.business && message !== "driver_auth_required") return res.status(400).json({ ok: false, error: message });
  const status = message === "driver_auth_required" ? 401
    : message === "forbidden" ? 403
    : ["snapshot_missing", "store_not_configured", "store_unavailable", "jwt_not_configured"].includes(message) ? 503
    : ["student_not_found", "invalid_plan_rows", "invalid_date", "invalid_status"].includes(message) ? 400
    : 500;
  return res.status(status).json({ ok: false, error: message });
}
