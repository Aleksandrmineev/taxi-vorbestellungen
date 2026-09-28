process.env.TZ = "Europe/Vienna"; // wie im GAS-Projekt (appsscript.json)
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { directionOpen } from "../api/_lib/lehrlinge-cutoff.js";

// Nur die Fristfunktion aus dem echten GAS-Quelltext (mit ihren Konstanten).
const source = fs.readFileSync(new URL("../source/lehrlinge_plan.gs", import.meta.url), "utf8");
const snippet = source.match(/const LEHRLINGE_MORNING_CUTOFF_HOUR[\s\S]*?\nfunction lehrlingeCutoffOpen_[\s\S]*?\n}\n/)[0];
const ctx = vm.createContext({
  Utilities: {
    formatDate: (d, zone, format) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
      return format === "H" ? String(Number(p.hour)) : `${p.year}-${p.month}-${p.day}`;
    },
  },
});
vm.runInContext(snippet, ctx);

// [Zeitpunkt (UTC), Fahrtag, Richtung, offen?] — Sommerzeit: Wien = UTC+2
const cases = [
  ["2026-09-28T17:59:00Z", "2026-09-29", "morning", true],  // Mo 19:59 -> Di Hinfahrt noch offen
  ["2026-09-28T18:00:00Z", "2026-09-29", "morning", false], // Mo 20:00 -> zu
  ["2026-09-28T18:00:00Z", "2026-09-30", "morning", true],  // übermorgen offen
  ["2026-09-28T08:59:00Z", "2026-09-28", "evening", true],  // Mo 10:59 Rückfahrt offen
  ["2026-09-28T09:00:00Z", "2026-09-28", "evening", false], // Mo 11:00 zu
  ["2026-09-28T09:00:00Z", "2026-09-28", "morning", false], // Hinfahrt heute längst zu
  ["2026-09-27T17:00:00Z", "2026-09-28", "morning", true],  // So 19:00 -> Montag offen
  ["2026-09-27T18:30:00Z", "2026-09-28", "morning", false], // So 20:30 -> Montag zu
  ["2026-10-01T18:30:00Z", "2026-10-01", "evening", false], // vergangener Tag
  ["2026-10-31T18:59:00Z", "2026-11-01", "morning", true],  // nach Zeitumstellung: Wien = UTC+1, 19:59
  ["2026-10-31T19:00:00Z", "2026-11-01", "morning", false], // 20:00 Winterzeit
];

test("Fristen: Hinfahrt bis 20:00 am Vortag, Rückfahrt bis 11:00 — GAS und Vercel gleich", () => {
  cases.forEach(([now, date, direction, open]) => {
    assert.equal(ctx.lehrlingeCutoffOpen_(date, direction, new Date(now)), open, `GAS ${now} ${date} ${direction}`);
    assert.equal(directionOpen(date, direction, new Date(now)), open, `Vercel ${now} ${date} ${direction}`);
  });
});
