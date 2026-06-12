/** ===== Apps Script: JSON API для GitHub Pages фронта ===== */
const API_SECRET = "102030";
const SHEET_QR = "QR_Zahlungen";
const ADMIN_SETTINGS_SHEET = "Settings";
const ADMIN_PASSWORD_HASH_KEY = "admin_password_hash";
const ADMIN_PASSWORD_PLAIN_KEY = "admin_password";
const ADMIN_TOKEN_CACHE_PREFIX = "admin_token:";
const ADMIN_TOKEN_TTL_SEC = 12 * 60 * 60;

/** Утилита ответа JSON */
function json(obj, code) {
  const out = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
  if (code && out.setResponseCode) out.setResponseCode(code);
  return out;
}

// === helpers: Cache ===
function cacheGet_(key) {
  try {
    const c = CacheService.getScriptCache();
    const s = c.get(key);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

function cachePut_(key, obj, sec) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(obj), sec);
  } catch (_) {}
}

function cacheRemove_(key) {
  try {
    CacheService.getScriptCache().remove(key);
  } catch (_) {}
}

/** ===== doGet: getdata / recent / qr_recent / admin_data / ping ===== */
function doGet(e) {
  try {
    const fn = (e.parameter.fn || "").toLowerCase();
    if (API_SECRET && e.parameter.secret !== API_SECRET) {
      return json({ ok: false, error: "forbidden" }, 403);
    }

    // ---- Основные данные для Lehrlinge ----
    if (fn === "getdata") {
      const route = e.parameter.route || "1";
      const cacheKey = "getdata:" + route;
      const cached = cacheGet_(cacheKey);
      if (cached) return json({ ok: true, ...cached });

      const out = getData(route); // тяжёлая часть (из lehrlinge.gs)
      cachePut_(cacheKey, out, 300); // 5 минут
      return json({ ok: true, ...out });
    }

    // ---- Последние отчёты Lehrlinge ----
    if (fn === "recent") {
      const route = e.parameter.route || "";
      const limit = Number(e.parameter.limit || 4);
      const cacheKey = "recent:" + route + ":" + limit;
      const cached = cacheGet_(cacheKey);
      if (cached) return json({ ok: true, items: cached });

      const out = getRecentSubmissions(route, limit); // из lehrlinge.gs
      cachePut_(cacheKey, out, 15); // 15 секунд
      return json({ ok: true, items: out });
    }

    // ---- Последние QR-платежи для блока "Letzte Zahlungen" ----
    if (fn === "qr_recent") {
      const limit = Number(e.parameter.limit || 5);
      const items = getRecentQrPayments_(limit); // из qr.gs
      return json({ ok: true, items });
    }

    // ---- Данные для админки Lehrlinge ----
    if (fn === "admin_data") {
      requireAdminToken_(e.parameter.adminToken || "");
      const cacheKey = "admin_data";
      const cached = cacheGet_(cacheKey);
      if (cached) return json({ ok: true, ...cached });

      const out = getAdminData_(); // из lehrlinge.gs
      cachePut_(cacheKey, out, 300); // 5 минут
      return json({ ok: true, ...out });
    }

    // ---- ping/healthcheck ----
    if (fn === "ping") return json({ ok: true, pong: true });

    return json({ ok: false, error: "unknown_fn" }, 400);
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}

/** ===== doPost: submit + qr_payment + admin_save ===== */
function doPost(e) {
  try {
    const p = e.parameter || {};
    const ct = String(e.postData?.type || "").toLowerCase();

    let body = {};
    if (ct.indexOf("application/json") === 0) {
      body = JSON.parse(e.postData.contents || "{}");
    } else {
      // для простых POST (form-encoded) просто берём параметры как есть
      body = Object.assign({}, p);
    }

    const action = String(body.action || "").toLowerCase();
    const secret = body.secret || p.secret;

    if (API_SECRET && secret !== API_SECRET) {
      return json({ ok: false, error: "forbidden" }, 403);
    }

    // ===== ВЕТКА QR-ПЛАТЕЖЕЙ =====
    if (action === "qr_payment") {
      const saved = handleQrPayment_(body); // реализовано в qr.gs
      return json({ ok: true, saved });
    }

    // ===== ВЕТКА ЛОГИНА В LEHRLINGE ADMIN =====
    if (action === "admin_login") {
      const session = loginAdmin_(String(body.password || ""));
      return json({ ok: true, ...session });
    }

    // ===== ВЕТКА АДМИНКИ LEHRLINGE =====
    if (action === "admin_save") {
      requireAdminToken_(String(body.adminToken || ""));
      const saved = saveAdminData_(body); // реализовано в lehrlinge.gs
      cacheRemove_("admin_data");
      cacheRemove_("getdata:1");
      cacheRemove_("getdata:2");
      return json({ ok: true, saved });
    }

    // ===== ВЕТКА ДЛЯ LEHRLINGE / SUBMIT =====
    const route = body.route;
    const sequence = Array.isArray(body.sequence)
      ? body.sequence
      : String(body.sequence || "")
          .split(">")
          .filter(Boolean);
    const totalKm = Number(body.totalKm || 0);
    const driverId = body.driverId || "";
    const driverName = body.driverName || "";
    const shift = body.shift || "";
    const reportDate = body.reportDate || "";
    const carId = body.carId || "";
    const carPlate = body.carPlate || "";

    const saved = submit(
      route,
      sequence,
      totalKm,
      driverId,
      driverName,
      shift,
      reportDate,
      carId,
      carPlate
    ); // реализовано в lehrlinge.gs

    return json({ ok: true, saved });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}

/** === Прогрев (warmup) для ускорения старта === */

// Функция, которую будет запускать триггер каждые 5 минут
function warmup_() {
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheets()[0];
    // простое чтение ячейки — достаточно, чтобы "разбудить" Apps Script
    void sh.getRange(1, 1).getValue();
  } catch (e) {
    Logger.log("Warmup error: " + e);
  }
}

// Одноразовая установка таймер-триггера
function installWarmupTrigger() {
  // создаёт триггер, который вызывает warmup_() каждые 5 минут
  ScriptApp.newTrigger("warmup_").timeBased().everyMinutes(5).create();
}

function loginAdmin_(password) {
  const normalizedPassword = String(password || "");
  if (!normalizedPassword) {
    throw new Error("password_required");
  }

  if (!checkAdminPassword_(normalizedPassword)) {
    throw new Error("invalid_password");
  }

  const token = Utilities.getUuid() + Utilities.getUuid();
  cachePut_(ADMIN_TOKEN_CACHE_PREFIX + token, { ok: true }, ADMIN_TOKEN_TTL_SEC);
  return {
    token: token,
    expiresInSec: ADMIN_TOKEN_TTL_SEC,
  };
}

function requireAdminToken_(token) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    throw new Error("admin_auth_required");
  }

  const session = cacheGet_(ADMIN_TOKEN_CACHE_PREFIX + normalizedToken);
  if (!session || session.ok !== true) {
    throw new Error("admin_auth_required");
  }
}

