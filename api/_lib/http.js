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

export const SHARED_ID = "shared";

// Общий доступ для учеников (пробный режим) включён, только пока в env задан SHARED_LOGIN_PASSWORD.
export function sharedAccessEnabled() {
  return Boolean(process.env.SHARED_LOGIN_PASSWORD);
}

function fromClaims(claims, snapshot) {
  if (claims.role === "shared") {
    if (!sharedAccessEnabled()) throw new Error("driver_auth_required"); // выключатель: убрали env -> все токены недействительны
    return { role: "shared", id: SHARED_ID, name: "Lehrlinge", surname: "", taxiNumber: "lehrlinge" };
  }
  if (snapshot) {
    const driver = (snapshot.drivers || []).find((item) => String(item.id) === String(claims.sub));
    if (!driver || String(driver.active) !== "1") throw new Error("driver_auth_required");
    return { role: "driver", id: driver.id, name: driver.name, surname: driver.surname, taxiNumber: driver.taxiNumber };
  }
  return { role: "driver", id: claims.sub, name: claims.name, surname: claims.surname, taxiNumber: claims.tn };
}

// Только водитель (полное расписание, телефоны, адреса).
export function requireDriver(req, snapshot) {
  const claims = verifyJwt(bearer(req));
  if (claims.role === "shared") throw new Error("forbidden");
  return fromClaims(claims, snapshot);
}

// Водитель или общий доступ учеников (список имён, план одного ученика, сохранение плана).
export function requireAccess(req, snapshot) {
  return fromClaims(verifyJwt(bearer(req)), snapshot);
}

export function fail(res, error) {
  const message = String(error?.message || error || "error");
  if (error?.business && message !== "driver_auth_required") return res.status(400).json({ ok: false, error: message });
  const status = message === "driver_auth_required" ? 401
    : message === "forbidden" ? 403
    : message === "invalid_credentials" ? 401
    : message === "too_many_attempts" ? 429
    : message === "shared_access_disabled" ? 503
    : ["snapshot_missing", "store_not_configured", "store_unavailable", "jwt_not_configured"].includes(message) ? 503
    : ["student_not_found", "invalid_plan_rows", "invalid_date", "invalid_status"].includes(message) ? 400
    : 500;
  return res.status(status).json({ ok: false, error: message });
}
