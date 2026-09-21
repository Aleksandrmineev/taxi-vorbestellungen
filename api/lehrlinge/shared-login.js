// POST /api/lehrlinge/shared-login { login, password } — общий пробный доступ для учеников (без личной регистрации).
// Пароль задаётся в env SHARED_LOGIN_PASSWORD; без него доступ выключен. Выдаёт токен роли «shared».
import crypto from "node:crypto";
import { signJwt } from "../_lib/jwt.js";
import { cors, fail, sharedAccessEnabled, SHARED_ID } from "../_lib/http.js";
import { allowAttempt } from "../_lib/lehrlinge-store.js";

export const SHARED_JWT_TTL_SEC = 30 * 24 * 60 * 60;
const LOGIN_NAME = "lehrlinge";
const MAX_ATTEMPTS = 10;
const WINDOW_SEC = 10 * 60;

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();
const same = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    if (!sharedAccessEnabled()) throw new Error("shared_access_disabled");
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    if (!(await allowAttempt(`shared-login:${ip}`, MAX_ATTEMPTS, WINDOW_SEC))) throw new Error("too_many_attempts");
    const login = String(req.body?.login || "").trim().toLowerCase();
    const password = String(req.body?.password || "").trim();
    // beide Vergleiche immer ausführen (kein früher Abbruch)
    const okLogin = same(login, LOGIN_NAME);
    const okPassword = same(password, process.env.SHARED_LOGIN_PASSWORD);
    if (!(okLogin && okPassword)) throw new Error("invalid_credentials");
    return res.status(200).json({ ok: true, jwt: signJwt({ sub: SHARED_ID, role: "shared" }, SHARED_JWT_TTL_SEC), expiresInSec: SHARED_JWT_TTL_SEC });
  } catch (error) {
    return fail(res, error);
  }
}
