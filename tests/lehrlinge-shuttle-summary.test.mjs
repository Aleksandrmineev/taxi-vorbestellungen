process.env.TZ = "Europe/Vienna"; // wie im GAS-Projekt (appsscript.json)
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../source/lehrlinge_shuttle_summary.gs", import.meta.url), "utf8");

function fixture(nowIso = "2026-09-22T01:00:00Z") {
  const props = new Map();
  const waCalls = [];
  let waFail = false;
  let scheduleImpl = () => ({ from: "", to: "", direction: "", days: [] });
  let now = nowIso;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  const ctx = vm.createContext({
    console, Date: Clock,
    LR_WHATSAPP_TEST_TARGET_: "4368181289405",
    Utilities: {
      formatDate: (d, zone, format) => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
        if (format === "yyyy-MM-dd") return `${parts.year}-${parts.month}-${parts.day}`;
        if (format === "HH" || format === "H") return parts.hour;
        return "";
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k), setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: {
      triggers: [],
      getProjectTriggers() { return this.triggers; },
      deleteTrigger(t) { this.triggers.splice(this.triggers.indexOf(t), 1); },
      newTrigger(fn) { return { timeBased: () => ({ everyMinutes: () => ({ create: () => { ctx.ScriptApp.triggers.push({ getHandlerFunction: () => fn }); } }) }) }; },
    },
    getLehrlingeDriverSchedule_: (...args) => scheduleImpl(...args),
    sendWhatsAppMessage_: (to, message) => { waCalls.push([to, message]); if (waFail) throw new Error("wa-down"); return { ok: true }; },
    safeNotificationLog_: () => {},
    redactLogText_: (v) => String(v || ""),
  });
  vm.runInContext(source, ctx);
  return {
    ctx, props, waCalls,
    setSchedule: (fn) => { scheduleImpl = fn; },
    setNow: (n) => { now = n; },
    fail: () => { waFail = true; },
  };
}

const point = (address, students, extra = {}) => ({ pointId: address, address, url: "", phone: "", order: 0, students, ...extra });
const student = (id, name) => ({ id, name });
const day = (date, routes) => ({ date, routes });
const route = (num, direction, points, cancellations = []) => ({
  route: num, direction, points, cancellations,
  count: points.reduce((n, p) => n + p.students.length, 0),
});

test("lssDirectionForSlot_: 03 -> morning (Hinfahrt), 12 -> evening (Rückfahrt)", () => {
  const { ctx } = fixture();
  assert.equal(ctx.lssDirectionForSlot_("03"), "morning");
  assert.equal(ctx.lssDirectionForSlot_("12"), "evening");
});

test("lssSummaryText_: header, per-route blocks in order, points only with riders, names comma-joined", () => {
  const { ctx } = fixture();
  const schedule = { days: [day("2026-09-22", [
    route("1", "morning", [
      point("Bahnhof Zeltweg", [student("anna", "Anna Muster"), student("ben", "Ben B")]),
      point("Ohne Fahrgäste heute", []),
      point("Schule Knittelfeld", [student("cara", "Cara C")]),
    ]),
    route("2", "morning", [point("Werk Pusterwald", [student("dan", "Dan D")])]),
  ])] };
  const text = ctx.lssSummaryText_(schedule, "morning", "22.09.");
  assert.equal(text, [
    "TaxiApp: Fahrtenplan Zellstoff Pöls — Hinfahrt 22.09. · 4 Lehrlinge",
    "",
    "Route 1 (3):\nBahnhof Zeltweg: Anna Muster, Ben B\nSchule Knittelfeld: Cara C",
    "",
    "Route 2 (1):\nWerk Pusterwald: Dan D",
  ].join("\n"));
});

test("lssSummaryText_: cancellations are listed even for a route with zero riders; empty schedule returns null", () => {
  const { ctx } = fixture();
  const withCancel = { days: [day("2026-09-22", [
    route("1", "evening", [], [{ id: "eve", name: "Eve E" }]),
  ])] };
  const text = ctx.lssSummaryText_(withCancel, "evening", "22.09.");
  assert.equal(text, "TaxiApp: Fahrtenplan Zellstoff Pöls — Rückfahrt 22.09. · 0 Lehrlinge\n\nRoute 1 (0):\n\nAbsagen: Eve E");

  assert.equal(ctx.lssSummaryText_({ days: [] }, "morning", "22.09."), null);
  assert.equal(ctx.lssSummaryText_({ days: [day("2026-09-22", [route("1", "morning", [])])] }, "morning", "22.09."), null);
});

