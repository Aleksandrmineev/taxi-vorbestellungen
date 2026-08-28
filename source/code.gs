/** ===== Apps Script: JSON API для GitHub Pages фронта ===== */
const API_SECRET = "102030";
const SHEET_QR = "QR_Zahlungen";
const ADMIN_SETTINGS_SHEET = "Settings";
const ADMIN_PASSWORD_HASH_KEY = "admin_password_hash";
const ADMIN_PASSWORD_PLAIN_KEY = "admin_password";
const ADMIN_TOKEN_CACHE_PREFIX = "admin_token:";
const ADMIN_TOKEN_TTL_SEC = 12 * 60 * 60;
const SHIFT_DRIVERS_SHEET = "_Shift_Drivers";
const SHIFT_REPORTS_SHEET = "Schichtabrechnung";
const SHIFT_ADMIN_LOGIN = "admin";
const SHIFT_ADMIN_PASSWORD = "Qqqq1111";
const SHIFT_ADMIN_TOKEN_PREFIX = "shift_admin_token:";

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

    if (fn === "shift_profile") {
      const profile = getShiftProfile_(String(e.parameter.driver || ""));
      return profile
        ? json({ ok: true, profile: profile })
        : json({ ok: false, error: "not_found" }, 404);
    }

    if (fn === "shift_admin_data") {
      requireShiftAdminToken_(String(e.parameter.adminToken || ""));
      return json({ ok: true, profiles: getAllShiftProfiles_() });
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

    if (action === "shift_admin_login") {
      return json({ ok: true, ...loginShiftAdmin_(body.login, body.password) });
    }

    if (action === "shift_profile_save") {
      const profile = saveShiftProfile_(body.driverNumber, body.name);
      return json({ ok: true, profile: profile });
    }

    if (action === "shift_car_save") {
      const cars = saveShiftCar_(body.driverNumber, body.car);
      return json({ ok: true, cars: cars });
    }

    if (action === "shift_report_save") {
      const profile = saveShiftReport_(body.report || body, false);
      return json({ ok: true, profile: profile });
    }

    if (action === "shift_admin_report_save") {
      requireShiftAdminToken_(body.adminToken);
      const report = Object.assign({}, body.report || {}, { id: body.reportId });
      saveShiftReport_(report, true);
      return json({ ok: true });
    }

    if (action === "shift_admin_report_delete") {
      requireShiftAdminToken_(body.adminToken);
      deleteShiftReport_(body.reportId);
      return json({ ok: true });
    }

    if (action === "shift_admin_clear") {
      requireShiftAdminToken_(body.adminToken);
      clearShiftReports_(body.driverNumber, body.keepBalance === true);
      return json({ ok: true });
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

/** ===== Schichtabrechnung ===== */
function ensureShiftSheets_() {
  const ss = SpreadsheetApp.getActive();
  let drivers = ss.getSheetByName(SHIFT_DRIVERS_SHEET);
  let reports = ss.getSheetByName(SHIFT_REPORTS_SHEET);

  if (!drivers) drivers = ss.insertSheet(SHIFT_DRIVERS_SHEET);
  if (!reports) reports = ss.insertSheet(SHIFT_REPORTS_SHEET);

  if (drivers.getLastRow() === 0) {
    drivers.appendRow(["driver_number", "name", "cars_json", "carryover_balance", "created_at"]);
    drivers.setFrozenRows(1);
    drivers.getRange("A:A").setNumberFormat("@");
  }
  if (ss.getSheets().length > 1 && !drivers.isSheetHidden()) drivers.hideSheet();
  if (reports.getLastRow() === 0) {
    reports.appendRow([
      "id", "driver_number", "report_date", "shift_type", "hours", "car", "report_number",
      "sales", "expenses", "voucher", "qr", "terminal", "expected_cash", "actual_cash",
      "difference", "saved_at", "edited_at"
    ]);
    reports.setFrozenRows(1);
    reports.getRange("A:B").setNumberFormat("@");
    reports.getRange("G:G").setNumberFormat("@");
  }
  return { drivers: drivers, reports: reports };
}

function shiftIso_(value) {
  return value instanceof Date ? value.toISOString() : String(value || "");
}

function shiftNumber_(value) {
  const n = Number(value || 0);
  return isFinite(n) ? n : 0;
}

function findShiftDriver_(sheet, driverNumber) {
  const driver = String(driverNumber || "").trim();
  if (!driver || sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || "").trim() === driver) return { row: i + 2, values: values[i] };
  }
  return null;
}

