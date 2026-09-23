process.env.TZ = "Europe/Vienna"; // wie im GAS-Projekt (appsscript.json)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const planSource = fs.readFileSync(new URL("../source/lehrlinge_plan.gs", import.meta.url), "utf8");
const logSource = fs.readFileSync(new URL("../source/lehrlinge_log.gs", import.meta.url), "utf8");
const lssSource = fs.readFileSync(new URL("../source/lehrlinge_shuttle_summary.gs", import.meta.url), "utf8");

function makeSheet(initial = []) {
  const rows = initial.map((row) => row.slice());
  const cell = (r, c) => rows[r - 1]?.[c - 1] ?? "";
  return {
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(0, ...rows.map((row) => row.length)),
    isSheetHidden: () => true,
    hideSheet() {},
    getRange: (r, c, n = 1, width = 1) => ({
      getValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: width }, (_, j) => cell(r + i, c + j))),
      getDisplayValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: width }, (_, j) => {
        const v = cell(r + i, c + j);
        return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
      })),
      setValues: (values) => values.forEach((row, i) => row.forEach((value, j) => {
        rows[r - 1 + i] ||= [];
        rows[r - 1 + i][c - 1 + j] = value;
      })),
    }),
    deleteRows: (r, n) => rows.splice(r - 1, n),
  };
}

function fmt(d, zone, format) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  if (format === "yyyy-MM-dd") return `${p.year}-${p.month}-${p.day}`;
  if (format === "HH" || format === "H") return format === "H" ? String(Number(p.hour)) : p.hour;
  if (format === "dd.MM. HH:mm") return `${p.day}.${p.month}. ${p.hour}:${p.minute}`;
  throw new Error("format " + format);
}

function fixture(nowIso = "2026-09-22T08:00:00Z") {
  let now = nowIso;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return new Date(now).getTime(); } }
  const sheets = {
    _Lehrlinge: makeSheet([
      ["student_id", "name", "point_id", "active", "pin_hash", "updated_at", "phone"],
      ["anna", "Anna Muster", "p1", "1", sha("1234"), "", ""],
      ["ben", "Ben B", "p2", "1", sha("5555"), "", ""],
      ["cara", "Cara C", "p3", "1", "", "", ""],
      ["dan", "Dan D", "p4", "1", sha("0000"), "", ""],
      ["eve", "Eve E", "p5", "1", sha("0001"), "", ""],
      ["old", "Old O", "p6", "0", "", "", ""],
    ]),
  };
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet()) };
  const props = new Map();
  const waCalls = [];
  let schedule = () => ({ days: [] });
  const ctx = vm.createContext({
    console: { log() {}, warn() {} }, Date: Clock,
    SpreadsheetApp: { getActive: () => ss },
    Utilities: { formatDate: fmt, getUuid: () => crypto.randomUUID() },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, String(v)), deleteProperty: (k) => props.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    sha256Hex_: sha,
    LR_WHATSAPP_TEST_TARGET_: "4368181289405",
    LR_WHATSAPP_GROUP_JID_: "436506367662-1552028657@g.us",
    getLehrlingeDriverSchedule_: (...a) => schedule(...a),
    sendWhatsAppMessage_: (to, text) => { waCalls.push([to, text]); return { ok: true }; },
    safeNotificationLog_: () => {}, redactLogText_: (v) => String(v || ""),
    lehrlingeSyncConfig_: () => ({ secret: "s3cret", url: "" }),
  });
  vm.runInContext(planSource, ctx);
  vm.runInContext(logSource, ctx);
  vm.runInContext(lssSource, ctx);
  ctx.getLehrlingeDriverSchedule_ = (...a) => schedule(...a); // lehrlinge_plan.gs definiert die echte Funktion
  const save = (updatedBy, rows, holidays = []) => ctx.saveLehrlingePlan_({ rows: JSON.stringify(rows), holidays: JSON.stringify(holidays), updatedBy });
  return { ctx, sheets, props, waCalls, save, setNow: (n) => { now = n; }, setSchedule: (f) => { schedule = f; }, log: () => sheets._LehrlingeLog?.rows.slice(1) || [] };
}

function sha(v) { return crypto.createHash("sha256").update(String(v)).digest("hex"); }

