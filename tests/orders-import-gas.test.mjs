import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const sync = fs.readFileSync(new URL("../source/orders_sync.gs", import.meta.url), "utf8");
const code = fs.readFileSync(new URL("../source/code.gs", import.meta.url), "utf8");
const grab = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return src.slice(start, src.indexOf("\n}\n", start) + 3);
};
const HEAD = ["id", "created_at", "date", "time", "type", "duration_min", "phone_raw", "phone_norm", "message", "rrule", "until", "series_id", "gcal_event_id", "status", "status_comment", "created_by_name", "created_by_device", "confirmation_sent_at", "reminder_sent_at"];

function setup(existingRows = [], props = { SYNC_SECRET: "sek" }) {
  const rows = existingRows.map((r) => HEAD.map((h) => r[h] ?? ""));
  const formats = [];
  const sheet = {
    getLastRow: () => rows.length + 1,
    getRange: (row, column, count = 1, width = 1) => ({
      getValues: () => rows.slice(row - 2, row - 2 + count).map((r) => r.slice(column - 1, column - 1 + width)),
      setNumberFormat: (format) => { formats.push({ row, column, count, format }); },
      setValues: (values) => values.forEach((v, i) => { rows[row - 2 + i] = v.slice(); }),
    }),
  };
  let nextId = 900;
  const ctx = vm.createContext({
    ORDER_HEADERS_: HEAD,
    orderSheet_: () => sheet,
    ensureHeaders_: () => HEAD,
    orderDateValue_: (v) => String(v),
    orderTimeValue_: (v) => String(v),
    orderId_: () => String(++nextId),
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
  });
  vm.runInContext([grab(sync, "isOrdersServerKey_"), grab(sync, "requireOrdersServerKey_"), grab(sync, "importOrders_")].join("\n"), ctx);
  return { ctx, rows, formats, col: (n) => HEAD.indexOf(n) };
}
const item = (id, extra = {}) => ({
  id, created_at: "2026-09-22T06:00:00.000Z", date: "2026-09-23", time: "08:00", type: "Orts", duration_min: 15, phone: "+43 660 1", phone_norm: "+436601",
  message: `Msg ${id}`, rrule: "", until: "", series_id: "", gcal_event_id: "", status: "open", status_comment: "", created_by_name: "x", created_by_device: "y",
  confirmation_sent_at: "", reminder_sent_at: "", ...extra,
});

test("import appends rows with the given ids, phone -> phone_raw, time column as text", () => {
  const t = setup();
  const result = t.ctx.importOrders_([item("101"), item("102", { date: "2026-09-24" })]);
  assert.equal(result.imported, 2);
  assert.deepEqual([...result.skipped], []);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0][t.col("id")], "101");
  assert.equal(t.rows[0][t.col("phone_raw")], "+43 660 1");
  assert.equal(t.rows[1][t.col("date")], "2026-09-24");
  assert.equal(Object.prototype.toString.call(t.rows[0][t.col("created_at")]), "[object Date]");
  assert.equal(t.formats[0].format, "@");
  assert.equal(t.formats[0].column, HEAD.indexOf("time") + 1);
  assert.equal(t.formats[0].count, 2);
});

test("import is idempotent: same id + same content is skipped, so retries never duplicate", () => {
  const t = setup();
  t.ctx.importOrders_([item("101")]);
  const again = t.ctx.importOrders_([item("101")]);
  assert.equal(again.imported, 0);
  assert.deepEqual([...again.skipped], ["101"]);
  assert.equal(t.rows.length, 1);
  const mixed = t.ctx.importOrders_([item("101"), item("103")]);
  assert.equal(mixed.imported, 1);
  assert.equal(t.rows.length, 2);
});

test("id collision with a different existing order: new id, mapping returned, nothing overwritten", () => {
  const t = setup([{ ...item("101"), phone_raw: "+43 1", message: "someone else", date: "2026-09-30" }]);
  const result = t.ctx.importOrders_([item("101")]);
  assert.equal(result.imported, 1);
  assert.deepEqual({ ...result.renamed }, { 101: "901" });
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0][t.col("message")], "someone else");
  assert.equal(t.rows[1][t.col("id")], "901");
});

test("invalid items are rejected before anything is written; empty list is a no-op", () => {
  for (const bad of [item(""), item("1", { date: "23.09.2026" }), item("1", { time: "8:00" }), item("1", { status: "weird" })]) {
    const t = setup();
    assert.throws(() => t.ctx.importOrders_([item("100"), bad]), /invalid_order/);
    assert.equal(t.rows.length, 0);
  }
  const t = setup();
  assert.equal(t.ctx.importOrders_([]).imported, 0);
  assert.throws(() => t.ctx.importOrders_(Array.from({ length: 401 }, (_, i) => item(String(1000 + i)))), /too_many_orders/);
});

test("server key: only the SYNC_SECRET value opens the trusted actions", () => {
  const t = setup();
  assert.equal(t.ctx.isOrdersServerKey_({ serverKey: "sek" }), true);
  assert.equal(t.ctx.isOrdersServerKey_({ serverKey: "no" }), false);
  assert.equal(t.ctx.isOrdersServerKey_({}), false);
  assert.throws(() => t.ctx.requireOrdersServerKey_({ serverKey: "no" }), /forbidden/);
  const unset = setup([], {});
  assert.equal(unset.ctx.isOrdersServerKey_({ serverKey: "" }), false);
  assert.equal(unset.ctx.isOrdersServerKey_({ serverKey: "anything" }), false);
});
