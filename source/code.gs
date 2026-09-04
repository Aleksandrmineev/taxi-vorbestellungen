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
const ORDER_NOTIFICATION_PROPERTIES_ = {
  ZADARMA_KEY: "ZADARMA_API_KEY",
  ZADARMA_SECRET: "ZADARMA_API_SECRET",
  ZADARMA_BALANCE_LEVEL: "ZADARMA_BALANCE_WARNING_LEVEL",
  SMS_NOTIFICATION_PHONE: "SMS_NOTIFICATION_PHONE",
  PUBLIC_BASE_URL: "PUBLIC_BASE_URL",
};

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
    const fn = (e.parameter.fn || e.parameter.action || "").toLowerCase();
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

    // ---- Vorbestellungen ----
    if (fn === "ordersbydate") {
      return json({
        ok: true,
        items: getOrdersByDate_(e.parameter.date || "", e.parameter.includeAll === "1"),
      });
    }

    if (fn === "todos") {
      return json({ ok: true, items: getTodoOrders_(Number(e.parameter.hours || 24)) });
    }

    if (fn === "search") {
      return json({ ok: true, items: searchOrders_(e.parameter.q || "", Number(e.parameter.limit || 50)) });
    }

    if (fn === "messageslist") {
      return json({ ok: true, items: getMessages_(Number(e.parameter.since || 0), Number(e.parameter.limit || 300)) });
    }

    if (fn === "feedbacklist") {
      requireAdminToken_(e.parameter.adminToken || "");
      return json({ ok: true, items: getFeedback_() });
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

    // ===== ВЕТКА VORBESTELLUNGEN =====
    if (action === "create") {
      const saved = createOrder_(body.data || body);
      return json({ ok: true, data: saved });
    }

    if (action === "updateorder") {
      const saved = updateOrder_(body.id, body.data || body);
      return json({ ok: true, data: saved });
    }

    if (action === "feedback") {
      const saved = saveFeedback_(body);
      return json({ ok: true, data: saved });
    }

    if (action === "messagesadd") {
      const saved = addMessage_(body);
      return json({ ok: true, saved });
    }

    if (action === "updatestatus") {
      const saved = updateOrderStatus_(body.id, body.status, body.comment || "", body.allSeries === true || body.allSeries === "1");
      return json({ ok: true, ...saved });
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

// ===== Минимальный backend Vorbestellungen =====
const ORDER_HEADERS_ = [
  "id",
  "created_at",
  "date",
  "time",
  "type",
  "duration_min",
  "phone_raw",
  "phone_norm",
  "message",
  "rrule",
  "until",
  "series_id",
  "gcal_event_id",
  "status",
  "status_comment",
  "created_by_name",
  "created_by_device",
  "confirmation_sent_at",
  "reminder_sent_at",
];
const MESSAGE_HEADERS_ = ["id", "ts", "author", "device", "text", "is_order"];
const FEEDBACK_HEADERS_ = ["id", "created_at", "order_id", "rating", "comment"];

function ensureHeaders_(sh, headers) {
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return headers.slice();
  }
  const current = sh
    .getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1))
    .getValues()[0]
    .map(String);
  headers.forEach((header) => {
    if (current.indexOf(header) === -1) {
      sh.getRange(1, current.length + 1).setValue(header);
      current.push(header);
    }
  });
  return current;
}

function orderSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName("Orders") || SpreadsheetApp.getActive().insertSheet("Orders");
  ensureHeaders_(sh, ORDER_HEADERS_);
  return sh;
}

function messageSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName("Messages") || SpreadsheetApp.getActive().insertSheet("Messages");
  ensureHeaders_(sh, MESSAGE_HEADERS_);
  return sh;
}

function feedbackSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName("Feedback") || SpreadsheetApp.getActive().insertSheet("Feedback");
  ensureHeaders_(sh, FEEDBACK_HEADERS_);
  return sh;
}

