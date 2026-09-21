// Проверяет, что JS-порт расписания (Vercel) даёт тот же результат, что исходный GAS-код.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {
  getDriverSchedule,
  getDriverStudentPlan,
  getDriverStudents,
} from "../api/_lib/lehrlinge-schedule.js";

const read = (name) => fs.readFileSync(new URL(`../source/${name}`, import.meta.url), "utf8");

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
  ["P1", "Bahnhof 1", "1", "1", "https://maps.example/1", "", "0664111", "06:10"],
  ["P2", "Schule 2", "1", "1", "", "", "", "06:20"],
  ["P3", "Werk 3", "2", "1", "", "", "0664333", "06:30"],
  ["P4", "Inaktiv", "2", "0", "", "", "", "06:40"],
  ["P5", "Ohne Schüler", "1", "1", "", "", "", "06:50"],
];
const students = [
  ["student_id", "name", "point_id", "active", "pin_hash", "updated_at", "phone"],
  ["anna", "Anna A", "P1", "1", "", "", ""],
  ["ben", "Ben B", "P1", "1", "", "", ""],
  ["cara", "Cara C", "P2", "1", "", "", ""],
  ["dan", "Dan D", "P3", "1", "", "", ""],
  ["eve", "Eve E", "P4", "1", "", "", ""],
  ["old", "Old O", "P3", "0", "", "", ""],
];
// date, student, base_m, base_e, override_m, override_e, note, updated_by, updated_at
const plan = [
  ["date", "student_id", "b_m", "b_e", "o_m", "o_e", "note", "updated_by", "updated_at"],
  ["2026-09-21", "anna", "1", "1", "0", "1", "", "driver:80", new Date("2026-09-20T10:00:00Z")],
  ["2026-09-21", "ben", "1", "1", "1", "0", "krank", "driver:12", "2026-09-20T11:00:00.000Z"],
  ["2026-09-22", "cara", "1", "1", "0", "0", "", "pdf_seed", ""],
  ["2026-09-22", "dan", "1", "1", "0", "0", "", "driver:80", ""],
  ["2026-09-23", "anna", "1", "1", "1", "1", "holiday", "admin", ""],
  ["23.09.2026", "dan", "1", "1", "1", "1", "", "admin", ""],
  ["2026-09-24", "dan", "1", "1", "", "", "", "", ""],
];

function loadGas() {
  const context = vm.createContext({
    Utilities: {
      formatDate: (date, tz, fmt) => {
        if (fmt === "HH:mm") return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
        return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
      },
    },
    Session: { getScriptTimeZone: () => "Europe/Vienna" },
    SpreadsheetApp: {
      getActive: () => ({
        getSheetByName: (name) => ({ Points: sheet(points), _Lehrlinge: sheet(students), _LehrlingePlan: sheet(plan) })[name] || null,
      }),
    },
  });
  vm.runInContext(read("lehrlinge_plan.gs"), context);
  vm.runInContext(read("lehrlinge.gs.gs").match(/function pointTimeValue_[\s\S]*?\n}\n/)[0], context);
  // getLehrlingeSnapshot_ читает лист-снапшот; подменяем его снапшотом из тех же Points.
  vm.runInContext(`function getLehrlingeSnapshot_() { return { points: ${JSON.stringify(points.slice(1).map((r) => ({
    id: r[0], name: r[1], route: r[2], active: r[3], url: r[4], phone: r[6], arrival_time: r[7],
  })))} }; }`, context);
  return context;
}

const clean = (value) => JSON.parse(JSON.stringify(value));

test("JS-порт расписания совпадает с GAS", () => {
  const gas = loadGas();
  const gasPlan = clean(vm.runInContext(`getLehrlingePlan_("2026-09-01", "")`, gas));
  const snapshot = {
    points: points.slice(1).map((r) => ({ id: r[0], name: r[1], route: r[2], active: r[3], url: r[4], phone: r[6], arrival_time: r[7] })),
    students: students.slice(1).map((r) => ({ id: r[0], name: r[1], pointId: r[2], active: r[3] })),
    drivers: [],
  };
  const planMap = new Map(gasPlan.items.map((item) => [`${item.date}|${item.student_id}`, item]));

  for (const [route, direction] of [["all", "all"], ["1", "morning"], ["2", "evening"], ["all", "evening"]]) {
    const expected = clean(vm.runInContext(`getLehrlingeDriverSchedule_("2026-09-21", "2026-09-25", "${route}", "${direction}")`, gas));
    const actual = clean(getDriverSchedule(snapshot, planMap, { from: "2026-09-21", to: "2026-09-25", route, direction }));
    assert.deepEqual(actual, expected, `route=${route} direction=${direction}`);
  }

  assert.deepEqual(clean(getDriverStudents(snapshot)), clean(vm.runInContext("getLehrlingeDriverStudents_()", gas)));

  const expectedPlan = clean(vm.runInContext(`getLehrlingeDriverStudentPlan_("anna", "2026-09-21", "2026-09-25", { id: "1" })`, gas));
  const actualPlan = clean(getDriverStudentPlan(snapshot, planMap, "anna", "2026-09-21", "2026-09-25", { id: "1" }));
  assert.deepEqual(actualPlan, expectedPlan);
});

test("Unbekannter Schüler wirft student_not_found", () => {
  assert.throws(() => getDriverStudentPlan({ students: [], points: [] }, new Map(), "x", "2026-09-21", "2026-09-22", {}), /student_not_found/);
});
