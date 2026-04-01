/** ===== Apps Script: JSON API для GitHub Pages фронта ===== */
const API_SECRET = "102030";
const SHEET_QR = "QR_Zahlungen";

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

    // ===== ВЕТКА АДМИНКИ LEHRLINGE =====
    if (action === "admin_save") {
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