test("only real changes are logged, with channel per sender; default for a missing row is 'both'", () => {
  const f = fixture();
  f.save("anna", [{ date: "2026-09-24", student_id: "anna", status: "back" }]);
  f.save("portal:lehrlinge", [{ date: "2026-09-24", student_id: "ben", status: "both" }]); // no row = both -> unchanged
  f.save("driver:12", [{ date: "2026-09-24", student_id: "anna", status: "back" }]); // same again -> unchanged
  f.save("portal:lehrlinge", [{ date: "2026-09-25", student_id: "ben", status: "none" }]);
  f.save(undefined, [{ date: "2026-09-25", student_id: "cara", status: "out" }]);
  const log = f.log();
  assert.equal(log.length, 3);
  assert.deepEqual(log.map((r) => [r[1], r[2], r[3], r[4], r[5], r[6], r[7]]), [
    ["plan", "student", "anna", "anna", "2026-09-24", "both", "back"],
    ["plan", "shared", "portal:lehrlinge", "ben", "2026-09-25", "both", "none"],
    ["plan", "admin", "admin", "cara", "2026-09-25", "both", "out"],
  ]);
});

test("holiday day without row counts as 'none' before the change", () => {
  const f = fixture();
  f.save("admin", [{ date: "2026-09-24", student_id: "anna", status: "none" }], ["2026-09-24"]);
  f.save("driver:12", [{ date: "2026-09-24", student_id: "ben", status: "both" }], ["2026-09-24"]);
  assert.deepEqual(f.log().map((r) => [r[4], r[6], r[7]]), [["anna", "both", "none"], ["ben", "none", "both"]]);
});

test("a failing log never breaks saving the plan", () => {
  const f = fixture();
  f.sheets._LehrlingeLog = { getLastRow: () => { throw new Error("quota"); } };
  const result = f.save("anna", [{ date: "2026-09-24", student_id: "anna", status: "none" }]);
  assert.equal(result.saved, 1);
});

test("login with own PIN is logged; account status: no_pin / never / active (incl. old remember tokens)", () => {
  const f = fixture();
  f.ctx.loginLehrling_("anna", "1234");
  // Ben logged in before the log existed: only the remember token is left
  f.props.set("lehrlinge_remember_token:ben", JSON.stringify({ hash: "x", expiresAt: Date.parse("2027-09-01T10:00:00Z") }));
  // Eve changed her plan herself (implies login)
  f.save("eve", [{ date: "2026-09-24", student_id: "eve", status: "out" }]);
  const byId = Object.fromEntries(f.ctx.llAccountStatus_().map((a) => [a.id, a]));
  assert.equal(byId.anna.status, "active");
  assert.equal(byId.ben.status, "active");
  assert.equal(byId.ben.lastLogin, "2026-09-01T10:00:00.000Z");
  assert.equal(byId.cara.status, "no_pin");
  assert.equal(byId.dan.status, "never");
  assert.equal(byId.eve.status, "active");
  assert.equal(byId.old, undefined, "inactive students are not listed");
  assert.equal(f.log()[0][1], "login");
});

test("read log: drivers see everything incl. taxi numbers and logins; a student only own plan changes, no taxi numbers", () => {
  const f = fixture();
  f.ctx.loginLehrling_("anna", "1234");
  f.save("driver:12", [{ date: "2026-09-24", student_id: "anna", status: "none" }]);
  f.save("portal:lehrlinge", [{ date: "2026-09-25", student_id: "ben", status: "out" }]);
  const all = f.ctx.llReadLog_({ audience: "driver" });
  assert.equal(all.length, 3);
  assert.equal(all[0].studentName, "Ben B"); // newest first
  assert.equal(all[0].text, "25.09. Rückfahrt ✗");
  assert.equal(all[1].actor, "Fahrer Taxi 12");
  assert.equal(all[1].text, "24.09. keine Fahrt");
  assert.equal(all[2].event, "login");

  const own = f.ctx.llReadLog_({ audience: "student", studentId: "anna" });
  assert.equal(own.length, 1);
  assert.equal(own[0].actor, "Fahrer");
  assert.ok(!JSON.stringify(own).includes("12"), "no taxi number for students");
  assert.throws(() => f.ctx.llReadLog_({ audience: "student" }), /student_not_found/);
});

