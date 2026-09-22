// Bug: Google Sheets legt "until" (Wiederholen bis) oft als echtes Datum ab. String(Date) ergibt
// "Thu Dec 31 2026 00:00:00 GMT+0100 (...)" statt "yyyy-MM-dd" — das ließ das Datumsfeld beim
// Korrigieren einer Serie leer wirken (enhanceDateInput/datePicker.js erkennt nur ISO-Strings).
// readOrders_ muss "until" genauso normalisieren wie "date" (orderDateValue_).
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../source/code.gs", import.meta.url), "utf8");
const grab = (name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found in code.gs`);
  let depth = 0, i = start;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
};

function makeCtx(rows) {
  const head = ["id", "created_at", "date", "time", "type", "duration_min", "phone_raw", "phone_norm",
    "message", "rrule", "until", "series_id", "gcal_event_id", "status", "status_comment",
    "created_by_name", "created_by_device", "confirmation_sent_at", "reminder_sent_at"];
  const ctx = vm.createContext({
    SpreadsheetApp: {
      getActive: () => ({
        getSpreadsheetTimeZone: () => "Europe/Vienna",
        getSheetByName: () => ({
          getDataRange: () => ({ getValues: () => [head, ...rows.map((r) => head.map((k) => r[k] ?? ""))] }),
        }),
      }),
    },
    Session: { getScriptTimeZone: () => "Europe/Vienna" },
    Utilities: {
      formatDate: (date, tz, fmt) => {
        const pad = (n) => String(n).padStart(2, "0");
        if (fmt === "yyyy-MM-dd") return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        if (fmt === "HH:mm") return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
        throw new Error("unexpected format " + fmt);
      },
    },
  });
  const code = [
    "function orderSheet_(){ return SpreadsheetApp.getActive().getSheetByName(); }",
    "function ensureHeaders_(){ return " + JSON.stringify(head) + "; }",
    grab("orderDateValue_"),
    grab("orderSheetTimeZone_"),
    grab("orderTimeValue_"),
    grab("readOrders_"),
  ].join("\n\n");
  vm.runInContext(code, ctx);
  return ctx;
}

test("readOrders_: until as a real Date cell (Sheets auto-conversion) comes back as yyyy-MM-dd, not Date.toString()", () => {
  const ctx = makeCtx([{
    id: "165", date: "2026-09-22", time: "18:30", rrule: "WEEKLY",
    until: new Date(2026, 11, 31), // wie ein von Sheets als Datum formatiertes Feld
    message: "Test",
  }]);
  const items = ctx.readOrders_();
  assert.equal(items.length, 1);
  assert.equal(items[0].until, "2026-12-31");
});

test("readOrders_: until already as an ISO string passes through unchanged", () => {
  const ctx = makeCtx([{ id: "1", date: "2026-09-22", time: "10:00", rrule: "DAILY", until: "2026-10-05" }]);
  assert.equal(ctx.readOrders_()[0].until, "2026-10-05");
});

test("readOrders_: empty/no until (non-recurring order) stays empty", () => {
  const ctx = makeCtx([{ id: "2", date: "2026-09-22", time: "10:00", rrule: "", until: "" }]);
  assert.equal(ctx.readOrders_()[0].until, "");
});
