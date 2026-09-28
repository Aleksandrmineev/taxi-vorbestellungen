/**
 * Zellstoff Pöls Shuttle: Fahrtenplan per WhatsApp um 20:00 und 11:00.
 * Genau die Zeitpunkte, an denen Änderungen im Lehrlinge-Fahrtenplan schließen
 * (Hinfahrt bis 20:00 am Vortag, Rückfahrt bis 11:00 — siehe lehrlingeCutoffOpen_ in lehrlinge_plan.gs):
 * die Liste ist zu diesem Zeitpunkt endgültig. 20:00 → Hinfahrt morgen, 11:00 → Rückfahrt heute.
 * Route für Route, in Fahrtreihenfolge, mit den Namen je Haltepunkt (wie auf der Fahrtenplan-Seite).
 *
 * Ausgeschaltet, bis setupLehrlingeShuttleSummary() ausgeführt wurde (Script Property LSS_ENABLED).
 */

const LSS_ZONE_ = "Europe/Vienna";
const LSS_PREFIX_ = "LSS_";
const LSS_WHATSAPP_GROUP_JID_ = "436506367662-1552028657@g.us"; // Pöls Lehrlinge-wer fährt?
const LSS_GROUP_PROPERTY_ = "LSS_WHATSAPP_GROUP_JID"; // Script Property: überschreibt die Zielgruppe (z. B. zum Testen)

function lssTarget_(testMode) {
  if (testMode) return LR_WHATSAPP_TEST_TARGET_; // gleicher persönlicher Testkontakt wie bei den Lehrlinge-Erinnerungen
  const override = String(PropertiesService.getScriptProperties().getProperty(LSS_GROUP_PROPERTY_) || "").trim();
  return override || LSS_WHATSAPP_GROUP_JID_;
}

function lssToday_(now) {
  return Utilities.formatDate(now, LSS_ZONE_, "yyyy-MM-dd");
}

const LSS_MORNING_SLOT_ = "20"; // Hinfahrt des nächsten Tages (Frist: 20:00 am Vortag)
const LSS_EVENING_SLOT_ = "11"; // Rückfahrt heute (Frist: 11:00)

function lssDirectionForSlot_(slot) {
  return slot === LSS_EVENING_SLOT_ ? "evening" : "morning";
}