function shiftReportFromRow_(row) {
  return {
    id: String(row[0] || ""), driverNumber: String(row[1] || ""), date: shiftIso_(row[2]),
    shiftType: String(row[3] || "day"), hours: shiftNumber_(row[4]), car: String(row[5] || ""),
    reportNumber: String(row[6] || ""), sales: shiftNumber_(row[7]), expenses: shiftNumber_(row[8]),
    voucher: shiftNumber_(row[9]), qr: shiftNumber_(row[10]), terminal: shiftNumber_(row[11]),
    expectedCash: shiftNumber_(row[12]), actualCash: shiftNumber_(row[13]), difference: shiftNumber_(row[14]),
    savedAt: shiftIso_(row[15]), editedAt: shiftIso_(row[16])
  };
}

function getShiftReports_(driverNumber) {
  const sheets = ensureShiftSheets_();
  if (sheets.reports.getLastRow() < 2) return [];
  return sheets.reports.getRange(2, 1, sheets.reports.getLastRow() - 1, 17).getValues()
    .filter((row) => String(row[1] || "").trim() === String(driverNumber || "").trim())
    .map(shiftReportFromRow_)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function getShiftProfile_(driverNumber) {
  const sheets = ensureShiftSheets_();
  const found = findShiftDriver_(sheets.drivers, driverNumber);
  if (!found) return null;
  let cars = [];
  try { cars = JSON.parse(String(found.values[2] || "[]")); } catch (_) {}
  return {
    name: String(found.values[1] || ""), cars: Array.isArray(cars) ? cars : [],
    carryoverBalance: shiftNumber_(found.values[3]), createdAt: shiftIso_(found.values[4]),
    reports: getShiftReports_(driverNumber)
  };
}

function getAllShiftProfiles_() {
  const sheets = ensureShiftSheets_();
  const out = {};
  if (sheets.drivers.getLastRow() < 2) return out;
  const drivers = sheets.drivers.getRange(2, 1, sheets.drivers.getLastRow() - 1, 1).getValues();
  drivers.forEach((row) => {
    const driver = String(row[0] || "").trim();
    if (driver) out[driver] = getShiftProfile_(driver);
  });
  return out;
}

function saveShiftProfile_(driverNumber, name) {
  const driver = String(driverNumber || "").trim();
  const driverName = String(name || "").trim();
  if (!driver || !driverName) throw new Error("driver_and_name_required");
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = ensureShiftSheets_();
    const found = findShiftDriver_(sheets.drivers, driver);
    if (found) sheets.drivers.getRange(found.row, 2).setValue(driverName);
    else sheets.drivers.appendRow([driver, driverName, "[]", 0, new Date().toISOString()]);
  } finally { lock.releaseLock(); }
  return getShiftProfile_(driver);
}

function saveShiftCar_(driverNumber, carValue) {
  const driver = String(driverNumber || "").trim();
  const car = String(carValue || "").trim().toUpperCase();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let cars = [];
  try {
    const sheets = ensureShiftSheets_();
    const found = findShiftDriver_(sheets.drivers, driver);
    if (!found) throw new Error("driver_not_found");
    try { cars = JSON.parse(String(found.values[2] || "[]")); } catch (_) {}
    if (!Array.isArray(cars)) cars = [];
    if (car && cars.indexOf(car) === -1) cars.push(car);
    sheets.drivers.getRange(found.row, 3).setValue(JSON.stringify(cars));
  } finally { lock.releaseLock(); }
  return cars;
}

