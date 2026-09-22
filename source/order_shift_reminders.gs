/**
 * Vorbestellungen: Schicht-Übersicht per WhatsApp um 06:00 und 18:00.
 * Sendet die Liste der Fahrten der nächsten 12 Stunden (die anlaufende Schicht) an dieselbe Gruppe
 * wie die einzelnen Erinnerungen (Script Property ORDER_WHATSAPP_GROUP_JID, siehe code.gs).
 *
 * Ausgeschaltet, bis setupOrderShiftReminders() ausgeführt wurde (Script Property ORDER_SHIFT_ENABLED).
 */

const OSR_ZONE_ = "Europe/Vienna";
const OSR_PREFIX_ = "ORDER_SHIFT_";

function osrConfigured_() {
  return Boolean(orderWhatsAppTarget_(false));
}

// Fenster der anlaufenden Schicht: 06:00 -> heute 18:00, 18:00 -> morgen 06:00.
function osrWindow_(now, slot) {
  const dateLabel = Utilities.formatDate(now, OSR_ZONE_, "yyyy-MM-dd");
  const from = new Date(dateLabel + "T" + slot + ":00:00");
  const to = new Date(from.getTime() + 12 * 60 * 60 * 1000);
  return { from: from, to: to, dateLabel: dateLabel, slot: slot };
}

function osrOrdersInWindow_(orders, window) {
  return orders
    .filter(function (item) { return item.status !== "cancelled" && item.status !== "done"; })
    .map(function (item) {
      const start = new Date(item.date + "T" + item.time + ":00");
      return { item: item, start: start };
    })
    .filter(function (row) { return !isNaN(row.start.getTime()) && row.start >= window.from && row.start < window.to; })
    .sort(function (a, b) { return a.start - b.start; })
    .map(function (row) { return row.item; });
}

function osrSummaryText_(orders, window) {
  // "Nachtschicht"/"Tagschicht" statt Uhrzeiten — kurz und eindeutig genug. Die Nachtschicht geht über
  // Mitternacht, daher das Datum vom Schichtende (Folgetag-Morgen); die Tagschicht ist immer derselbe
  // Kalendertag wie ihr Start. Nie die Uhrzeit im Header, die steckt schon im Schicht-Namen.
  const shiftLabel = window.slot === "18" ? "Nachtschicht" : "Tagschicht";
  const dateLabel = Utilities.formatDate(window.slot === "18" ? window.to : window.from, OSR_ZONE_, "dd.MM.");
  const count = orders.length + " Fahrt" + (orders.length === 1 ? "" : "en");
  const header = "TaxiApp: " + shiftLabel + " " + dateLabel + " · " + count;
  if (!orders.length) return header + "\nKeine Vorbestellungen in diesem Zeitraum.";
  const lines = orders.map(function (item) {
    const message = String(item.message || "").trim().replace(/\s+/g, " ").slice(0, 160);
    const phone = String(item.phone || item.phone_raw || item.phone_norm || "").trim();
    return [
      item.time,
      message,
      phone ? "Tel: " + phone : "",
      "#" + String(item.id || "—"),
    ].filter(Boolean).join(" · ");
  });
  return header + ":\n" + lines.join("\n");
}

function previewOrderShiftSummary(slot) {
  const window = osrWindow_(new Date(), slot || (Number(Utilities.formatDate(new Date(), OSR_ZONE_, "H")) < 12 ? "06" : "18"));
  const orders = osrOrdersInWindow_(readOrders_(), window);
  const text = osrSummaryText_(orders, window);
  const result = { window: { from: window.from.toISOString(), to: window.to.toISOString() }, count: orders.length, target: orderWhatsAppTarget_(false), text: text };
  console.log(JSON.stringify(result));
  return result;
}

function processOrderShiftReminders() {
  const props = PropertiesService.getScriptProperties();
  if (String(props.getProperty(OSR_PREFIX_ + "ENABLED") || "") !== "true") return;
  const now = new Date();
  const hour = Utilities.formatDate(now, OSR_ZONE_, "HH");
  if (hour !== "06" && hour !== "18") return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    if (String(props.getProperty(OSR_PREFIX_ + "ENABLED") || "") !== "true") return;
    const window = osrWindow_(now, hour);
    const key = OSR_PREFIX_ + "LAST_" + hour;
    const token = window.dateLabel + ":" + hour;
    const previous = JSON.parse(props.getProperty(key) || "{}");
    if (previous.token === token) return; // schon für diesen Termin gesendet
    const target = orderWhatsAppTarget_(false);
    if (!target) {
      safeNotificationLog_("order_shift_skipped", { reason: "group_not_configured" });
      return;
    }
    props.setProperty(key, JSON.stringify({ token: token, status: "attempting" }));
    const orders = osrOrdersInWindow_(readOrders_(), window);
    const text = osrSummaryText_(orders, window);
    try {
      sendWhatsAppMessage_(target, text);
      props.setProperty(key, JSON.stringify({ token: token, status: "sent", count: orders.length }));
    } catch (err) {
      props.setProperty(key, JSON.stringify({ token: token, status: "failed_or_unknown" }));
      safeNotificationLog_("order_shift_error", { message: redactLogText_(err && err.message, 180) });
    }
  } finally {
    lock.releaseLock();
  }
}

function setupOrderShiftReminders() {
  if (!osrConfigured_()) throw new Error("ORDER_WHATSAPP_GROUP_JID not configured; set it before enabling");
  disableOrderShiftReminders();
  ScriptApp.newTrigger("processOrderShiftReminders").timeBased().everyMinutes(5).create();
  PropertiesService.getScriptProperties().setProperty(OSR_PREFIX_ + "ENABLED", "true");
  console.log("Order shift reminders enabled (06:00 & 18:00, Europe/Vienna).");
}

function disableOrderShiftReminders() {
  PropertiesService.getScriptProperties().setProperty(OSR_PREFIX_ + "ENABLED", "false");
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "processOrderShiftReminders") ScriptApp.deleteTrigger(trigger);
  });
}

/** Manueller Test jederzeit: schickt die aktuelle Übersicht nur an die persönliche Testnummer. */
function sendOrderShiftSummaryTestNow(slot) {
  const window = osrWindow_(new Date(), slot || (Number(Utilities.formatDate(new Date(), OSR_ZONE_, "H")) < 12 ? "06" : "18"));
  const orders = osrOrdersInWindow_(readOrders_(), window);
  const text = "[TEST] " + osrSummaryText_(orders, window);
  sendWhatsAppMessage_(ORDER_WHATSAPP_TEST_TARGET_, text);
  console.log("Sent shift summary test (" + orders.length + " orders) to test number.");
}
