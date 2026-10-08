import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../source/code.gs", import.meta.url), "utf8");

function makeSheet(initial = []) {
  const rows = initial.map((row) => row.slice());
  return {
    rows,
    getLastRow: () => rows.length,
    getRange: (r, c, n = 1, width = 1) => ({
      getValues: () => Array.from({ length: n }, (_, i) =>
        Array.from({ length: width }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? "")),
    }),
    deleteRow: (r) => rows.splice(r - 1, 1),
    isSheetHidden: () => true,
  };
}

function reportRow(id, driver, savedAt) {
  return [id, driver, "2026-10-08T06:00:00.000Z", "day", 11, "MU-1", "7", 100, 0, 0, 0, 0, 100, 100, 0, savedAt, ""];
}

function setup(now) {
  const drivers = makeSheet([["driver_number", "name", "cars_json", "carryover_balance", "created_at"], ["12", "Ada", "[]", 0, ""], ["34", "Bob", "[]", 0, ""]]);
  const reports = makeSheet([
    ["id"],
    reportRow("fresh", "12", new Date(now - 60 * 60 * 1000).toISOString()),
    reportRow("old", "12", new Date(now - 25 * 60 * 60 * 1000).toISOString()),
    reportRow("other", "34", new Date(now - 60 * 1000).toISOString()),
  ]);
  const sheets = { _Shift_Drivers: drivers, Schichtabrechnung: reports };
  const ss = { getSheetByName: (name) => sheets[name] || null, getSheets: () => Object.values(sheets) };
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const context = {
    Date: FixedDate,
    SpreadsheetApp: { getActive: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, reports };
}

const NOW = Date.parse("2026-10-08T12:00:00Z");

test("driver can delete own report within 24h and gets the updated profile", () => {
  const { context, reports } = setup(NOW);
  const profile = context.deleteOwnShiftReport_("12", "fresh");
  assert.deepEqual(reports.rows.map((row) => row[0]), ["id", "old", "other"]);
  assert.deepEqual(profile.reports.map((report) => report.id), ["old"]);
});

test("driver cannot delete reports older than 24h", () => {
  const { context, reports } = setup(NOW);
  assert.throws(() => context.deleteOwnShiftReport_("12", "old"), /delete_window_expired/);
  assert.equal(reports.rows.length, 4);
});

test("driver cannot delete another driver's report", () => {
  const { context, reports } = setup(NOW);
  assert.throws(() => context.deleteOwnShiftReport_("12", "other"), /report_not_found/);
  assert.equal(reports.rows.length, 4);
});