function shiftReportRow_(report) {
  const sales = shiftNumber_(report.sales);
  const expenses = shiftNumber_(report.expenses);
  const voucher = shiftNumber_(report.voucher);
  const qr = shiftNumber_(report.qr);
  const terminal = shiftNumber_(report.terminal);
  const actual = shiftNumber_(report.actualCash);
  const expected = sales - expenses - voucher - qr - terminal;
  return [
    String(report.id || Utilities.getUuid()), String(report.driverNumber || "").trim(), String(report.date || ""),
    report.shiftType === "night" ? "night" : "day", shiftNumber_(report.hours), String(report.car || "").trim().toUpperCase(),
    String(report.reportNumber || "").trim(), sales, expenses, voucher, qr, terminal, expected, actual,
    actual - expected, String(report.savedAt || new Date().toISOString()), String(report.editedAt || "")
  ];
}

function findShiftReportRow_(sheet, reportId) {
  if (sheet.getLastRow() < 2) return 0;
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(reportId)) return i + 2;
  return 0;
}

function saveShiftReport_(report, adminEdit) {
  const rowData = shiftReportRow_(report || {});
  if (!rowData[1]) throw new Error("driver_required");
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = ensureShiftSheets_();
    if (!findShiftDriver_(sheets.drivers, rowData[1])) throw new Error("driver_not_found");
    const existingRow = findShiftReportRow_(sheets.reports, rowData[0]);
    if (adminEdit) {
      if (!existingRow) throw new Error("report_not_found");
      rowData[16] = new Date().toISOString();
      sheets.reports.getRange(existingRow, 1, 1, 17).setValues([rowData]);
    } else if (!existingRow) {
      sheets.reports.appendRow(rowData);
    }
  } finally { lock.releaseLock(); }
  return getShiftProfile_(rowData[1]);
}

function deleteShiftReport_(reportId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = ensureShiftSheets_();
    const row = findShiftReportRow_(sheets.reports, reportId);
    if (!row) throw new Error("report_not_found");
    sheets.reports.deleteRow(row);
  } finally { lock.releaseLock(); }
}

function clearShiftReports_(driverNumber, keepBalance) {
  const driver = String(driverNumber || "").trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = ensureShiftSheets_();
    const found = findShiftDriver_(sheets.drivers, driver);
    if (!found) throw new Error("driver_not_found");
    let balance = shiftNumber_(found.values[3]);
    if (sheets.reports.getLastRow() >= 2) {
      const values = sheets.reports.getRange(2, 1, sheets.reports.getLastRow() - 1, 17).getValues();
      for (let i = values.length - 1; i >= 0; i--) {
        if (String(values[i][1] || "").trim() !== driver) continue;
        balance += shiftNumber_(values[i][14]);
        sheets.reports.deleteRow(i + 2);
      }
    }
    sheets.drivers.getRange(found.row, 4).setValue(keepBalance ? balance : 0);
  } finally { lock.releaseLock(); }
}

function loginShiftAdmin_(login, password) {
  if (String(login || "") !== SHIFT_ADMIN_LOGIN || String(password || "") !== SHIFT_ADMIN_PASSWORD) {
    throw new Error("invalid_credentials");
  }
  const token = Utilities.getUuid() + Utilities.getUuid();
  cachePut_(SHIFT_ADMIN_TOKEN_PREFIX + token, { ok: true }, ADMIN_TOKEN_TTL_SEC);
  return { token: token, expiresInSec: ADMIN_TOKEN_TTL_SEC };
}

function requireShiftAdminToken_(token) {
  const session = cacheGet_(SHIFT_ADMIN_TOKEN_PREFIX + String(token || "").trim());
  if (!session || session.ok !== true) throw new Error("admin_auth_required");
}
