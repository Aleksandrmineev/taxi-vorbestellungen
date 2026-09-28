import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../source/lehrlinge.gs.gs", import.meta.url), "utf8");

// Wie Google Sheets: "03" wird beim Schreiben zur Zahl 3 — außer die Zelle ist als Text ("@") formatiert.
function makeSheet(initial) {
  const rows = initial.map((row) => row.slice());
  const textCols = new Set();
  const coerce = (value, col) => (!textCols.has(col) && typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value);
  const range = (r, c, n = 1, width = 1) => ({
    getValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: width }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? "")),
    setValue: (value) => { rows[r - 1] ||= []; rows[r - 1][c - 1] = coerce(value, c); },
    setValues: (values) => values.forEach((row, i) => row.forEach((value, j) => {
      rows[r - 1 + i] ||= [];
      rows[r - 1 + i][c - 1 + j] = coerce(value, c + j);
    })),
    setNumberFormat: (format) => { for (let j = 0; j < width; j += 1) if (format === "@") textCols.add(c + j); return range(r, c, n, width); },
  });
  return {
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0]?.length || 0,
    getMaxRows: () => 1000,
    getDataRange: () => range(1, 1, rows.length, rows[0]?.length || 0),
    getRange: range,
    clearContents: () => rows.splice(0, rows.length),
  };
}

const HEADERS = ["id", "name", "surname", "taxi_number", "active", "pin_hash", "phone"];
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

function setup(driverRows) {
  const drivers = makeSheet([HEADERS, ...driverRows]);
  const props = {};
  const ctx = {
    console,
    SpreadsheetApp: { getActive: () => ({ getSheetByName: (name) => (name === "Drivers" ? drivers : null), insertSheet: () => drivers }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    Utilities: { getUuid: () => crypto.randomUUID() },
    sha256Hex_: sha,
    normalizePhone_: (value) => String(value || "").replace(/[^\d+]/g, ""),
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { ctx, drivers };
}

test("Taxi 03: Registrierung speichert als Text, Login mit 03 klappt", () => {
  const { ctx, drivers } = setup([]);
  ctx.registerDriver_("03", "Max", "Muster", "1234", "0664 1234567");
  assert.equal(drivers.rows[1][3], "03");
  assert.equal(ctx.loginDriver_("03", "1234").driver.taxiNumber, "03");
});

test("Taxi 03: bestehende Zeile mit Zahl 3 im Sheet — Login mit 03 klappt trotzdem", () => {
  const { ctx } = setup([["DRV-1", "Max", "Muster", 3, "1", sha("1234"), "+436641234567"]]);
  const session = ctx.loginDriver_("03", "1234");
  assert.equal(session.driver.taxiNumber, "03");
  assert.throws(() => ctx.loginDriver_("03", "9999"), /invalid_credentials/);
});

test("Taxi 03: bereits registriert wird erkannt (kein Duplikat)", () => {
  const { ctx } = setup([["DRV-1", "Max", "Muster", 3, "1", sha("1234"), "+436641234567"]]);
  assert.throws(() => ctx.registerDriver_("03", "Anna", "B", "5555", "0664 7654321"), /driver_already_registered/);
});

test("Admin-Speichern: Taxi 03 bleibt 03 und die Liste zeigt 03", () => {
  const { ctx, drivers } = setup([["DRV-1", "Max", "Muster", 3, "1", sha("1234"), "+436641234567"]]);
  assert.equal(ctx.readDriversSheet_(drivers)[0].taxi_number, "03");
  ctx.saveDriversSheet_(ctx.SpreadsheetApp.getActive(), ctx.normalizeDrivers_([{ id: "DRV-1", name: "Max", surname: "Muster", taxi_number: "3", active: "1" }]));
  assert.equal(drivers.rows[1][3], "03");
  assert.equal(ctx.loginDriver_("03", "1234").driver.taxiNumber, "03");
});