function checkAdminPassword_(password) {
  const settings = getSettingsMap_();
  const plain = String(settings[ADMIN_PASSWORD_PLAIN_KEY] || "");
  if (plain) {
    return password === plain;
  }

  const expectedHash = String(settings[ADMIN_PASSWORD_HASH_KEY] || "").trim().toLowerCase();
  if (!expectedHash) {
    throw new Error("admin_password_not_configured");
  }

  return sha256Hex_(password) === expectedHash;
}

function sha256Hex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8
  );
  return bytes
    .map((b) => {
      const v = b < 0 ? b + 256 : b;
      return ("0" + v.toString(16)).slice(-2);
    })
    .join("");
}

function getSettingsMap_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(ADMIN_SETTINGS_SHEET);
  if (!sh || sh.getLastRow() < 1) return {};

  const values = sh.getRange(1, 1, sh.getLastRow(), Math.max(2, sh.getLastColumn())).getValues();
  const out = {};
  values.forEach((row, index) => {
    const key = String(row[0] || "").trim();
    const value = String(row[1] || "");
    if (!key) return;
    if (index === 0 && key.toLowerCase() === "key") return;
    out[key] = value;
  });
  return out;
}

function upsertSetting_(key, value) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(ADMIN_SETTINGS_SHEET) || ss.insertSheet(ADMIN_SETTINGS_SHEET);

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 2).setValues([["key", "value"]]);
  }

  const lastRow = sh.getLastRow();
  const values = sh.getRange(1, 1, lastRow, 2).getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || "").trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }

  sh.getRange(lastRow + 1, 1, 1, 2).setValues([[key, value]]);
}

function setLehrlingeAdminPassword(password) {
  const normalized = String(password || "");
  if (!normalized) {
    throw new Error("password_required");
  }

  upsertSetting_(ADMIN_PASSWORD_HASH_KEY, sha256Hex_(normalized));
  upsertSetting_(ADMIN_PASSWORD_PLAIN_KEY, "");
  return { ok: true, updated: ADMIN_PASSWORD_HASH_KEY };
}

function setLehrlingeAdminPasswordPlain(password) {
  const normalized = String(password || "");
  if (!normalized) {
    throw new Error("password_required");
  }

  upsertSetting_(ADMIN_PASSWORD_PLAIN_KEY, normalized);
  return { ok: true, updated: ADMIN_PASSWORD_PLAIN_KEY };
}

function resetAdminPassword() {
  return setLehrlingeAdminPassword("CHANGE_ME");
}
