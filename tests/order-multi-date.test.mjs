import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../source/code.gs", import.meta.url), "utf8");
const grab = (name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  return source.slice(start, source.indexOf("\n}\n", start) + 3);
};

function setup() {
  const rows = [];
  let counter = 0;
  const head = ["id", "created_at", "date", "time", "type", "duration_min", "phone_raw", "phone_norm", "message", "rrule", "until", "series_id", "gcal_event_id", "status", "status_comment", "created_by_name", "created_by_device", "confirmation_sent_at", "reminder_sent_at"];
  const sheet = {
    appendRow: (row) => rows.push(row),
    getLastRow: () => rows.length + 1,
    getRange: () => ({ setNumberFormat: () => ({ setValue: () => {} }) }),
  };
  const ctx = vm.createContext({
    ORDER_HEADERS_: head,
    orderSheet_: () => sheet,
    ensureHeaders_: () => head,
    orderId_: () => `o${++counter}`,
    normalizePhone_: (v) => String(v || "").replace(/\D/g, ""),
    Session: { getScriptTimeZone: () => "Europe/Vienna" },
    Utilities: { formatDate: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` },
  });
  vm.runInContext([grab("createOrder_"), grab("normalizeOrderDates_"), grab("recurrenceDates_")].join("\n"), ctx);
  const col = (name) => head.indexOf(name);
  const view = () => rows.map((r) => ({ date: r[col("date")], rrule: r[col("rrule")], until: r[col("until")], series: r[col("series_id")], id: r[col("id")] }));
  return { ctx, rows, view };
}
const base = { time: "08:00", type: "Orts", duration_min: 15, message: "Test", phone: "+43 660 1" };

test("dates: every chosen day becomes an order, sorted, deduplicated, one shared series", () => {
  const { ctx, view } = setup();
  const result = ctx.createOrder_({ ...base, date: "2026-09-25", dates: ["2026-09-24", "2026-09-22", "2026-09-24", "2026-09-23"] });
  assert.equal(result.recurrence_count, 3);
  assert.equal(result.date, "2026-09-22");
  const rows = view();
  assert.deepEqual(rows.map((r) => r.date), ["2026-09-22", "2026-09-23", "2026-09-24"]);
  assert.ok(rows[0].series.startsWith("s_"));
  assert.equal(new Set(rows.map((r) => r.series)).size, 1);
  assert.ok(rows.every((r) => r.rrule === "" && r.until === ""));
});

test("dates may arrive as a JSON string; single date and old series behaviour are unchanged", () => {
  const a = setup();
  a.ctx.createOrder_({ ...base, dates: JSON.stringify(["2026-09-22", "2026-09-23"]) });
  assert.equal(a.view().length, 2);

  const single = setup();
  const one = single.ctx.createOrder_({ ...base, date: "2026-09-22" });
  assert.equal(one.recurrence_count, 1);
  assert.equal(single.view()[0].series, "");

  const weekly = setup();
  weekly.ctx.createOrder_({ ...base, date: "2026-09-22", rrule: "WEEKLY", until: "2026-10-06" });
  assert.deepEqual(weekly.view().map((r) => r.date), ["2026-09-22", "2026-09-29", "2026-10-06"]);

  const emptyList = setup();
  emptyList.ctx.createOrder_({ ...base, date: "2026-09-22", dates: [] });
  assert.equal(emptyList.view().length, 1);
});

test("a list with one day is a normal single order", () => {
  const { ctx, view } = setup();
  const result = ctx.createOrder_({ ...base, dates: ["2026-09-30"] });
  assert.equal(result.recurrence_count, 1);
  assert.equal(view()[0].series, "");
});

test("invalid lists are rejected before anything is written", () => {
  for (const bad of [["2026-02-30"], ["22.09.2026"], ["2026-09-22", "x"], "not json", { a: 1 }, [null]]) {
    const { ctx, rows } = setup();
    assert.throws(() => ctx.createOrder_({ ...base, date: "2026-09-22", dates: bad }), /invalid_dates/, JSON.stringify(bad));
    assert.equal(rows.length, 0);
  }
  const { ctx, rows } = setup();
  const many = Array.from({ length: 63 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));
  assert.throws(() => ctx.createOrder_({ ...base, dates: many }), /too_many_dates/);
  assert.equal(rows.length, 0);
  assert.throws(() => ctx.createOrder_({ time: "08:00" }), /date_and_time_required/);
});