test("summary section: net change per student/day, bulk lines, sender suffix, empty when nothing changed", () => {
  const f = fixture("2026-09-22T08:00:00Z");
  f.save("anna", [{ date: "2026-09-24", student_id: "anna", status: "out" }]);
  f.save("anna", [{ date: "2026-09-24", student_id: "anna", status: "both" }]); // back again -> no line
  f.save("ben", [{ date: "2026-09-24", student_id: "ben", status: "back" }]);
  f.save("driver:12", [{ date: "2026-09-25", student_id: "cara", status: "none" }]);
  f.save("admin", ["anna", "ben", "dan", "eve"].map((id) => ({ date: "2026-09-26", student_id: id, status: "none" })));
  const since = new Date("2026-09-22T01:00:00Z");
  const text = f.ctx.llSummarySection_(since, new Date("2026-09-22T09:00:00Z"));
  assert.equal(text, [
    "Änderungen seit 22.09. 03:00:",
    "Ben B: 24.09. Hinfahrt ✗",
    "Cara C: 25.09. keine Fahrt (Fahrer)",
    "26.09. keine Fahrt: 4 Lehrlinge (Büro)",
  ].join("\n"));
  assert.equal(f.ctx.llSummarySection_(new Date("2026-09-22T09:00:00Z"), new Date("2026-09-22T10:00:00Z")), "");
});

test("prune keeps previous and current month", () => {
  const f = fixture("2026-10-05T08:00:00Z");
  f.sheets._LehrlingeLog = makeSheet([
    ["at", "event", "channel", "actor", "student_id", "date", "from", "to"],
    [new Date("2026-08-31T20:00:00Z"), "plan", "student", "anna", "anna", "2026-09-01", "both", "none"],
    [new Date("2026-09-01T08:00:00Z"), "plan", "student", "anna", "anna", "2026-09-02", "both", "none"],
  ]);
  // 31.08. 22:00 Vienna -> August -> removed; 01.09. kept
  assert.equal(f.ctx.llPrune_(new Date("2026-10-05T08:00:00Z")), 1);
  assert.equal(f.sheets._LehrlingeLog.rows.length, 2);
});

test("03:00 Fahrtenplan message gets the changes since the last sent one; weekend changes wait for Monday", () => {
  const f = fixture("2026-09-18T01:00:00Z"); // Fri 03:00
  f.props.set("LSS_ENABLED", "true");
  f.setSchedule((from, to, r, direction) => (from === "2026-09-19" || from === "2026-09-20") ? { days: [] }
    : { days: [{ date: from, routes: [{ route: "1", direction, count: 1, points: [{ students: [{ id: "a", name: "A" }] }] }] }] });
  f.ctx.processLehrlingeShuttleSummary(); // Fri 03:00: nothing changed yet
  assert.doesNotMatch(f.waCalls[0][1], /Änderungen/);
  f.waCalls.length = 0;
  f.setNow("2026-09-18T06:00:00Z"); // Fri 08:00
  f.save("anna", [{ date: "2026-09-21", student_id: "anna", status: "out" }]);

  f.setNow("2026-09-19T01:00:00Z"); // Sat 03:00: no rides -> nothing sent
  f.ctx.processLehrlingeShuttleSummary();
  assert.equal(f.waCalls.length, 0);
  f.setNow("2026-09-19T10:00:00Z");
  f.save("portal:lehrlinge", [{ date: "2026-09-22", student_id: "ben", status: "none" }]);

  f.setNow("2026-09-21T01:00:00Z"); // Mon 03:00
  f.ctx.processLehrlingeShuttleSummary();
  assert.equal(f.waCalls.length, 1);
  assert.match(f.waCalls[0][1], /^TaxiApp: Fahrtenplan Zellstoff Pöls — Hinfahrt 21\.09\./);
  assert.match(f.waCalls[0][1], /\n\nÄnderungen seit 18\.09\. 03:00:\nAnna Muster: 21\.09\. Rückfahrt ✗\nBen B: 22\.09\. keine Fahrt$/);

  f.setNow("2026-09-21T10:00:00Z"); // Mon 12:00: Rückfahrt, no changes section
  f.ctx.processLehrlingeShuttleSummary();
  assert.doesNotMatch(f.waCalls[1][1], /Änderungen/);

  f.setNow("2026-09-22T01:00:00Z"); // Tue 03:00: nothing new since Monday 03:00
  f.ctx.processLehrlingeShuttleSummary();
  assert.doesNotMatch(f.waCalls[2][1], /Änderungen/);

  f.props.set("LSS_CHANGES_ENABLED", "false");
  f.save("anna", [{ date: "2026-09-24", student_id: "anna", status: "none" }]);
  f.setNow("2026-09-23T01:00:00Z");
  f.ctx.processLehrlingeShuttleSummary();
  assert.doesNotMatch(f.waCalls[3][1], /Änderungen/);
});