function orderId_() {
  const sh = SpreadsheetApp.getActive().getSheetByName("Orders");
  const used = new Set();
  if (sh && sh.getLastRow() > 1) {
    sh
      .getRange(2, 1, sh.getLastRow() - 1, 1)
      .getValues()
      .forEach((row) => used.add(String(row[0] || "").trim()));
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = String(Math.floor(100 + Math.random() * 900));
    if (!used.has(candidate)) return candidate;
  }

  throw new Error("short_order_id_unavailable");
}

function normalizePhone_(value) {
  return String(value || "").replace(/[^0-9+]/g, "");
}

function orderNotificationProperties_() {
  return PropertiesService.getScriptProperties();
}

function orderNotificationConfig_() {
  const props = orderNotificationProperties_();
  return {
    key: String(props.getProperty(ORDER_NOTIFICATION_PROPERTIES_.ZADARMA_KEY) || "").trim(),
    secret: String(props.getProperty(ORDER_NOTIFICATION_PROPERTIES_.ZADARMA_SECRET) || "").trim(),
    notifyPhone: String(props.getProperty(ORDER_NOTIFICATION_PROPERTIES_.SMS_NOTIFICATION_PHONE) || "").trim(),
    baseUrl: String(props.getProperty(ORDER_NOTIFICATION_PROPERTIES_.PUBLIC_BASE_URL) || "https://taxi-vorbestellungen.vercel.app").replace(/\/$/, ""),
  };
}

function formEncode_(value) {
  return encodeURIComponent(String(value == null ? "" : value)).replace(/%20/g, "+");
}

function maskPhone_(value) {
  const digits = normalizePhone_(value).replace(/\D/g, "");
  return digits.length > 4 ? "***" + digits.slice(-4) : "***";
}

function redactLogText_(value, maxLength) {
  return String(value || "")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, (match) => maskPhone_(match))
    .slice(0, maxLength || 180);
}

function safeNotificationLog_(event, data) {
  const payload = Object.assign({ event: event, at: new Date().toISOString() }, data || {});
  Logger.log(JSON.stringify(payload));
}

function safeDeniedNumbers_(value) {
  return Array.isArray(value)
    ? value.map((item) => ({
        number: maskPhone_(item && item.number),
        message: redactLogText_(item && item.message, 180),
      }))
    : [];
}

function getZadarmaBalance_() {
  const cfg = orderNotificationConfig_();
  if (!cfg.key || !cfg.secret) return null;
  const method = "/v1/info/balance/";
  const signed = zadarmaSignature_(method, {}, cfg.secret);
  const response = UrlFetchApp.fetch("https://api.zadarma.com" + method, {
    method: "get",
    headers: { Authorization: cfg.key + ":" + signed.signature },
    muteHttpExceptions: true,
  });
  const httpCode = response.getResponseCode();
  let data = {};
  try {
    data = JSON.parse(response.getContentText() || "{}");
  } catch (err) {
    safeNotificationLog_("zadarma_balance_error", { http_code: httpCode, message: "invalid_json" });
    return null;
  }
  safeNotificationLog_("zadarma_balance", {
    http_code: httpCode,
    status: String(data.status || ""),
    balance: data.balance == null ? null : Number(data.balance),
    currency: String(data.currency || ""),
  });
  if (httpCode < 200 || httpCode >= 300 || data.status !== "success" || data.balance == null) return null;
  return { balance: Number(data.balance), currency: String(data.currency || "EUR") };
}

function checkZadarmaBalance_() {
  const info = getZadarmaBalance_();
  if (!info || isNaN(info.balance)) return;
  const props = orderNotificationProperties_();
  const previous = String(props.getProperty(ORDER_NOTIFICATION_PROPERTIES_.ZADARMA_BALANCE_LEVEL) || "");
  const level = info.balance < 1 ? "1" : info.balance < 3 ? "3" : "";
  if (!level) {
    if (previous) props.deleteProperty(ORDER_NOTIFICATION_PROPERTIES_.ZADARMA_BALANCE_LEVEL);
    return;
  }
  if (previous === level) return;
  const message = level === "1"
    ? "Warnung: Zadarma-Guthaben unter 1 " + info.currency + " (" + info.balance.toFixed(2) + ")."
    : "Warnung: Zadarma-Guthaben unter 3 " + info.currency + " (" + info.balance.toFixed(2) + ").";
  try {
    const result = sendZadarmaSms_(orderNotificationConfig_().notifyPhone, message, true);
    if (!result || !result.skipped) props.setProperty(ORDER_NOTIFICATION_PROPERTIES_.ZADARMA_BALANCE_LEVEL, level);
  } catch (err) {
    safeNotificationLog_("zadarma_balance_warning_error", { message: redactLogText_(err && err.message, 180) });
  }
}

