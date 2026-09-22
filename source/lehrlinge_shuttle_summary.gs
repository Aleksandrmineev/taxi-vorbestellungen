/**
 * Zellstoff Pöls Shuttle: Fahrtenplan per WhatsApp um 03:00 und 12:00.
 * Genau die Zeitpunkte, an denen Änderungen im Lehrlinge-Fahrtenplan schließen
 * (Hinfahrt bis 03:00, Rückfahrt bis 12:00 — siehe lehrlingeCutoffOpen_ in lehrlinge_plan.gs):
 * die Liste ist zu diesem Zeitpunkt endgültig. 03:00 → Hinfahrt heute, 12:00 → Rückfahrt heute.
 * Route für Route, in Fahrtreihenfolge, mit den Namen je Haltepunkt (wie auf der Fahrtenplan-Seite).
 *
 * Ausgeschaltet, bis setupLehrlingeShuttleSummary() ausgeführt wurde (Script Property LSS_ENABLED).
 */

const LSS_ZONE_ = "Europe/Vienna";
const LSS_PREFIX_ = "LSS_";
const LSS_WHATSAPP_GROUP_JID_ = "436506367662-1535622857@g.us"; // Zellstoff Pöls Shuttle
const LSS_GROUP_PROPERTY_ = "LSS_WHATSAPP_GROUP_JID"; // Script Property: überschreibt die Zielgruppe (z. B. zum Testen)

function lssTarget_(testMode) {
  if (testMode) return LR_WHATSAPP_TEST_TARGET_; // gleicher persönlicher Testkontakt wie bei den Lehrlinge-Erinnerungen
  const override = String(PropertiesService.getScriptProperties().getProperty(LSS_GROUP_PROPERTY_) || "").trim();
  return override || LSS_WHATSAPP_GROUP_JID_;
}

function lssToday_(now) {
  return Utilities.formatDate(now, LSS_ZONE_, "yyyy-MM-dd");
}

function lssDirectionForSlot_(slot) {
  return slot === "12" ? "evening" : "morning";
}

// Baut die WhatsApp-Nachricht aus dem Ergebnis von getLehrlingeDriverSchedule_(today, today, "all", direction).
// Route für Route, Haltepunkte in Fahrtreihenfolge, je Haltepunkt die Namen. Rückgabe null = nichts zu senden
// (schulfreier Tag: kein Werktag im Plan oder niemand eingetragen — Ferien/Feiertag/Wochenende).
function lssSummaryText_(scheduleResult, direction, dateLabel) {
  const day = (scheduleResult.days || [])[0];
  const directionLabel = direction === "evening" ? "Rückfahrt" : "Hinfahrt";
  if (!day || !day.routes || !day.routes.length) return null;

  let totalStudents = 0;
  let totalCancellations = 0;
  const routeBlocks = day.routes.map(function (route) {
    const routeCount = route.count != null ? route.count : route.points.reduce(function (sum, point) { return sum + point.students.length; }, 0);
    totalStudents += routeCount;
    const pointLines = route.points
      .filter(function (point) { return point.students.length; })
      .map(function (point) {
        const names = point.students.map(function (student) { return student.name; }).join(", ");
        return point.address + ": " + names;
      });
    const cancellations = route.cancellations || [];
    totalCancellations += cancellations.length;
    const cancelBlock = cancellations.length
      ? "\nAbsagen: " + cancellations.map(function (item) { return item.name; }).join(", ")
      : "";
    return "Route " + route.route + " (" + routeCount + "):\n" + pointLines.join("\n") + cancelBlock;
  }).filter(function (block, index) {
    // Route ohne Fahrten und ohne Absagen nicht mit anzeigen (z. B. Route 2 fährt an diesem Tag nicht).
    return day.routes[index].count > 0 || (day.routes[index].cancellations || []).length > 0;
  });

  if (!totalStudents && !totalCancellations) return null;

  const header = "TaxiApp: Fahrtenplan Zellstoff Pöls — " + directionLabel + " " + dateLabel + " · " + totalStudents + " Lehrlinge";
  return header + "\n\n" + routeBlocks.join("\n\n");
}

