process.env.TZ = "Europe/Vienna"; // wie im GAS-Projekt (appsscript.json); item.date+"T"+item.time wird lokal interpretiert
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../source/order_shift_reminders.gs", import.meta.url), "utf8");

function fixture(nowIso = "2026-09-22T04:00:00Z") {
  const props = new Map();
  const waCalls = [];
  let waFail = false;
  let orders = [];
  let now = nowIso;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  const ctx = vm.createContext({
    console, Date: Clock,
    Utilities: {
      formatDate: (d, zone, format) => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
        if (format === "yyyy-MM-dd") return `${parts.year}-${parts.month}-${parts.day}`;
        if (format === "HH") return parts.hour;
        if (format === "HH:mm") return `${parts.hour}:${parts.minute}`;
        if (format === "dd.MM.") return `${parts.day}.${parts.month}.`;
        if (format === "dd.MM. HH:mm") return `${parts.day}.${parts.month}. ${parts.hour}:${parts.minute}`;
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
    readOrders_: () => orders,
    ORDER_WHATSAPP_TEST_TARGET_: "4368181289405",
    orderWhatsAppTarget_: (test) => (test ? "4368181289405" : String(props.get("ORDER_WHATSAPP_GROUP_JID") || "")),
    sendWhatsAppMessage_: (to, message) => { waCalls.push([to, message]); if (waFail) throw new Error("wa-down"); return { ok: true }; },
    safeNotificationLog_: () => {},
    redactLogText_: (v) => String(v || ""),
  });
  vm.runInContext(source, ctx);
  return {
    ctx, props, waCalls,
    setOrders: (o) => { orders = o; },
    setNow: (n) => { now = n; },
    fail: () => { waFail = true; },
  };
}

const order = (id, date, time, status = "open", extra = {}) => ({ id, date, time, status, message: `Fahrt ${id}`, phone_raw: "+43 1", ...extra });

test("osrWindow_: 06:00 covers the same day until 18:00, 18:00 covers until 06:00 next day", () => {
  const { ctx } = fixture();
  const morning = ctx.osrWindow_(new ctx.Date("2026-09-22T04:00:00Z"), "06");
  assert.equal(morning.from.toISOString().slice(0, 16), "2026-09-22T04:00");
  assert.equal(morning.to.toISOString().slice(0, 16), "2026-09-22T16:00"); // 18:00 Vienna (CEST) = 16:00 UTC
  const evening = ctx.osrWindow_(new ctx.Date("2026-09-22T16:00:00Z"), "18");
  assert.equal(evening.to.toISOString().slice(0, 16), "2026-09-23T04:00"); // next day 06:00 Vienna
});

test("osrOrdersInWindow_: only open orders inside the window, sorted by time, cancelled/done excluded", () => {
  const { ctx } = fixture();
  const window = ctx.osrWindow_(new ctx.Date("2026-09-22T04:00:00Z"), "06");
  const orders = [
    order("1", "2026-09-22", "09:00"),
    order("2", "2026-09-22", "07:00"),
    order("3", "2026-09-22", "05:00"), // vor Fensterbeginn (06:00 Vienna): ausgeschlossen
    order("4", "2026-09-22", "18:30"), // nach Fensterende
    order("5", "2026-09-22", "08:00", "cancelled"),
    order("6", "2026-09-22", "08:30", "done"),
    order("7", "2026-09-22", "bad-time"),
  ];
  const result = ctx.osrOrdersInWindow_(orders, window);
  assert.deepEqual(result.map((o) => o.id), ["2", "1"]);
});

test("osrSummaryText_: header with count and window, one line per order, empty window says so", () => {
  const { ctx } = fixture();
  const window = ctx.osrWindow_(new ctx.Date("2026-09-22T04:00:00Z"), "06");
  const text = ctx.osrSummaryText_([order("101", "2026-09-22", "08:00", "open", { message: "Bahnhof", phone_raw: "+436601" })], window);
  assert.match(text, /^TaxiApp: Schicht 22\.09\. \d{2}:\d{2} – .* · 1 Fahrt$/m);
  assert.match(text, /08:00 · Bahnhof · Tel: \+436601 · #101/);
  const empty = ctx.osrSummaryText_([], window);
  assert.match(empty, /0 Fahrten$/m);
  assert.match(empty, /Keine Vorbestellungen/);
});

test("processOrderShiftReminders: sends only at 06 and 18, once per slot per day, group required", () => {
  const f = fixture("2026-09-22T04:00:00Z"); // 06:00 Vienna
  f.props.set("ORDER_SHIFT_ENABLED", "true");
  f.props.set("ORDER_WHATSAPP_GROUP_JID", "grp@g.us");
  f.setOrders([order("1", "2026-09-22", "09:00")]);
  f.ctx.processOrderShiftReminders();
  assert.equal(f.waCalls.length, 1);
  assert.equal(f.waCalls[0][0], "grp@g.us");
  f.ctx.processOrderShiftReminders(); // same slot again: no duplicate
  assert.equal(f.waCalls.length, 1);

  f.setNow("2026-09-22T05:00:00Z"); // still before 18:00
  f.ctx.processOrderShiftReminders();
  assert.equal(f.waCalls.length, 1);

  f.setNow("2026-09-22T16:00:00Z"); // 18:00 Vienna
  f.ctx.processOrderShiftReminders();
  assert.equal(f.waCalls.length, 2);
});

test("disabled by default; ORDER_SHIFT_ENABLED=false stops sending", () => {
  const f = fixture("2026-09-22T04:00:00Z");
  f.props.set("ORDER_WHATSAPP_GROUP_JID", "grp@g.us");
  f.ctx.processOrderShiftReminders();
  assert.equal(f.waCalls.length, 0);
});

test("group not configured: skipped, no throw, no LAST token stuck as attempting", () => {
  const f = fixture("2026-09-22T04:00:00Z");
  f.props.set("ORDER_SHIFT_ENABLED", "true");
  assert.doesNotThrow(() => f.ctx.processOrderShiftReminders());
  assert.equal(f.waCalls.length, 0);
  assert.equal(f.props.get("ORDER_SHIFT_LAST_06"), undefined);
});

test("WhatsApp failure is recorded as failed_or_unknown and does not crash", () => {
  const f = fixture("2026-09-22T04:00:00Z");
  f.props.set("ORDER_SHIFT_ENABLED", "true");
  f.props.set("ORDER_WHATSAPP_GROUP_JID", "grp@g.us");
  f.fail();
  assert.doesNotThrow(() => f.ctx.processOrderShiftReminders());
  assert.match(f.props.get("ORDER_SHIFT_LAST_06"), /failed_or_unknown/);
});

test("setupOrderShiftReminders refuses without a group, installs a single trigger, enables the flag", () => {
  const f = fixture();
  assert.throws(() => f.ctx.setupOrderShiftReminders(), /ORDER_WHATSAPP_GROUP_JID/);
  f.props.set("ORDER_WHATSAPP_GROUP_JID", "grp@g.us");
  f.ctx.setupOrderShiftReminders();
  f.ctx.setupOrderShiftReminders(); // idempotent, no duplicate trigger
  assert.equal(f.ctx.ScriptApp.triggers.length, 1);
  assert.equal(f.props.get("ORDER_SHIFT_ENABLED"), "true");
  f.ctx.disableOrderShiftReminders();
  assert.equal(f.ctx.ScriptApp.triggers.length, 0);
  assert.equal(f.props.get("ORDER_SHIFT_ENABLED"), "false");
});

test("manual test sends [TEST]-prefixed summary only to the personal test number, regardless of group config", () => {
  const f = fixture("2026-09-22T04:00:00Z");
  f.setOrders([order("1", "2026-09-22", "09:00")]);
  f.ctx.sendOrderShiftSummaryTestNow();
  assert.equal(f.waCalls.length, 1);
  assert.equal(f.waCalls[0][0], "4368181289405");
  assert.match(f.waCalls[0][1], /^\[TEST\] TaxiApp:/);
});