// Fahrtag, um den es in einem Slot geht: 20:00 → morgen, 11:00 → heute.
function lssTripDate_(now, slot) {
  const today = lssToday_(now);
  if (slot !== LSS_MORNING_SLOT_) return today;
  const next = new Date(today + "T12:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function lssDefaultSlot_(now) {
  const hour = Number(Utilities.formatDate(now, LSS_ZONE_, "H"));
  return hour < 11 ? LSS_EVENING_SLOT_ : LSS_MORNING_SLOT_; // die nächste bzw. gerade gesendete Liste
}

// Baut die WhatsApp-Nachricht aus dem Ergebnis von getLehrlingeDriverSchedule_(today, today, "all", direction).
// Route für Route, Haltepunkte in Fahrtreihenfolge, je Haltepunkt die Namen. Rückgabe null = nichts zu senden
// (schulfreier Tag: kein Werktag im Plan oder niemand eingetragen — Ferien/Feiertag/Wochenende).
function lssSummaryText_(scheduleResult, direction, dateLabel) {
  const day = (scheduleResult.days || [])[0];
  const directionLabel = direction === "evening" ? "Rückfahrt" : "Hinfahrt";
  if (!day || !day.routes || !day.routes.length) return null;

  let totalStudents = 0;
  // Nur Fahrgäste, keine Absagen-Zeile (Absagen stehen im Portal; die Gruppe braucht nur, wer fährt).
  const routeBlocks = day.routes.filter(function (route) {
    // Route ohne Fahrten nicht mit anzeigen (z. B. Route 2 fährt an diesem Tag nicht).
    return route.count > 0;
  }).map(function (route) {
    const routeCount = route.count != null ? route.count : route.points.reduce(function (sum, point) { return sum + point.students.length; }, 0);
    totalStudents += routeCount;
    // Nur Namen, keine Adressen — eine Zeile je Lehrling, in Fahrtreihenfolge (Reihenfolge der Punkte).
    const nameLines = route.points.reduce(function (names, point) {
      return names.concat(point.students.map(function (student) { return student.name; }));
    }, []);
    return "Route " + route.route + " (" + routeCount + "):\n" + nameLines.join("\n");
  });

  if (!totalStudents) return null;

  const header = "TaxiApp: Fahrtenplan Zellstoff Pöls — " + directionLabel + " " + dateLabel + " · " + totalStudents + " Lehrlinge";
  return header + "\n\n" + routeBlocks.join("\n\n");
}

/** Nur Vorschau: baut den Text und schreibt ihn ins Journal, sendet nichts. */
function previewLehrlingeShuttleSummary(slot) {
  const now = new Date();
  const useSlot = slot || lssDefaultSlot_(now);
  const direction = lssDirectionForSlot_(useSlot);
  const tripDate = lssTripDate_(now, useSlot);
  const schedule = getLehrlingeDriverSchedule_(tripDate, tripDate, "all", direction);
  const text = lssSummaryText_(schedule, direction, tripDate.slice(8) + "." + tripDate.slice(5, 7) + ".");
  const changes = lssChangesSection_(now);
  const result = { slot: useSlot, direction: direction, date: tripDate, willSend: text !== null, target: lssTarget_(false), text: text && changes ? text + "\n\n" + changes : text };
  console.log(JSON.stringify(result));
  return result;
}

function processLehrlingeShuttleSummary() {
  const props = PropertiesService.getScriptProperties();
  if (String(props.getProperty(LSS_PREFIX_ + "ENABLED") || "") !== "true") return;
  const now = new Date();
  const hour = Utilities.formatDate(now, LSS_ZONE_, "HH");
  if (hour !== LSS_MORNING_SLOT_ && hour !== LSS_EVENING_SLOT_) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    if (String(props.getProperty(LSS_PREFIX_ + "ENABLED") || "") !== "true") return;
    const tripDate = lssTripDate_(now, hour);
    const key = LSS_PREFIX_ + "LAST_" + hour;
    const token = tripDate + ":" + hour;
    const previous = JSON.parse(props.getProperty(key) || "{}");
    if (previous.token === token) return; // für diesen Termin schon gesendet (oder bewusst leer)
    const direction = lssDirectionForSlot_(hour);
    const schedule = getLehrlingeDriverSchedule_(tripDate, tripDate, "all", direction);
    const text = lssSummaryText_(schedule, direction, tripDate.slice(8) + "." + tripDate.slice(5, 7) + ".");
    if (text === null) {
      // Schulfreier Tag (Wochenende/Ferien/Feiertag): keine Nachricht, aber als geprüft markieren.
      props.setProperty(key, JSON.stringify({ token: token, status: "skipped_empty" }));
      return;
    }
    const target = lssTarget_(false);
    const changes = lssChangesSection_(now, hour === LSS_MORNING_SLOT_);
    props.setProperty(key, JSON.stringify({ token: token, status: "attempting" }));
    try {
      sendWhatsAppMessage_(target, changes ? text + "\n\n" + changes : text);
      props.setProperty(key, JSON.stringify({ token: token, status: "sent" }));
      // Erst nach dem Senden weiterschieben: Wochenende/Ferien (keine Nachricht) sammeln sich bis zur nächsten.
      props.setProperty(LSS_CHANGES_SINCE_, now.toISOString());
    } catch (err) {
      props.setProperty(key, JSON.stringify({ token: token, status: "failed_or_unknown" }));
      safeNotificationLog_("lehrlinge_shuttle_error", { message: redactLogText_(err && err.message, 180) });
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Änderungen am Fahrtenplan (Protokoll, lehrlinge_log.gs) hängen an jeder Nachricht (20:00 und 11:00):
 * alles seit der letzten gesendeten Nachricht (höchstens LSS_CHANGES_MAX_DAYS_ zurück).
 * Abschalten: Script Property LSS_CHANGES_ENABLED = false. Nebenbei (20:00): Protokoll auf Vormonat + laufenden Monat kürzen.
 */
const LSS_CHANGES_SINCE_ = LSS_PREFIX_ + "CHANGES_SINCE";
const LSS_CHANGES_MAX_DAYS_ = 7;

function lssChangesSection_(now, prune) {
  const props = PropertiesService.getScriptProperties();
  if (String(props.getProperty(LSS_PREFIX_ + "CHANGES_ENABLED") || "") === "false") return "";
  try {
    if (prune) try { llPrune_(now); } catch (err) { console.warn("lehrlinge log prune failed: " + (err && err.message)); }
    const floor = new Date(now.getTime() - LSS_CHANGES_MAX_DAYS_ * 24 * 3600 * 1000);
    const stored = new Date(props.getProperty(LSS_CHANGES_SINCE_) || "");
    const since = isNaN(stored) || stored < floor
      ? (isNaN(stored) ? new Date(now.getTime() - 24 * 3600 * 1000) : floor)
      : stored;
    return llSummarySection_(since, now);
  } catch (err) {
    console.warn("lehrlinge changes section failed: " + (err && err.message));
    return ""; // der Fahrtenplan geht trotzdem raus
  }
}

function setupLehrlingeShuttleSummary() {
  disableLehrlingeShuttleSummary();
  ScriptApp.newTrigger("processLehrlingeShuttleSummary").timeBased().everyMinutes(5).create();
  PropertiesService.getScriptProperties().setProperty(LSS_PREFIX_ + "ENABLED", "true");
  console.log("Lehrlinge shuttle summary enabled (20:00 Hinfahrt morgen & 11:00 Rückfahrt, Europe/Vienna).");
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
  const useSlot = slot || lssDefaultSlot_(now);
  const direction = lssDirectionForSlot_(useSlot);
  const tripDate = lssTripDate_(now, useSlot);
  const schedule = getLehrlingeDriverSchedule_(tripDate, tripDate, "all", direction);
  const dateLabel = tripDate.slice(8) + "." + tripDate.slice(5, 7) + ".";
  const text = lssSummaryText_(schedule, direction, dateLabel) || ("TaxiApp: Fahrtenplan Zellstoff Pöls — " + (direction === "evening" ? "Rückfahrt" : "Hinfahrt") + " " + dateLabel + "\n\nKeine Fahrten geplant.");
  sendWhatsAppMessage_(LR_WHATSAPP_TEST_TARGET_, "[TEST] " + text);
  console.log("Sent shuttle summary test to the personal number:\n" + text);
  return { slot: useSlot, text: text };
}
