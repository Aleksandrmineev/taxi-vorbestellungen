import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../source/lehrlinge.gs.gs", import.meta.url), "utf8");
const routerSource = fs.readFileSync(new URL("../source/code.gs", import.meta.url), "utf8");
const clientSource = fs.readFileSync(new URL("../lehrlinge/assets/js/api.js", import.meta.url), "utf8");

function makeSheet(initial = []) {
  const rows = initial.map((row) => row.slice());
  return {
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0]?.length || 0,
    getDataRange: () => ({ getValues: () => rows.map((row) => row.slice()) }),
    getRange: (r, c, n = 1, width = 1) => ({
      getValues: () => Array.from({ length: n }, (_, i) =>
        Array.from({ length: width }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? "")),
      setValue: (value) => {
        rows[r - 1] ||= [];
        rows[r - 1][c - 1] = value;
      },
      setValues: (values) => values.forEach((row, i) => row.forEach((value, j) => {
        rows[r - 1 + i] ||= [];
        rows[r - 1 + i][c - 1 + j] = value;
      })),
    }),
    appendRow: (row) => rows.push(row.slice()),
    deleteRow: (r) => rows.splice(r - 1, 1),
  };
}

function setup() {
  const submittedAt = new Date("2026-09-10T05:00:00Z");
  const reportDate = new Date(2026, 8, 10);
  const submissions = makeSheet([
    ["timestamp", "route", "report_date", "shift", "duplicate_status", "sequence", "sequence_names"],
    [submittedAt, 1, reportDate, "Früh", "", "1R1>1R2", "Start\nZiel"],
    [new Date("2026-09-11T05:00:00Z"), 1, reportDate, "Früh", "", "1R1>1R2", "Start\nZiel"],
  ]);
  const sheets = { Submissions: submissions };
  const ss = {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => (sheets[name] = makeSheet()),
  };
  const context = {
    Date,
    SpreadsheetApp: { getActive: () => ss },
    LockService: { getDocumentLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => "Europe/Vienna" },
    Utilities: { formatDate: (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-") },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, sheets, submittedAt, driver: { id: "d1", name: "Ada", surname: "Muster", taxiNumber: "42" } };
}

test("editing a report records the driver and clears resolved duplicate markers", () => {
  const { context, sheets, submittedAt, driver } = setup();
  context.syncSubmissionDuplicates_(sheets.Submissions);
  context.editSubmission_({
    rowNum: 2,
    timestamp: submittedAt.getTime(),
    expectedKey: "2026-09-10|früh|1",
    reportDate: "2026-09-10",
    shift: "Nachmittag",
    route: "1",
  }, driver);
  const head = sheets.Submissions.rows[0];
  assert.equal(sheets.Submissions.rows[1][head.indexOf("shift")], "Nachmittag");
  assert.equal(sheets.Submissions.rows[1][head.indexOf("edited_by_driver_name")], "Ada Muster");
  assert.equal(sheets.Submissions.rows[1][head.indexOf("edited_by_taxi_number")], "42");
  assert.equal(sheets.Submissions.rows[1][head.indexOf("sequence")], "1R1>1R2");
  assert.equal(sheets.Submissions.rows[1][head.indexOf("sequence_names")], "Start\nZiel");
  assert.equal(sheets.Submissions.rows[1][head.indexOf("duplicate_status")], "");
  assert.equal(sheets.Submissions.rows[2][head.indexOf("duplicate_status")], "");
  assert.equal(context.getRecentSubmissions("", 10).find((item) => item.row_num === 2).edited_by_driver_name, "Ada Muster");
});

test("marking a duplicate hides it, records the driver, and clearing the mark restores it", () => {
  const { context, sheets, submittedAt, driver } = setup();
  context.syncSubmissionDuplicates_(sheets.Submissions);
  context.deleteDuplicateSubmission_(2, submittedAt.getTime(), driver);
  const head = sheets.Submissions.rows[0];
  assert.equal(sheets.Submissions.rows.length, 3);
  assert.equal(sheets.Submissions.rows[1][head.indexOf("deletion_status")], "DELETE");
  assert.equal(sheets.Submissions.rows[1][head.indexOf("deletion_requested_by_driver_name")], "Ada Muster");
  assert.equal(sheets.Submissions.rows[1][head.indexOf("deletion_requested_by_taxi_number")], "42");
  assert.equal(sheets.Submissions.rows[1][head.indexOf("sequence_names")], "Start\nZiel");
  assert.deepEqual(Array.from(context.getRecentSubmissions("", 10), (item) => item.row_num), [3]);
  assert.equal(sheets.Submissions.rows[2][head.indexOf("duplicate_status")], "");
  assert.throws(() => context.deleteDuplicateSubmission_(3, Date.parse("2026-09-11T05:00:00Z"), driver), /not_a_duplicate/);
  sheets.Submissions.rows[1][head.indexOf("deletion_status")] = "";
  const restored = context.getRecentSubmissions("", 10);
  assert.deepEqual(Array.from(restored, (item) => item.row_num), [3, 2]);
  assert.equal(restored.every((item) => item.duplicate), true);
});

test("unknown POST actions never fall through to creating a submission", () => {
  let submitted = false;
  const context = {
    API_SECRET: "test-secret",
    json: (data) => data,
    submit: () => { submitted = true; },
  };
  vm.createContext(context);
  const router = routerSource.slice(routerSource.indexOf("function doPost(e)"), routerSource.indexOf("// ===== Минимальный backend Vorbestellungen"));
  vm.runInContext(router, context);
  const result = context.doPost({
    parameter: {},
    postData: { type: "application/json", contents: JSON.stringify({ action: "unexpected_edit", secret: "test-secret", route: "1", shift: "Nachmittag" }) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "unknown_action");
  assert.equal(submitted, false);
});

test("an incomplete submission cannot create a blank report", () => {
  const { context, sheets } = setup();
  assert.throws(() => context.submit("1", [], 0, "", "", "Nachmittag", "2026-09-10", "", ""), /invalid_submission/);
  assert.equal(sheets.Submissions.rows.length, 3);
});

test("client refuses edit and delete POSTs against an older GAS deployment", async () => {
  let postCount = 0;
  const context = {
    Date, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    setInterval: () => 0,
    localStorage: { getItem: () => JSON.stringify({ token: "driver-token", expiresAt: Date.now() + 60000 }) },
    sessionStorage: { getItem: () => null },
    fetch: async (_url, options) => {
      if (options.method === "POST") postCount++;
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: "unknown_fn" }) };
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  await assert.rejects(context.editReport(35, 123, "2026-09-10|früh|1", { reportDate: "2026-09-10", shift: "Nachmittag", route: "1" }), /report_management_unavailable/);
  await assert.rejects(context.deleteDuplicateReport(35, 123), /report_management_unavailable/);
  assert.equal(postCount, 0);
});

test("client refuses hard delete when GAS has not switched to marking", async () => {
  let postCount = 0;
  const context = {
    Date, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    setInterval: () => 0,
    localStorage: { getItem: () => JSON.stringify({ token: "driver-token", expiresAt: Date.now() + 60000 }) },
    sessionStorage: { getItem: () => null },
    fetch: async (_url, options) => {
      if (options.method === "POST") postCount++;
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, edit: true, deleteDuplicate: true }) };
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  await assert.rejects(context.deleteDuplicateReport(35, 123), /report_management_unavailable/);
  assert.equal(postCount, 0);
});