function zadarmaSignature_(method, params, secret) {
  const query = Object.keys(params).sort().map((key) => formEncode_(key) + "=" + formEncode_(params[key])).join("&");
  const md5 = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, query)
    .map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
  const hmac = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, method + query + md5, secret)
    .map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
  return { query: query, signature: Utilities.base64Encode(hmac) };
}

function sendZadarmaSms_(number, message, skipBalanceCheck) {
  const cfg = orderNotificationConfig_();
  safeNotificationLog_("zadarma_sms_attempt", {
    phone: maskPhone_(number),
    message_length: String(message || "").length,
  });
  if (!cfg.key || !cfg.secret || !number) {
    safeNotificationLog_("zadarma_sms_skipped", {
      reason: !number ? "recipient_missing" : "credentials_missing",
      phone: maskPhone_(number),
    });
    return { ok: false, skipped: true };
  }
  const params = { caller_id: "Teamsale", message: String(message || ""), number: normalizePhone_(number).replace(/^\+/, "") };
  const signed = zadarmaSignature_('/v1/sms/send/', params, cfg.secret);
  const response = UrlFetchApp.fetch("https://api.zadarma.com/v1/sms/send/", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: signed.query,
    headers: { Authorization: cfg.key + ":" + signed.signature },
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  const text = response.getContentText();
  safeNotificationLog_("zadarma_http_response", { http_code: status });
  let data = {};
  try {
    data = JSON.parse(text || "{}");
  } catch (err) {
    safeNotificationLog_("zadarma_response_error", { http_code: status, message: "invalid_json" });
    throw new Error("zadarma_invalid_json");
  }
  safeNotificationLog_("zadarma_response", {
    http_code: status,
    status: String(data.status || ""),
    message: redactLogText_(data.message, 180),
    messages: Number(data.messages || 0),
    cost: data.cost == null ? null : Number(data.cost),
    currency: String(data.currency || ""),
    denied_numbers: safeDeniedNumbers_(data.denied_numbers),
  });
  if (status < 200 || status >= 300) throw new Error("zadarma_http_" + status + ":" + redactLogText_(data.message, 160));
  if (data.status !== "success") throw new Error("zadarma_error:" + redactLogText_(data.message || "unknown", 160));
  if (!skipBalanceCheck) checkZadarmaBalance_();
  return data;
}

function orderSmsText_(item, reminder) {
  const phone = String(item.phone || item.phone_norm || "").trim();
  const name = String(item.message || "").trim().replace(/\s+/g, " ").slice(0, 220);
  return [
    String(item.time || "—"),
    phone || "Keine Telefonnummer",
    (name || "Keine Angabe") + " · #" + String(item.id || "—"),
  ].join("\n");
}

function setOrderNotification_(orderId, field, value) {
  const sh = orderSheet_();
  const head = ensureHeaders_(sh, ORDER_HEADERS_);
  const idCol = head.indexOf("id") + 1;
  const fieldCol = head.indexOf(field) + 1;
  const values = sh.getRange(2, idCol, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  const index = values.findIndex((row) => String(row[0] || "") === String(orderId || ""));
  if (index < 0 || fieldCol < 1) return false;
  sh.getRange(index + 2, fieldCol).setValue(value || new Date());
  return true;
}

function sendOrderConfirmation_(item) {
  if (!item || item.confirmation_sent_at) return;
  try {
    const result = sendZadarmaSms_(orderNotificationConfig_().notifyPhone, orderSmsText_(item, false));
    if (result && result.skipped) return;
    setOrderNotification_(item.id, "confirmation_sent_at", new Date());
  } catch (err) {
    safeNotificationLog_("order_confirmation_error", { message: redactLogText_(err && err.message, 180) });
  }
}

function sendOrderReminder_(item) {
  if (!item || item.reminder_sent_at) return;
  try {
    const result = sendZadarmaSms_(orderNotificationConfig_().notifyPhone, orderSmsText_(item, true));
    if (result && result.skipped) return;
    setOrderNotification_(item.id, "reminder_sent_at", new Date());
  } catch (err) {
    safeNotificationLog_("order_reminder_error", { message: redactLogText_(err && err.message, 180) });
  }
}

function processOrderNotifications() {
  const now = new Date();
  const reminderFrom = new Date(now.getTime() + 10 * 60 * 1000);
  const reminderTo = new Date(now.getTime() + 15 * 60 * 1000);
  const orders = readOrders_();
  let pending = 0;
  orders.forEach((item) => {
    if (item.status === "cancelled" || item.status === "done") return;
    const start = new Date(item.date + "T" + item.time + ":00");
    if (isNaN(start.getTime())) return;
    if (!item.reminder_sent_at && start >= reminderFrom && start <= reminderTo) pending++;
  });
  safeNotificationLog_("order_notifications_scan", { total_orders: orders.length, pending_notifications: pending });
  orders.forEach((item) => {
    if (item.status === "cancelled" || item.status === "done") return;
    const start = new Date(item.date + "T" + item.time + ":00");
    if (isNaN(start.getTime())) return;
    if (start >= reminderFrom && start <= reminderTo) sendOrderReminder_(item);
  });
  safeNotificationLog_("order_notifications_complete", { total_orders: orders.length, pending_notifications: pending });
}

function setupOrderNotificationTrigger() {
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === "processOrderNotifications") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("processOrderNotifications").timeBased().everyMinutes(5).create();
}

function orderDateValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, orderSheetTimeZone_(), "yyyy-MM-dd");
  }
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return !isNaN(parsed.getTime())
    ? Utilities.formatDate(parsed, orderSheetTimeZone_(), "yyyy-MM-dd")
    : text;
}

