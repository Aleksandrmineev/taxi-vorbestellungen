/**
 * Vorbestellungen -> Vercel (Redis) Synchronisation.
 *
 * Die Tabelle „Orders“ bleibt die Wahrheit. Dieses Modul schickt eine Kopie aller Bestellungen an
 * /api/orders?op=sync, aus der Vercel die Listen schnell ausliefert. Aus, solange nicht beides gesetzt ist:
 *  - Script Property SYNC_SECRET (dasselbe wie bei Lehrlinge, gleicher Wert wie in Vercel)
 *  - Script Property ORDERS_SYNC_ENABLED = true
 * Ausschalten: removeOrdersSyncTriggers() und ORDERS_SYNC_ENABLED löschen; die Kopie in Redis läuft nach 30 Minuten ab,
 * danach nutzen die Seiten wieder GAS.
 */

const ORDERS_SYNC_DEFAULT_URL = "https://taxi-murtal.vercel.app/api/orders?op=sync";
const ORDERS_SYNC_LAST_KEY = "orders_sync_last_push";
const ORDERS_SYNC_MIN_GAP_MS = 10 * 1000;

function ordersSyncConfig_() {
  const props = PropertiesService.getScriptProperties();
  const secret = String(props.getProperty("SYNC_SECRET") || "").trim();
  const enabled = String(props.getProperty("ORDERS_SYNC_ENABLED") || "").trim().toLowerCase() === "true";
  const url = String(props.getProperty("ORDERS_SYNC_URL") || "").trim() || ORDERS_SYNC_DEFAULT_URL;
  return secret && enabled ? { secret: secret, url: url } : null;
}

/** Vercel ruft GAS mit dem Server-Schlüssel auf (importieren, ändern, Status): nur mit SYNC_SECRET. */
function requireOrdersServerKey_(body) {
  const props = PropertiesService.getScriptProperties();
  const secret = String(props.getProperty("SYNC_SECRET") || "").trim();
  const key = String((body && body.serverKey) || "");
  if (!secret || !key || key !== secret) throw new Error("forbidden");
}

function buildOrdersSyncPayload_() {
  const orders = readOrders_().map(function (order) {
    const copy = Object.assign({}, order);
    delete copy.row_num;
    return copy;
  });
  return { builtAt: new Date().toISOString(), orders: orders, usedIds: orders.map(function (order) { return order.id; }) };
}

/** Sendet alle Bestellungen an Vercel. Wirft bei Fehlern (für Trigger/manuellen Start). */
function pushOrdersSnapshot() {
  const config = ordersSyncConfig_();
  if (!config) return { skipped: true };
  const response = UrlFetchApp.fetch(config.url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + config.secret },
    payload: JSON.stringify(buildOrdersSyncPayload_()),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  if (code !== 200) throw new Error("orders_sync_failed_" + code + ": " + response.getContentText().slice(0, 200));
  PropertiesService.getScriptProperties().setProperty(ORDERS_SYNC_LAST_KEY, String(Date.now()));
  const result = JSON.parse(response.getContentText());
  if (result.outbox && result.outbox.dead > 0) Logger.log("WARNUNG Orders outbox: " + result.outbox.dead + " abgelehnte Eintraege");
  Logger.log("Orders sync: " + JSON.stringify(result));
  return result;
}

/** Nach Schreibvorgängen in GAS: nie den eigentlichen Aufruf stören. */
function pushOrdersSnapshotSafe_() {
  try {
    return pushOrdersSnapshot();
  } catch (error) {
    Logger.log("Orders sync error: " + error);
    return { error: String(error) };
  }
}

/** Installable onEdit: manuelle Änderungen in der Tabelle „Orders“. Höchstens alle 10 s; der 5-Minuten-Trigger fängt den Rest. */
function onOrdersSheetEdit_(e) {
  try {
    if (!ordersSyncConfig_()) return;
    const name = e && e.range && e.range.getSheet().getName();
    if (name !== "Orders") return;
    const last = Number(PropertiesService.getScriptProperties().getProperty(ORDERS_SYNC_LAST_KEY) || 0);
    if (Date.now() - last < ORDERS_SYNC_MIN_GAP_MS) return;
    pushOrdersSnapshotSafe_();
  } catch (error) {
    Logger.log("Orders onEdit sync error: " + error);
  }
}

/** Einmalig von Hand: Trigger (alle 5 Minuten + onEdit) anlegen und sofort den ersten Snapshot senden. */
function installOrdersSyncTriggers() {
  removeOrdersSyncTriggers();
  ScriptApp.newTrigger("pushOrdersSnapshot").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("onOrdersSheetEdit_").forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  return pushOrdersSnapshot();
}

function removeOrdersSyncTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    const handler = trigger.getHandlerFunction();
    if (handler === "pushOrdersSnapshot" || handler === "onOrdersSheetEdit_") ScriptApp.deleteTrigger(trigger);
  });
}
