/**
 * Lehrlinge: Änderungsprotokoll des Fahrtenplans (+ Logins der Lehrlinge mit eigenem Konto).
 *
 * Jede echte Änderung (alter Status != neuer Status) aus saveLehrlingePlan_ landet als Zeile in _LehrlingeLog:
 * wer (eigenes Konto / gemeinsames Konto / Fahrer / Büro), welcher Lehrling, welcher Tag, von -> nach.
 * Manuelle Änderungen direkt im Sheet werden nicht erfasst. Aufbewahrung: Vormonat + laufender Monat.
 * Ein Fehler beim Protokollieren bricht nie das Speichern ab (nur console.warn).
 */

const LL_SHEET_ = "_LehrlingeLog";
const LL_HEADERS_ = ["at", "event", "channel", "actor", "student_id", "date", "from", "to"];
const LL_ZONE_ = "Europe/Vienna";
const LL_MAX_ENTRIES_ = 400;
const LL_SUMMARY_MAX_LINES_ = 25;
const LL_BULK_MIN_ = 4; // gleiche Änderung desselben Absenders für >= 4 Lehrlinge -> eine Sammelzeile

/** updatedBy aus saveLehrlingePlan_ -> Kanal. */
function llChannel_(updatedBy) {
  const value = String(updatedBy || "").trim();
  if (value.indexOf("portal:") === 0) return "shared";
  if (value.indexOf("driver:") === 0) return "driver";
  if (!value || value === "admin" || value.indexOf(":") >= 0) return "admin";
  return "student"; // eigene Lehrling-ID
}

function llSheet_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(LL_SHEET_) || ss.insertSheet(LL_SHEET_);
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, LL_HEADERS_.length).setValues([LL_HEADERS_]);
  return sh;
}

function llAppend_(rows) {
  if (!rows.length) return;
  const sh = llSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, LL_HEADERS_.length).setValues(rows);
}

/** changes: [{ date, student_id, from, to }] — nur echte Änderungen. */
function llRecordPlanChanges_(changes, updatedBy, now) {
  try {
    const at = now || new Date();
    const channel = llChannel_(updatedBy);
    llAppend_((changes || []).map((c) => [at, "plan", channel, String(updatedBy || "admin"), c.student_id, c.date, c.from, c.to]));
  } catch (err) {
    console.warn("lehrlinge log failed: " + (err && err.message));
  }
}

function llRecordLogin_(studentId, now) {
  try {
    llAppend_([[now || new Date(), "login", "student", String(studentId || ""), String(studentId || ""), "", "", ""]]);
  } catch (err) {
    console.warn("lehrlinge login log failed: " + (err && err.message));
  }
}

function llIsoDate_(value) {
  if (value instanceof Date && !isNaN(value)) return Utilities.formatDate(value, LL_ZONE_, "yyyy-MM-dd");
  return typeof lehrlingePlanDate_ === "function" ? lehrlingePlanDate_(value) : String(value || "").slice(0, 10);
}

function llReadRows_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(LL_SHEET_);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, LL_HEADERS_.length).getValues().map((r) => ({
    at: r[0] instanceof Date ? r[0] : new Date(r[0]),
    event: String(r[1] || ""),
    channel: String(r[2] || ""),
    actor: String(r[3] || ""),
    studentId: String(r[4] || "").trim(),
    date: r[5] ? llIsoDate_(r[5]) : "",
    from: String(r[6] || ""),
    to: String(r[7] || ""),
  })).filter((e) => !isNaN(e.at));
}

function llStudents_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(LEHRLINGE_STUDENTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues()
    .map((r) => ({ id: String(r[0] || "").trim(), name: String(r[1] || "").trim(), active: String(r[3] || "") === "1", hasPin: Boolean(String(r[4] || "").trim()) }))
    .filter((s) => s.id);
}

const LL_FLAGS_ = { both: [true, true], out: [true, false], back: [false, true], none: [false, false] };

/** Kurzbeschreibung einer Änderung, z. B. "24.09. Hinfahrt ✗" oder "24.09. keine Fahrt". */
function llDescribe_(date, from, to) {
  const label = date ? date.slice(8, 10) + "." + date.slice(5, 7) + ". " : "";
  const a = LL_FLAGS_[from] || [false, false];
  const b = LL_FLAGS_[to] || [false, false];
  if (to === "none" && from !== "none") return label + "keine Fahrt";
  if (to === "both" && from === "none") return label + "Hin- und Rückfahrt ✓";
  const parts = [];
  if (a[0] !== b[0]) parts.push("Hinfahrt " + (b[0] ? "✓" : "✗"));
  if (a[1] !== b[1]) parts.push("Rückfahrt " + (b[1] ? "✓" : "✗"));
  return label + parts.join(", ");
}