/** Nur Vorschau: baut den Text und schreibt ihn ins Journal, sendet nichts. */
function previewLehrlingeShuttleSummary(slot) {
  const now = new Date();
  const useSlot = slot || (Number(Utilities.formatDate(now, LSS_ZONE_, "H")) < 8 ? "03" : "12");
  const direction = lssDirectionForSlot_(useSlot);
  const today = lssToday_(now);
  const schedule = getLehrlingeDriverSchedule_(today, today, "all", direction);
  const text = lssSummaryText_(schedule, direction, today.slice(8) + "." + today.slice(5, 7) + ".");
  const result = { slot: useSlot, direction: direction, date: today, willSend: text !== null, target: lssTarget_(false), text: text };
  console.log(JSON.stringify(result));
  return result;
}

function processLehrlingeShuttleSummary() {
  const props = PropertiesService.getScriptProperties();
  if (String(props.getProperty(LSS_PREFIX_ + "ENABLED") || "") !== "true") return;
  const now = new Date();
  const hour = Utilities.formatDate(now, LSS_ZONE_, "HH");
  if (hour !== "03" && hour !== "12") return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    if (String(props.getProperty(LSS_PREFIX_ + "ENABLED") || "") !== "true") return;
    const today = lssToday_(now);
    const key = LSS_PREFIX_ + "LAST_" + hour;
    const token = today + ":" + hour;
    const previous = JSON.parse(props.getProperty(key) || "{}");
    if (previous.token === token) return; // für diesen Termin schon gesendet (oder bewusst leer)
    const direction = lssDirectionForSlot_(hour);
    const schedule = getLehrlingeDriverSchedule_(today, today, "all", direction);
    const text = lssSummaryText_(schedule, direction, today.slice(8) + "." + today.slice(5, 7) + ".");
    if (text === null) {
      // Schulfreier Tag (Wochenende/Ferien/Feiertag): keine Nachricht, aber als geprüft markieren.
      props.setProperty(key, JSON.stringify({ token: token, status: "skipped_empty" }));
      return;
    }
    const target = lssTarget_(false);
    props.setProperty(key, JSON.stringify({ token: token, status: "attempting" }));
    try {
      sendWhatsAppMessage_(target, text);
      props.setProperty(key, JSON.stringify({ token: token, status: "sent" }));
    } catch (err) {
      props.setProperty(key, JSON.stringify({ token: token, status: "failed_or_unknown" }));
      safeNotificationLog_("lehrlinge_shuttle_error", { message: redactLogText_(err && err.message, 180) });
    }
  } finally {
    lock.releaseLock();
  }
}

function setupLehrlingeShuttleSummary() {
  disableLehrlingeShuttleSummary();
  ScriptApp.newTrigger("processLehrlingeShuttleSummary").timeBased().everyMinutes(5).create();
  PropertiesService.getScriptProperties().setProperty(LSS_PREFIX_ + "ENABLED", "true");
  console.log("Lehrlinge shuttle summary enabled (03:00 & 12:00, Europe/Vienna).");
}

function disableLehrlingeShuttleSummary() {
  PropertiesService.getScriptProperties().setProperty(LSS_PREFIX_ + "ENABLED", "false");
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "processLehrlingeShuttleSummary") ScriptApp.deleteTrigger(trigger);
  });
}

/** Manueller Test jederzeit: sendet die aktuelle Liste (auch „keine Fahrten“) nur an die persönliche Testnummer. */
function sendLehrlingeShuttleSummaryTestNow(slot) {
  const now = new Date();
  const useSlot = slot || (Number(Utilities.formatDate(now, LSS_ZONE_, "H")) < 8 ? "03" : "12");
  const direction = lssDirectionForSlot_(useSlot);
  const today = lssToday_(now);
  const schedule = getLehrlingeDriverSchedule_(today, today, "all", direction);
  const dateLabel = today.slice(8) + "." + today.slice(5, 7) + ".";
  const text = lssSummaryText_(schedule, direction, dateLabel) || ("TaxiApp: Fahrtenplan Zellstoff Pöls — " + (direction === "evening" ? "Rückfahrt" : "Hinfahrt") + " " + dateLabel + "\n\nKeine Fahrten geplant.");
  sendWhatsAppMessage_(LR_WHATSAPP_TEST_TARGET_, "[TEST] " + text);
  console.log("Sent shuttle summary test to the personal number:\n" + text);
  return { slot: useSlot, text: text };
}