function orderSheetTimeZone_() {
  try {
    return SpreadsheetApp.getActive().getSpreadsheetTimeZone() || Session.getScriptTimeZone() || "Europe/Vienna";
  } catch (err) {
    return Session.getScriptTimeZone() || "Europe/Vienna";
  }
}

function orderTimeValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, orderSheetTimeZone_(), "HH:mm");
  }
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (match) return String(match[1]).padStart(2, "0") + ":" + match[2];
  const parsed = new Date(text);
  return !isNaN(parsed.getTime())
    ? Utilities.formatDate(parsed, orderSheetTimeZone_(), "HH:mm")
    : text;
}

function createOrder_(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const date = String(data.date || "").trim();
  const time = String(data.time || "").trim();
  const rrule = String(data.rrule || "").trim().toUpperCase();
  const until = String(data.until || "").trim();
  if (!date || !time) throw new Error("date_and_time_required");

  const dates = recurrenceDates_(date, rrule, until);
  const seriesId = dates.length > 1 ? "s_" + Date.now() + "_" + Math.floor(Math.random() * 1000) : "";
  const sh = orderSheet_();
  const head = ensureHeaders_(sh, ORDER_HEADERS_);
  let first = null;

  dates.forEach((occurrenceDate, index) => {
    const item = {
      id: orderId_(), created_at: new Date(), date: occurrenceDate, time: time,
      type: String(data.type || "Orts"), duration_min: Number(data.duration_min || 15),
      phone_raw: String(data.phone || data.phone_raw || "").trim(),
      phone_norm: normalizePhone_(data.phone || data.phone_raw),
      message: String(data.message || "").trim(), rrule: rrule, until: until,
      series_id: seriesId, gcal_event_id: "", status: "open", status_comment: "",
      created_by_name: String(data.created_by_name || ""),
      created_by_device: String(data.created_by_device || ""),
      confirmation_sent_at: "", reminder_sent_at: "",
    };
    sh.appendRow(head.map((key) => item[key] === undefined ? "" : item[key]));
    const row = sh.getLastRow();
    const timeCol = head.indexOf("time") + 1;
    if (timeCol > 0) sh.getRange(row, timeCol).setNumberFormat("@").setValue(time);
    if (!first) first = item;
  });
  return Object.assign({}, first, { recurrence_count: dates.length });
}