/** Anzeigename des Absenders je nach Publikum. Lehrlinge sehen keine Taxinummern. */
function llActorLabel_(entry, audience, names) {
  if (entry.channel === "student") return audience === "student" ? "Eigenes Konto" : (names[entry.actor] || entry.actor) + " (eigenes Konto)";
  if (entry.channel === "shared") return "Gemeinsames Konto";
  if (entry.channel === "driver") return audience === "student" ? "Fahrer" : "Fahrer " + entry.actor.replace(/^driver:/, "Taxi ");
  return "Büro";
}

/**
 * Protokoll lesen, neueste zuerst.
 * audience "driver": alles inkl. Logins; "student": nur Planänderungen eines Lehrlings, ohne Taxinummern.
 */
function llReadLog_(options) {
  const opts = options || {};
  const audience = opts.audience === "student" ? "student" : "driver";
  const studentId = String(opts.studentId || "").trim().toLowerCase();
  if (audience === "student" && !studentId) throw new Error("student_not_found");
  const names = {};
  llStudents_().forEach((s) => { names[s.id] = s.name; });
  return llReadRows_()
    .filter((e) => (!studentId || e.studentId.toLowerCase() === studentId) && (audience === "driver" || e.event === "plan"))
    .reverse()
    .slice(0, LL_MAX_ENTRIES_)
    .map((e) => ({
      at: e.at.toISOString(),
      event: e.event,
      channel: e.channel,
      actor: llActorLabel_(e, audience, names),
      studentId: e.studentId,
      studentName: names[e.studentId] || e.studentId,
      date: e.date,
      from: e.from,
      to: e.to,
      text: e.event === "login" ? "Login mit eigenem Konto" : llDescribe_(e.date, e.from, e.to),
    }));
}

/**
 * Kontostatus je aktivem Lehrling: "no_pin" (kein eigenes Konto), "never" (PIN gesetzt, nie eingeloggt), "active".
 * Letzter Login = neuester aus Protokoll und gespeichertem „angemeldet bleiben“-Token (expiresAt - Laufzeit = Loginzeit).
 */
