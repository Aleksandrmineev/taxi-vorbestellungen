// Prüft lssSummaryText_ gegen die echte Rückgabe von getLehrlingeDriverSchedule_ (lehrlinge_plan.gs),
// damit die Feldnamen (route.count, point.students[].name, cancellations[].name, ...) wirklich passen.
process.env.TZ = "Europe/Vienna";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const planSource = fs.readFileSync(new URL("../source/lehrlinge_plan.gs", import.meta.url), "utf8");
const lssSource = fs.readFileSync(new URL("../source/lehrlinge_shuttle_summary.gs", import.meta.url), "utf8");

function sheet(rows) {
  return {
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0]?.length || 0,
    getDataRange: () => ({ getValues: () => rows.map((row) => row.slice()) }),
    getRange: (r, c, n = 1, w = 1) => ({
      getValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: w }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? "")),
      getDisplayValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: w }, (_, j) => String(rows[r - 1 + i]?.[c - 1 + j] ?? ""))),
    }),
  };
}

const points = [
  ["id", "name", "route", "active", "url", "contact", "phone", "time"],
  ["P1", "Bahnhof Zeltweg", "1", "1", "", "", "", "06:10"],
  ["P2", "Schule Knittelfeld", "1", "1", "", "", "", "06:20"],
];
const students = [
  ["student_id", "name", "point_id", "active", "pin_hash", "updated_at", "phone"],
  ["anna", "Anna Muster", "P1", "1", "", "", ""],
  ["ben", "Ben B", "P1", "1", "", "", ""],
  ["cara", "Cara C", "P2", "1", "", "", ""],
];
const plan = [["date", "student_id", "b_m", "b_e", "o_m", "o_e", "note", "updated_by", "updated_at"]];

test("lssSummaryText_ formats the real getLehrlingeDriverSchedule_ output without errors, matching field shapes", () => {
  const ctx = vm.createContext({
    Utilities: {
      formatDate: (d, tz, fmt) => (fmt === "HH:mm"
        ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d)
        : new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)),
    },
    Session: { getScriptTimeZone: () => "Europe/Vienna" },
    SpreadsheetApp: { getActive: () => ({ getSheetByName: (name) => ({ Points: sheet(points), _Lehrlinge: sheet(students), _LehrlingePlan: sheet(plan) })[name] || null }) },
    console,
  });
  vm.runInContext(planSource, ctx);
  vm.runInContext(`function getLehrlingeSnapshot_() { return { points: ${JSON.stringify(points.slice(1).map((r) => ({ id: r[0], name: r[1], route: r[2], active: r[3], url: r[4], phone: r[6], arrival_time: r[7] })))} }; }`, ctx);
  vm.runInContext(lssSource, ctx);

  const real = ctx.getLehrlingeDriverSchedule_("2026-09-22", "2026-09-22", "all", "morning");
  const text = ctx.lssSummaryText_(real, "morning", "22.09.");
  assert.equal(text, "TaxiApp: Fahrtenplan Zellstoff Pöls — Hinfahrt 22.09. · 3 Lehrlinge\n\nRoute 1 (3):\nAnna Muster\nBen B\nCara C");
  assert.ok(!text.includes("Bahnhof Zeltweg") && !text.includes("Schule Knittelfeld"), "no addresses in the message");
});