function recurrenceDates_(startDate, rule, until) {
  if (!rule) return [startDate];
  if (["DAILY", "WEEKLY", "BIWEEKLY"].indexOf(rule) < 0) throw new Error("invalid_recurrence");
  if (!until) throw new Error("recurrence_until_required");
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(until + "T00:00:00");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) throw new Error("invalid_recurrence_until");
  const step = rule === "DAILY" ? 1 : rule === "BIWEEKLY" ? 14 : 7;
  const result = [];
  for (let current = new Date(start); current <= end && result.length < 366; current.setDate(current.getDate() + step)) {
    result.push(Utilities.formatDate(current, Session.getScriptTimeZone() || "Europe/Vienna", "yyyy-MM-dd"));
  }
  return result;
}

function updateOrder_(id, raw) {
  const orderId = String(id || "").trim();
  const data = raw && typeof raw === "object" ? raw : {};
  const date = String(data.date || "").trim();
  const time = String(data.time || "").trim();
  if (!orderId || !date || !time) throw new Error("order_update_invalid");

  const sh = orderSheet_();
  const head = ensureHeaders_(sh, ORDER_HEADERS_);
  const values = sh.getDataRange().getValues();
  const idIndex = head.indexOf("id");
  const rowIndex = values.slice(1).findIndex((row) => String(row[idIndex] || "") === orderId);
  if (rowIndex < 0) throw new Error("order_not_found");
  const row = rowIndex + 2;
  const set = (key, value) => {
    const col = head.indexOf(key) + 1;
    if (col > 0) sh.getRange(row, col).setValue(value);
  };

  set("date", date);
  const timeCol = head.indexOf("time") + 1;
  if (timeCol > 0) sh.getRange(row, timeCol).setNumberFormat("@").setValue(time);
  set("type", String(data.type || "Orts"));
  set("duration_min", Number(data.duration_min || 15));
  set("phone_raw", String(data.phone || data.phone_raw || "").trim());
  set("phone_norm", normalizePhone_(data.phone || data.phone_raw || ""));
  set("message", String(data.message || "").trim());
  return { id: orderId, date: date, time: time };
}

function readOrders_() {
  const sh = orderSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0].map(String);
  return values.slice(1).map((row, i) => {
    const get = (key) => row[head.indexOf(key)];
    return {
      row_num: i + 2,
      id: String(get("id") || ""),
      created_at: get("created_at"),
      date: orderDateValue_(get("date")),
      time: orderTimeValue_(get("time")),
      type: String(get("type") || "Orts"),
      duration_min: Number(get("duration_min") || 0),
      phone: String(get("phone_raw") || ""),
      phone_norm: String(get("phone_norm") || ""),
      message: String(get("message") || ""),
      rrule: String(get("rrule") || ""),
      until: String(get("until") || ""),
      series_id: String(get("series_id") || ""),
      gcal_event_id: String(get("gcal_event_id") || ""),
      status: String(get("status") || "open"),
      status_comment: String(get("status_comment") || ""),
      created_by_name: String(get("created_by_name") || ""),
      created_by_device: String(get("created_by_device") || ""),
      confirmation_sent_at: get("confirmation_sent_at") || "",
      reminder_sent_at: get("reminder_sent_at") || "",
    };
  });
}

function saveFeedback_(body) {
  const orderId = String(body.order_id || body.orderId || "").trim();
  const rating = Number(body.rating || 0);
  const comment = String(body.comment || "").trim().slice(0, 1000);
  if (!orderId || rating < 1 || rating > 5) throw new Error("feedback_invalid");
  if (!readOrders_().some((item) => item.id === orderId)) throw new Error("order_not_found");
  const item = { id: "f_" + Date.now(), created_at: new Date(), order_id: orderId, rating: rating, comment: comment };
  const sh = feedbackSheet_();
  const head = ensureHeaders_(sh, FEEDBACK_HEADERS_);
  sh.appendRow(head.map((key) => item[key] === undefined ? "" : item[key]));
  return item;
}

