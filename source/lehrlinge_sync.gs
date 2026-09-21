/**
 * Lehrlinge -> Vercel (Redis) sync.
 *
 * Таблица остаётся источником правды. Этот модуль отправляет на Vercel копию данных
 * (точки, ученики, водители без PIN, план), из которой Vercel строит расписание без обращения к GAS.
 *
 * Модуль выключен, пока не задана Script Property SYNC_SECRET (тот же секрет, что в Vercel).
 * VERCEL_SYNC_URL необязателен (по умолчанию LEHRLINGE_SYNC_DEFAULT_URL). Секреты в код не вписывать.
 */

const LEHRLINGE_SYNC_PLAN_DAYS_BACK = 7;
const LEHRLINGE_SYNC_MIN_GAP_MS = 10 * 1000;
const LEHRLINGE_SYNC_LAST_KEY = "lehrlinge_sync_last_push";

const LEHRLINGE_SYNC_DEFAULT_URL = "https://taxi-murtal.vercel.app/api/lehrlinge/sync";

/** Единственный обязательный параметр — Script Property SYNC_SECRET (в код не вписывать!). Без него модуль выключен. */
function lehrlingeSyncConfig_() {
  const props = PropertiesService.getScriptProperties();
  const secret = String(props.getProperty("SYNC_SECRET") || "").trim();
  const url = String(props.getProperty("VERCEL_SYNC_URL") || "").trim() || LEHRLINGE_SYNC_DEFAULT_URL;
  return secret ? { secret: secret, url: url } : null;
}

/** Подтверждает вызов от Vercel: SYNC_SECRET совпал -> доверяем driverJson (после проверки водителя в таблице). */
function requireTrustedDriver_(body) {
  const config = lehrlingeSyncConfig_();
  const key = String((body && body.serverKey) || "");
  if (!config || !key || key !== config.secret) throw new Error("driver_auth_required");
  let claimed;
  try { claimed = JSON.parse(String(body.driverJson || "{}")); } catch (_) { throw new Error("driver_auth_required"); }
  const driver = getDriverAuthRecordById_(String((claimed && claimed.id) || "").trim());
  if (!driver || driver.active !== "1") throw new Error("driver_auth_required");
  return driver;
}

/** Проверка токена водителя для обмена на JWT на Vercel. */
function driverWhoAmI_(body) {
  const driver = requireDriverToken_(String(body.driverToken || ""));
  return { id: driver.id, name: driver.name, surname: driver.surname, taxiNumber: driver.taxiNumber };
}

function buildLehrlingeSyncPayload_() {
  const ss = SpreadsheetApp.getActive();

  const points = [];
  const pointSheet = ss.getSheetByName("Points");
  if (pointSheet && pointSheet.getLastRow() >= 2) {
    const range = pointSheet.getRange(2, 1, pointSheet.getLastRow() - 1, Math.max(8, pointSheet.getLastColumn()));
    const values = range.getValues();
    const display = range.getDisplayValues();
    values.forEach(function (row, index) {
      const id = String(row[0] || "").trim();
      if (!id) return;
      points.push({
        id: id,
        name: String(row[1] || ""),
        route: String(row[2] || ""),
        active: String(row[3] || "") === "1" ? "1" : "0",
        url: String(row[4] || "").trim(),
        phone: String(row[6] || "").trim(),
        arrival_time: pointTimeValue_(display[index][7] || row[7]),
      });
    });
  }

  const students = [];
  const studentSheet = ss.getSheetByName(LEHRLINGE_STUDENTS_SHEET);
  if (studentSheet && studentSheet.getLastRow() >= 2) {
    studentSheet.getRange(2, 1, studentSheet.getLastRow() - 1, LEHRLINGE_STUDENT_HEADERS.length).getValues().forEach(function (row) {
      const id = String(row[0] || "").trim();
      if (!id) return;
      students.push({
        id: id,
        name: String(row[1] || "").trim(),
        pointId: String(row[2] || "").trim(),
        active: String(row[3] || "") === "1" ? "1" : "0",
      });
    });
  }

  const driverSheet = ss.getSheetByName("Drivers");
  const drivers = driverSheet ? readDriversSheet_(driverSheet).map(function (driver) {
    return { id: driver.id, name: driver.name, surname: driver.surname, taxiNumber: driver.taxi_number, active: driver.active };
  }) : [];

  const from = Utilities.formatDate(new Date(Date.now() - LEHRLINGE_SYNC_PLAN_DAYS_BACK * 86400000), "Europe/Vienna", "yyyy-MM-dd");
  const plan = getLehrlingePlan_(from, "").items;

  return { builtAt: new Date().toISOString(), points: points, students: students, drivers: drivers, plan: plan };
}

/** Отправляет снапшот на Vercel. Бросает исключение при ошибке (для триггера/ручного запуска). */
function pushLehrlingeSnapshot() {
  const config = lehrlingeSyncConfig_();
  if (!config) return { skipped: true };
  const response = UrlFetchApp.fetch(config.url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + config.secret },
    payload: JSON.stringify(buildLehrlingeSyncPayload_()),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  if (code !== 200) throw new Error("lehrlinge_sync_failed_" + code + ": " + response.getContentText().slice(0, 200));
  PropertiesService.getScriptProperties().setProperty(LEHRLINGE_SYNC_LAST_KEY, String(Date.now()));
  const result = JSON.parse(response.getContentText());
  // outbox.dead > 0: Vercel не смог записать изменения водителей в таблицу (см. Redis lehrlinge:outbox:dead).
  if (result.outbox && result.outbox.dead > 0) Logger.log("WARNUNG Lehrlinge outbox: " + result.outbox.dead + " abgelehnte Eintraege");
  return result;
}

/** Вариант для вызова после записи данных: никогда не ломает основной запрос. */
function pushLehrlingeSnapshotSafe_() {
  try {
    return pushLehrlingeSnapshot();
  } catch (error) {
    Logger.log("Lehrlinge sync error: " + error);
    return { error: String(error) };
  }
}

/** Installable onEdit: правки вручную в таблице. Не чаще одного раза в 10 с; 5-минутный триггер страхует остальное. */
function onLehrlingeSheetEdit_(e) {
  try {
    if (!lehrlingeSyncConfig_()) return;
    const name = e && e.range && e.range.getSheet().getName();
    if (["Points", "Drivers", LEHRLINGE_STUDENTS_SHEET, LEHRLINGE_PLAN_SHEET].indexOf(name) < 0) return;
    const last = Number(PropertiesService.getScriptProperties().getProperty(LEHRLINGE_SYNC_LAST_KEY) || 0);
    if (Date.now() - last < LEHRLINGE_SYNC_MIN_GAP_MS) return;
    pushLehrlingeSnapshotSafe_();
  } catch (error) {
    Logger.log("Lehrlinge onEdit sync error: " + error);
  }
}

/** Одноразово запустить вручную в редакторе после задания Script Properties. */
function installLehrlingeSyncTriggers() {
  removeLehrlingeSyncTriggers();
  ScriptApp.newTrigger("pushLehrlingeSnapshot").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("onLehrlingeSheetEdit_").forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  return pushLehrlingeSnapshot();
}

function removeLehrlingeSyncTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    const handler = trigger.getHandlerFunction();
    if (handler === "pushLehrlingeSnapshot" || handler === "onLehrlingeSheetEdit_") ScriptApp.deleteTrigger(trigger);
  });
}
