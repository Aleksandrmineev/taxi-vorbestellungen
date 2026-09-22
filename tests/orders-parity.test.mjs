// Vergleicht die JS-Logik (Vercel) mit den GAS-Funktionen aus source/code.gs.
process.env.TZ = "Europe/Vienna";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {
  buildOrders, listOrders, normalizeOrderDates, normalizePhone, pickOrderId, recurrenceDates, todoOrders, viennaToUtcMs,
} from "../api/_lib/orders-core.js";

const source = fs.readFileSync(new URL("../source/code.gs", import.meta.url), "utf8");
const grab = (name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}\n", start) + 3);
};
const clean = (value) => JSON.parse(JSON.stringify(value));

function gasContext(orders) {
  const ctx = vm.createContext({
    readOrders_: () => orders.map((o) => ({ ...o })),
    Session: { getScriptTimeZone: () => "Europe/Vienna" },
    Utilities: { formatDate: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` },
  });
  vm.runInContext(["getOrdersByDate_", "getTodoOrders_", "normalizeOrderDates_", "recurrenceDates_", "normalizePhone_"].map(grab).join("\n"), ctx);
  return ctx;
}

const order = (id, date, time, status = "open", extra = {}) => ({
  id, created_at: `2026-09-01T08:00:0${id.slice(-1)}.000Z`, date, time, type: "Orts", duration_min: 15, phone: "+43 660 1", phone_norm: "+436601",
  message: "Test", rrule: "", until: "", series_id: "", gcal_event_id: "", status, status_comment: "", created_by_name: "x", created_by_device: "y",
  confirmation_sent_at: "", reminder_sent_at: "", ...extra,
});
const orders = [
  order("101", "2026-09-22", "08:00"), order("102", "2026-09-22", "07:15"), order("103", "2026-09-22", "19:20", "cancelled"),
  order("104", "2026-09-23", "04:15"), order("105", "2026-09-22", "10:40", "done"), order("106", "2026-10-25", "02:30"),
  order("107", "2026-03-29", "03:30"), order("108", "2026-12-31", "23:55"), order("109", "2026-09-22", "bad"),
  order("110", "2026-03-29", "02:30"), order("111", "2026-03-29", "01:59"), order("112", "2026-10-25", "01:59"), order("113", "2026-10-25", "03:00"),
];

test("list by date: same items and order as GAS getOrdersByDate_ (ties aside)", () => {
  const gas = gasContext(orders);
  for (const [date, all] of [["2026-09-22", false], ["2026-09-22", true], ["", false], ["", true], ["2026-09-23", false], ["2030-01-01", true]]) {
    // Reihenfolge nach Uhrzeit identisch; bei gleicher Uhrzeit gilt in GAS die Tabellenreihenfolge (in Redis nicht vorhanden)
    const groups = (list) => list.reduce((acc, o) => { (acc[acc.length - 1]?.time === o.time ? acc[acc.length - 1].ids : (acc.push({ time: o.time, ids: [] }), acc[acc.length - 1].ids)).push(o.id); return acc; }, []).map((g) => ({ time: g.time, ids: g.ids.sort() }));
    const expected = groups(clean(gas.getOrdersByDate_(date, all)));
    const actual = groups(listOrders(orders.map((o) => ({ ...o })), date, all));
    assert.deepEqual(actual, expected, `${date} all=${all}`);
  }
});

test("todos: same set, start_iso and order_id as GAS getTodoOrders_ (incl. DST changes)", () => {
  const gas = gasContext(orders);
  const RealDate = Date;
  for (const nowIso of ["2026-09-22T05:00:00Z", "2026-09-22T20:00:00Z", "2026-10-24T22:30:00Z", "2026-03-28T22:00:00Z", "2026-03-29T00:30:00Z", "2026-10-25T00:00:00Z", "2027-01-01T00:00:00Z"]) {
    const nowMs = RealDate.parse(nowIso);
    class FixedDate extends RealDate { constructor(...a) { super(...(a.length ? a : [nowMs])); } static now() { return nowMs; } }
    gas.Date = FixedDate;
    vm.runInContext("Date = this.Date;", vm.createContext(gas));
    for (const hours of [24, 24 * 366, 3]) {
      const expected = clean(gas.getTodoOrders_(hours)).map((o) => [o.id, o.start_iso, o.order_id]).sort();
      const actual = todoOrders(orders.map((o) => ({ ...o })), hours, nowMs).map((o) => [o.id, o.start_iso, o.order_id]).sort();
      assert.deepEqual(actual, expected, `${nowIso} h=${hours}`);
    }
  }
});

test("viennaToUtcMs: summer/winter time and the two changeover days", () => {
  assert.equal(new Date(viennaToUtcMs("2026-07-01", "12:00")).toISOString(), "2026-07-01T10:00:00.000Z");
  assert.equal(new Date(viennaToUtcMs("2026-12-01", "12:00")).toISOString(), "2026-12-01T11:00:00.000Z");
  assert.equal(new Date(viennaToUtcMs("2026-03-29", "01:59")).toISOString(), "2026-03-29T00:59:00.000Z"); // vor Umstellung (CET)
  assert.equal(new Date(viennaToUtcMs("2026-03-29", "04:00")).toISOString(), "2026-03-29T02:00:00.000Z"); // nach Umstellung (CEST)
  assert.equal(new Date(viennaToUtcMs("2026-10-25", "04:00")).toISOString(), "2026-10-25T03:00:00.000Z"); // nach Rückstellung (CET)
  assert.equal(new Date(viennaToUtcMs("2026-10-25", "02:30")).toISOString(), "2026-10-25T00:30:00.000Z"); // doppelte Stunde: die erste
  assert.equal(new Date(viennaToUtcMs("2026-03-29", "02:30")).toISOString(), "2026-03-29T01:30:00.000Z"); // fehlende Stunde
  assert.ok(Number.isNaN(viennaToUtcMs("2026-09-22", "bad")));
});

test("dates, recurrence and phone normalisation match GAS", () => {
  const gas = gasContext([]);
  for (const list of [["2026-09-24", "2026-09-22", "2026-09-24"], JSON.stringify(["2026-09-23"]), [], undefined, "", ["2026-02-30"], ["x"], "nope", { a: 1 }]) {
    let expected, actual;
    try { expected = clean(gas.normalizeOrderDates_(list)); } catch (e) { expected = String(e.message); }
    try { actual = normalizeOrderDates(list); } catch (e) { actual = String(e.message); }
    assert.deepEqual(actual, expected, JSON.stringify(list));
  }
  for (const [start, rule, until] of [["2026-09-22", "DAILY", "2026-09-26"], ["2026-09-22", "WEEKLY", "2026-10-13"], ["2026-09-22", "BIWEEKLY", "2026-11-03"], ["2026-09-22", "", ""], ["2026-09-22", "WEEKLY", ""], ["2026-09-22", "MONTHLY", "2026-10-01"], ["2026-09-22", "DAILY", "2026-09-01"], ["2026-10-24", "DAILY", "2026-10-27"], ["2026-01-01", "DAILY", "2027-12-31"]]) {
    let expected, actual;
    try { expected = clean(gas.recurrenceDates_(start, rule, until)); } catch (e) { expected = String(e.message); }
    try { actual = recurrenceDates(start, rule, until); } catch (e) { actual = String(e.message); }
    assert.deepEqual(actual, expected, `${rule} ${until}`);
  }
  for (const phone of ["+43 (660) 12-34", "0660/123", "", null, "abc"]) assert.equal(normalizePhone(phone), gas.normalizePhone_(phone));
});

test("pickOrderId: never returns a used id and grows to 4 and 5 digits", () => {
  assert.match(pickOrderId(new Set()), /^[1-9]\d{2}$/);
  const full3 = new Set(Array.from({ length: 900 }, (_, i) => String(100 + i)));
  assert.match(pickOrderId(full3), /^\d{4}$/);
  const full4 = new Set([...full3, ...Array.from({ length: 9000 }, (_, i) => String(1000 + i))]);
  assert.match(pickOrderId(full4), /^\d{5}$/);
});

test("buildOrders: series over several days, unique ids, fields like createOrder_", () => {
  const now = new Date("2026-09-22T06:00:00Z");
  const built = buildOrders({ dates: ["2026-09-24", "2026-09-23"], time: "08:00", phone: "+43 660 1", message: " Hi ", type: "KT", duration_min: 120 }, { usedIds: ["555"], now });
  assert.equal(built.length, 2);
  assert.deepEqual(built.map((o) => o.date), ["2026-09-23", "2026-09-24"]);
  assert.equal(new Set(built.map((o) => o.id)).size, 2);
  assert.ok(!built.some((o) => o.id === "555"));
  assert.ok(built[0].series_id.startsWith("s_") && built[0].series_id === built[1].series_id);
  assert.equal(built[0].phone_norm, "+436601");
  assert.equal(built[0].message, "Hi");
  assert.equal(built[0].status, "open");
  assert.equal(buildOrders({ date: "2026-09-23", time: "08:00" }, { now })[0].series_id, "");
  assert.throws(() => buildOrders({ time: "08:00" }), /date_and_time_required/);
  assert.throws(() => buildOrders({ date: "2026-09-23" }), /date_and_time_required/);
});
