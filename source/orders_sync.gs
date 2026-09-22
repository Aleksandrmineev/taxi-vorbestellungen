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
function isOrdersServerKey_(body) {
  const props = PropertiesService.getScriptProperties();
  const secret = String(props.getProperty("SYNC_SECRET") || "").trim();
  const key = String((body && body.serverKey) || "");
  return Boolean(secret && key && key === secret);
}

function requireOrdersServerKey_(body) {
  if (!isOrdersServerKey_(body)) throw new Error("forbidden");
}

/**
 * Legt Bestellungen mit fertigen Nummern an (von Vercel, nach dem Speichern in Redis). Idempotent:
 *  - Nummer existiert schon mit gleichem Inhalt: übersprungen (Wiederholung nach unklarem Ergebnis);
 *  - Nummer existiert mit anderem Inhalt (Kollision): neue Nummer, Zuordnung in `renamed`.
 * Rückgabe: { imported, skipped: [ids], renamed: { alt: neu } }
 */
function importOrders_(items) {
  const list = typeof items === "string" ? JSON.parse(items) : items;
  if (!Array.isArray(list) || !list.length) return { imported: 0, skipped: [], renamed: {} };
  if (list.length > 400) throw new Error("too_many_orders");
  const sh = orderSheet_();
  const head = ensureHeaders_(sh, ORDER_HEADERS_);
  const col = function (name) { return head.indexOf(name); };
  const values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues() : [];
  const existing = {};
  values.forEach(function (row) { existing[String(row[col("id")] || "").trim()] = row; });

  const sameOrder = function (row, item) {
    return orderDateValue_(row[col("date")]) === String(item.date) &&
      orderTimeValue_(row[col("time")]) === String(item.time) &&
      String(row[col("message")] || "").trim() === String(item.message || "").trim() &&
      String(row[col("phone_raw")] || "").trim() === String(item.phone || "").trim();
  };

  const rows = [];
  const skipped = [];
  const renamed = {};
  list.forEach(function (item) {
    let id = String((item && item.id) || "").trim();
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.date || "")) || !/^\d{2}:\d{2}$/.test(String(item.time || ""))) throw new Error("invalid_order");
    if (["open", "done", "cancelled"].indexOf(String(item.status || "open")) < 0) throw new Error("invalid_order");
    if (existing[id]) {
      if (existing[id] !== true && sameOrder(existing[id], item)) { skipped.push(id); return; }
      const fresh = orderId_();
      renamed[id] = fresh;
      id = fresh;
    }
    existing[id] = true;
    const record = Object.assign({}, item, {
      id: id,
      phone_raw: String(item.phone || ""),
      created_at: item.created_at ? new Date(item.created_at) : new Date(),
    });
    rows.push(head.map(function (key) { return record[key] === undefined ? "" : record[key]; }));
  });

  if (rows.length) {
    const start = sh.getLastRow() + 1;
    const timeCol = col("time") + 1;
    if (timeCol > 0) sh.getRange(start, timeCol, rows.length, 1).setNumberFormat("@"); // Uhrzeit bleibt Text
    sh.getRange(start, 1, rows.length, head.length).setValues(rows);
  }
  return { imported: rows.length, skipped: skipped, renamed: renamed };
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
