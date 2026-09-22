import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../source/code.gs", import.meta.url), "utf8");
const grab = (name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}\n", start) + 3);
};
const constGrab = (name) => {
  const start = source.indexOf(`const ${name} = `);
  assert.ok(start >= 0, name);
  const braceStart = source.indexOf("{", start);
  const semiIndex = source.indexOf(";", start);
  if (braceStart === -1 || semiIndex < braceStart) {
    return source.slice(start, source.indexOf("\n", start));
  }
  return source.slice(start, source.indexOf("};", braceStart) + 2);
};

function fixture() {
  const props = new Map();
  const waCalls = [];
  const smsCalls = [];
  let waFail = false;
  let orders = [];
  const ctx = vm.createContext({
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k), setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
    orderNotificationConfig_: () => ({ notifyPhoneDay: "+431", notifyPhoneDay2: "", notifyPhoneNight: "+432", notifyPhoneNight2: "" }),
    sendWhatsAppMessage_: (to, message) => { waCalls.push([to, message]); if (waFail) throw new Error("wa-down"); return { ok: true }; },
    sendZadarmaSms_: (phone, message) => { smsCalls.push([phone, message]); return { status: "success" }; },
    safeNotificationLog_: () => {},
    redactLogText_: (v) => String(v || ""),
    readOrders_: () => orders,
  });
  vm.runInContext([
    constGrab("MINEEV_BOT_PROPERTIES_"), constGrab("ORDER_NOTIFY_PROPERTIES_"), constGrab("ORDER_WHATSAPP_GROUP_JID_"), constGrab("ORDER_WHATSAPP_TEST_TARGET_"),
    grab("orderNotificationProperties_"), grab("orderReminderChannel_"), grab("orderWhatsAppTarget_"),
    grab("orderSmsText_"), grab("orderWhatsAppText_"), grab("sendOrderWhatsAppReminder_"), grab("sendOrderReminderTestNow"),
    grab("orderNotificationPhones_"), grab("sendOrderSms_"), grab("sendOrderReminder_"),
  ].join("\n"), ctx);
  return { ctx, props, waCalls, smsCalls, fail: () => { waFail = true; }, setOrders: (o) => { orders = o; } };
}

const order = (extra = {}) => ({ id: "123", time: "09:30", message: "Bahnhof", phone_raw: "+436811234567", ...extra });
const GROUP = "436605703688-1417303237@g.us";

test("orderWhatsAppText_: TaxiApp prefix with the same fields as the old SMS", () => {
  const { ctx } = fixture();
  assert.equal(ctx.orderWhatsAppText_(order()), "TaxiApp: 09:30\nBahnhof\nTel: +436811234567\n#123");
});

test("default channel stays SMS (old behaviour) until ORDER_REMINDER_CHANNEL=whatsapp is set", () => {
  const f = fixture();
  let marked = null;
  f.ctx.setOrderNotification_ = (id, field) => { marked = field; };
  f.ctx.sendOrderReminder_(order({ time: "09:00" }));
  assert.equal(f.waCalls.length, 0);
  assert.equal(f.smsCalls.length, 1);
  assert.equal(f.smsCalls[0][0], "+431"); // day phone for 09:00
  assert.equal(marked, "reminder_sent_at");
});

test("ORDER_REMINDER_CHANNEL=whatsapp sends to the Murtal Taxi group by default (no property needed)", () => {
  const f = fixture();
  f.props.set("ORDER_REMINDER_CHANNEL", "whatsapp");
  let marked = null;
  f.ctx.setOrderNotification_ = (id, field, value) => { marked = { id, field, value }; };
  f.ctx.sendOrderReminder_(order());
  assert.equal(f.waCalls.length, 1);
  assert.equal(f.waCalls[0][0], GROUP);
  assert.match(f.waCalls[0][1], /^TaxiApp: 09:30/);
  assert.equal(f.smsCalls.length, 0);
  assert.deepEqual(marked, { id: "123", field: "reminder_sent_at", value: marked.value });
});

test("ORDER_WHATSAPP_GROUP_JID overrides the default group (e.g. to redirect to a test group)", () => {
  const f = fixture();
  f.props.set("ORDER_REMINDER_CHANNEL", "whatsapp");
  f.props.set("ORDER_WHATSAPP_GROUP_JID", "other-group@g.us");
  f.ctx.setOrderNotification_ = () => {};
  f.ctx.sendOrderReminder_(order());
  assert.equal(f.waCalls[0][0], "other-group@g.us");
});

test("WhatsApp failure does not mark reminder_sent_at (so it is retried); no crash", () => {
  const f = fixture();
  f.props.set("ORDER_REMINDER_CHANNEL", "whatsapp");
  f.fail();
  let marked = false;
  f.ctx.setOrderNotification_ = () => { marked = true; };
  f.ctx.sendOrderReminder_(order());
  assert.equal(marked, false);
});

test("already sent reminders are not resent", () => {
  const f = fixture();
  f.props.set("ORDER_REMINDER_CHANNEL", "whatsapp");
  f.ctx.setOrderNotification_ = () => {};
  f.ctx.sendOrderReminder_(order({ reminder_sent_at: "2026-09-22T08:00:00Z" }));
  assert.equal(f.waCalls.length, 0);
});

test("sendOrderReminderTestNow: [TEST]-prefixed, personal number only, uses the next open order", () => {
  const f = fixture();
  f.setOrders([
    order({ id: "1", date: "2026-09-22", time: "23:00", status: "cancelled" }),
    order({ id: "2", date: "2026-09-22", time: "08:00", message: "Erste Fahrt" }),
    order({ id: "3", date: "2026-09-22", time: "09:00" }),
  ]);
  const result = f.ctx.sendOrderReminderTestNow();
  assert.equal(result.sample_id, "2");
  assert.equal(f.waCalls.length, 1);
  assert.equal(f.waCalls[0][0], "4368181289405");
  assert.match(f.waCalls[0][1], /^\[TEST\] TaxiApp: 08:00\nErste Fahrt/);
});

test("sendOrderReminderTestNow: falls back to a sample order when none exist", () => {
  const f = fixture();
  f.setOrders([]);
  const result = f.ctx.sendOrderReminderTestNow();
  assert.equal(result.sample_id, "TEST");
  assert.match(f.waCalls[0][1], /^\[TEST\] TaxiApp: 12:00\nBeispielfahrt/);
});