function llAccountStatus_() {
  const rows = llReadRows_();
  const props = PropertiesService.getScriptProperties();
  return llStudents_().filter((s) => s.active).map((s) => {
    let lastLogin = null;
    const lastChange = {};
    rows.forEach((e) => {
      if (e.studentId !== s.id) return;
      if (e.event === "login" && (!lastLogin || e.at > lastLogin)) lastLogin = e.at;
      if (e.event === "plan" && (!lastChange[e.channel] || e.at > lastChange[e.channel])) lastChange[e.channel] = e.at;
    });
    try {
      const token = JSON.parse(props.getProperty(LEHRLINGE_REMEMBER_TOKEN_PREFIX + s.id) || "null");
      if (token && token.expiresAt) {
        const loginAt = new Date(Number(token.expiresAt) - LEHRLINGE_REMEMBER_TOKEN_TTL_SEC * 1000);
        if (!lastLogin || loginAt > lastLogin) lastLogin = loginAt;
      }
    } catch (_) { /* defektes Property ignorieren */ }
    // Eigene Änderungen gehen nur mit Login: dann gilt das Konto sicher als benutzt.
    if (!lastLogin && lastChange.student) lastLogin = lastChange.student;
    const iso = (d) => (d ? d.toISOString() : "");
    return {
      id: s.id,
      name: s.name,
      status: !s.hasPin ? "no_pin" : lastLogin ? "active" : "never",
      lastLogin: iso(lastLogin),
      lastOwnChange: iso(lastChange.student),
      lastSharedChange: iso(lastChange.shared),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Löscht Einträge vor dem 1. des Vormonats. Zeilen sind chronologisch, alte stehen oben. */
function llPrune_(now) {
  const sh = SpreadsheetApp.getActive().getSheetByName(LL_SHEET_);
  if (!sh || sh.getLastRow() < 2) return 0;
  const today = Utilities.formatDate(now || new Date(), LL_ZONE_, "yyyy-MM-dd");
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7)) - 1;
  if (month === 0) { month = 12; year -= 1; }
  const keepFrom = year + "-" + String(month).padStart(2, "0") + "-01";
  const stamps = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  let old = 0;
  while (old < stamps.length) {
    const at = stamps[old][0] instanceof Date ? stamps[old][0] : new Date(stamps[old][0]);
    if (isNaN(at) || Utilities.formatDate(at, LL_ZONE_, "yyyy-MM-dd") >= keepFrom) break;
    old += 1;
  }
  if (old) sh.deleteRows(2, old);
  return old;
}

/**
 * Kurze Änderungsübersicht für die WhatsApp-Gruppe: nur Planänderungen im Zeitraum (since, until],
 * je Lehrling und Tag netto (erste "von" -> letzte "nach"; hin und zurück geändert = keine Zeile).
 * Rückgabe "" wenn nichts geändert wurde.
 */
function llSummarySection_(since, until) {
  const names = {};
  llStudents_().forEach((s) => { names[s.id] = s.name; });
  const net = {};
  const order = [];
  llReadRows_().forEach((e) => {
    if (e.event !== "plan" || e.at <= since || e.at > until) return;
    const key = e.studentId + "|" + e.date;
    if (!net[key]) { net[key] = { studentId: e.studentId, date: e.date, from: e.from }; order.push(key); }
    net[key].to = e.to;
    net[key].channel = e.channel;
  });
  const items = order.map((k) => net[k]).filter((n) => n.from !== n.to);
  if (!items.length) return "";

  const suffix = (channel) => (channel === "driver" ? " (Fahrer)" : channel === "admin" ? " (Büro)" : "");
  // Sammelzeilen: dieselbe Änderung am selben Tag vom Fahrer/Büro für viele Lehrlinge (z. B. Ferien).
  const groups = {};
  items.forEach((n) => {
    if (n.channel !== "driver" && n.channel !== "admin") return;
    const g = n.date + "|" + n.from + "|" + n.to + "|" + n.channel;
    (groups[g] = groups[g] || []).push(n);
  });
  const lines = [];
  const bulkDone = {};
  items.slice().sort((a, b) => (a.date + (names[a.studentId] || a.studentId)).localeCompare(b.date + (names[b.studentId] || b.studentId))).forEach((n) => {
    const g = n.date + "|" + n.from + "|" + n.to + "|" + n.channel;
    if (groups[g] && groups[g].length >= LL_BULK_MIN_) {
      if (!bulkDone[g]) lines.push(llDescribe_(n.date, n.from, n.to) + ": " + groups[g].length + " Lehrlinge" + suffix(n.channel));
      bulkDone[g] = true;
      return;
    }
    lines.push((names[n.studentId] || n.studentId) + ": " + llDescribe_(n.date, n.from, n.to) + suffix(n.channel));
  });
  const shown = lines.slice(0, LL_SUMMARY_MAX_LINES_);
  if (lines.length > shown.length) shown.push("… und " + (lines.length - shown.length) + " weitere");
  const label = Utilities.formatDate(since, LL_ZONE_, "dd.MM. HH:mm");
  return "Änderungen seit " + label + ":\n" + shown.join("\n");
}

/** Vorschau für den Editor: Protokoll + Kontostatus ins Journal. */
function previewLehrlingeLog() {
  const result = { accounts: llAccountStatus_(), latest: llReadLog_({ audience: "driver" }).slice(0, 30) };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Nur Server-Aufrufe mit SYNC_SECRET (lehrlingeSyncConfig_ in lehrlinge_sync.gs). */
function llRequireServerKey_(body) {
  const config = lehrlingeSyncConfig_();
  const key = String((body && body.serverKey) || "");
  if (!config || !key || key !== config.secret) throw new Error("driver_auth_required");
}

/**
 * Kontoübersicht ("wer war noch nie eingeloggt") im Fahrer-Popup nur für bestimmte Taxinummern:
 * Script Property LEHRLINGE_LOG_ACCOUNTS_TAXIS, z. B. "12" oder "12,7". Leer = niemand.
 */
function llAccountsAllowed_(driver) {
  const list = String(PropertiesService.getScriptProperties().getProperty("LEHRLINGE_LOG_ACCOUNTS_TAXIS") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return Boolean(driver && list.indexOf(String(driver.taxiNumber || "").trim()) >= 0);
}