function getFeedback_() {
  const sh = feedbackSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0].map(String);
  return values.slice(1).reverse().map((row) => {
    const get = (key) => row[head.indexOf(key)];
    return { id: String(get("id") || ""), created_at: get("created_at"), order_id: String(get("order_id") || ""), rating: Number(get("rating") || 0), comment: String(get("comment") || "") };
  });
}

function getOrdersByDate_(date, includeAll) {
  return readOrders_()
    .filter((item) => !date || item.date === String(date))
    .filter((item) => includeAll || (item.status !== "done" && item.status !== "cancelled"))
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

function getTodoOrders_(hours) {
  const now = new Date();
  const until = new Date(now.getTime() + Math.max(1, hours || 24) * 60 * 60 * 1000);
  return readOrders_().filter((item) => {
    if (item.status === "done" || item.status === "cancelled") return false;
    const start = new Date(item.date + "T" + item.time + ":00");
    item.start_iso = isNaN(start.getTime()) ? "" : start.toISOString();
    item.order_id = item.id;
    return !isNaN(start.getTime()) && start >= now && start <= until;
  });
}

function searchOrders_(query, limit) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return [];
  return readOrders_()
    .filter((item) => [item.phone, item.message, item.type, item.date, item.time].join(" ").toLowerCase().indexOf(q) !== -1)
    .slice(-Math.max(1, limit || 50))
    .reverse();
}

function updateOrderStatus_(id, status, comment, allSeries) {
  const normalizedStatus = String(status || "").toLowerCase();
  if (["done", "cancelled", "open"].indexOf(normalizedStatus) === -1) throw new Error("invalid_status");
  const sh = orderSheet_();
  const head = ensureHeaders_(sh, ORDER_HEADERS_);
  const idCol = head.indexOf("id") + 1;
  const statusCol = head.indexOf("status") + 1;
  const commentCol = head.indexOf("status_comment") + 1;
  const values = sh.getDataRange().getValues();
  const index = values.slice(1).findIndex((row) => String(row[idCol - 1] || "") === String(id || ""));
  if (index < 0) throw new Error("order_not_found");
  const row = index + 2;
  const seriesCol = head.indexOf("series_id");
  const seriesId = seriesCol >= 0 ? String(values[index + 1][seriesCol] || "") : "";
  const rows = allSeries && seriesId
    ? values.slice(1).map((item, i) => String(item[seriesCol] || "") === seriesId ? i + 2 : 0).filter(Boolean)
    : [row];
  rows.forEach((targetRow) => {
    sh.getRange(targetRow, statusCol).setValue(normalizedStatus);
    sh.getRange(targetRow, commentCol).setValue(String(comment || ""));
  });
  return { id: String(id), status: normalizedStatus, comment: String(comment || ""), updated_count: rows.length };
}

function addMessage_(body) {
  const text = String(body.text || "").trim();
  if (!text) throw new Error("empty_message");
  const item = {
    id: "m_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    ts: Date.now(),
    author: String(body.author || ""),
    device: String(body.device || ""),
    text: text,
    is_order: false,
  };
  const sh = messageSheet_();
  const head = ensureHeaders_(sh, MESSAGE_HEADERS_);
  sh.appendRow(head.map((key) => item[key] === undefined ? "" : item[key]));
  return item;
}

function getMessages_(since, limit) {
  const sh = messageSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0].map(String);
  return values.slice(1).map((row) => {
    const get = (key) => row[head.indexOf(key)];
    return { id: String(get("id") || ""), ts: Number(get("ts") || 0), author: String(get("author") || ""), device: String(get("device") || ""), text: String(get("text") || ""), is_order: String(get("is_order") || "") === "true" };
  }).filter((item) => item.ts > Number(since || 0)).slice(-Math.max(1, limit || 300));
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