test("processLehrlingeShuttleSummary: sends only at 03 and 12, once per slot per day, disabled by default", () => {
  const f = fixture("2026-09-22T01:00:00Z"); // 03:00 Vienna
  f.setSchedule((from, to, r, direction) => ({ days: [day(from, [route("1", direction, [point("X", [student("a", "A")])])])] }));
  f.ctx.processLehrlingeShuttleSummary();
  assert.equal(f.waCalls.length, 0); // ENABLED not set

  f.props.set("LSS_ENABLED", "true");
  f.ctx.processLehrlingeShuttleSummary();
  assert.equal(f.waCalls.length, 1);
  assert.equal(f.waCalls[0][0], "436506367662-1535622857@g.us");
  assert.match(f.waCalls[0][1], /Hinfahrt/);
  f.ctx.processLehrlingeShuttleSummary(); // same slot again
  assert.equal(f.waCalls.length, 1);

  f.setNow("2026-09-22T02:00:00Z"); // still 04:00 Vienna, not a trigger hour
  f.ctx.processLehrlingeShuttleSummary();
  assert.equal(f.waCalls.length, 1);

  f.setNow("2026-09-22T10:00:00Z"); // 12:00 Vienna
  f.ctx.processLehrlingeShuttleSummary();
  assert.equal(f.waCalls.length, 2);
  assert.match(f.waCalls[1][1], /Rückfahrt/);
});

test("empty schedule (weekend/holiday): no message sent, marked as checked so it is not retried", () => {
  const f = fixture("2026-09-22T01:00:00Z");
  f.props.set("LSS_ENABLED", "true");
  f.setSchedule(() => ({ days: [] }));
  f.ctx.processLehrlingeShuttleSummary();
  assert.equal(f.waCalls.length, 0);
  assert.match(f.props.get("LSS_LAST_03"), /skipped_empty/);
  f.ctx.processLehrlingeShuttleSummary(); // does not retry within the same slot
  assert.equal(f.waCalls.length, 0);
});

test("WhatsApp failure is recorded and does not crash", () => {
  const f = fixture("2026-09-22T01:00:00Z");
  f.props.set("LSS_ENABLED", "true");
  f.setSchedule(() => ({ days: [day("2026-09-22", [route("1", "morning", [point("X", [student("a", "A")])])])] }));
  f.fail();
  assert.doesNotThrow(() => f.ctx.processLehrlingeShuttleSummary());
  assert.match(f.props.get("LSS_LAST_03"), /failed_or_unknown/);
});

test("LSS_WHATSAPP_GROUP_JID overrides the default group", () => {
  const f = fixture("2026-09-22T01:00:00Z");
  f.props.set("LSS_ENABLED", "true");
  f.props.set("LSS_WHATSAPP_GROUP_JID", "other-group@g.us");
  f.setSchedule(() => ({ days: [day("2026-09-22", [route("1", "morning", [point("X", [student("a", "A")])])])] }));
  f.ctx.processLehrlingeShuttleSummary();
  assert.equal(f.waCalls[0][0], "other-group@g.us");
});

test("setupLehrlingeShuttleSummary installs a single trigger and enables the flag; disable reverses it", () => {
  const f = fixture();
  f.ctx.setupLehrlingeShuttleSummary();
  f.ctx.setupLehrlingeShuttleSummary(); // idempotent
  assert.equal(f.ctx.ScriptApp.triggers.length, 1);
  assert.equal(f.props.get("LSS_ENABLED"), "true");
  f.ctx.disableLehrlingeShuttleSummary();
  assert.equal(f.ctx.ScriptApp.triggers.length, 0);
  assert.equal(f.props.get("LSS_ENABLED"), "false");
});

test("preview: read-only, correct slot inferred from the current time, no message sent", () => {
  const f = fixture("2026-09-22T01:00:00Z"); // 03:00 Vienna
  f.setSchedule((from, to, r, direction) => ({ days: [day(from, [route("1", direction, [point("X", [student("a", "A")])])])] }));
  const result = f.ctx.previewLehrlingeShuttleSummary();
  assert.equal(result.slot, "03");
  assert.equal(result.direction, "morning");
  assert.equal(result.willSend, true);
  assert.equal(f.waCalls.length, 0);
});

test("manual test-now: [TEST]-prefixed, personal number only, shows a placeholder when nothing is scheduled", () => {
  const f = fixture("2026-09-22T01:00:00Z");
  f.setSchedule(() => ({ days: [] }));
  f.ctx.sendLehrlingeShuttleSummaryTestNow();
  assert.equal(f.waCalls.length, 1);
  assert.equal(f.waCalls[0][0], "4368181289405");
  assert.match(f.waCalls[0][1], /^\[TEST\] TaxiApp: Fahrtenplan Zellstoff Pöls — Hinfahrt .*\n\nKeine Fahrten geplant\.$/);

  f.waCalls.length = 0;
  f.setSchedule((from, to, r, direction) => ({ days: [day(from, [route("1", direction, [point("X", [student("a", "A")])])])] }));
  f.ctx.sendLehrlingeShuttleSummaryTestNow("12");
  assert.match(f.waCalls[0][1], /^\[TEST\] TaxiApp: Fahrtenplan Zellstoff Pöls — Rückfahrt/);
});
