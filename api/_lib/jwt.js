// Минимальный HS256 JWT на node:crypto (без зависимостей).
import crypto from "node:crypto";

const b64url = (input) => Buffer.from(input).toString("base64url");

function secret() {
  const value = String(process.env.JWT_SECRET || "");
  if (value.length < 32) throw new Error("jwt_not_configured");
  return value;
}

function sign(data) {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url");
}

export function signJwt(payload, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  return `${head}.${body}.${sign(`${head}.${body}`)}`;
}

export function verifyJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("driver_auth_required");
  const [head, body, signature] = parts;
  const expected = sign(`${head}.${body}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("driver_auth_required");
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString());
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    throw new Error("driver_auth_required");
  }
  if (header.alg !== "HS256" || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("driver_auth_required");
  }
  return payload;
}
