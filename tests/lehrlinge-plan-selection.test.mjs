import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../lehrlinge/assets/js/plan-selection.js", import.meta.url), "utf8");
const context = vm.createContext({ window: {} });
vm.runInContext(source, context);
const { planPointSelection, directionForShift } = context.window.PlanSelection;
const ids = (result) => result && [...result.ids].sort();

const points = [
  { id: "P1" }, { id: "P2" }, { id: "P3" }, { id: "P4" },
  { id: "SHORT", storage_id: "1899-12-30-legacy" }, // Punkt mit umgeschriebener ID
];
const entry = (route, direction, pointIds) => ({ route, direction, points: pointIds.map((pointId) => ({ pointId })) });

test("Früh = Hinfahrt, Nachmittag = Rückfahrt, sonst Hinfahrt", () => {
  assert.equal(directionForShift("Früh"), "morning");
  assert.equal(directionForShift("Nachmittag"), "evening");
  assert.equal(directionForShift(""), "morning");
});

test("nimmt den nächsten Tag mit der Route und die Punkte aus dem Plan", () => {
  const days = [
    { date: "2026-09-22", routes: [entry("2", "morning", ["P3"])] }, // andere Route: übersprungen
    { date: "2026-09-23", routes: [entry("1", "morning", ["P1", "P3"]), entry("1", "evening", ["P2"])] },
    { date: "2026-09-24", routes: [entry("1", "morning", ["P4"])] },
  ];
  const morning = planPointSelection({ days, route: "1", points, direction: "morning", today: "2026-09-22" });
  assert.deepEqual(ids(morning), ["P1", "P3"]);
  assert.equal(morning.date, "2026-09-23");
  assert.equal(morning.direction, "morning");
  const evening = planPointSelection({ days, route: "1", points, direction: "evening", today: "2026-09-22" });
  assert.deepEqual(ids(evening), ["P2"]);
});

test("frühere Tage als heute werden ignoriert, Tage werden nach Datum sortiert", () => {
  const days = [
    { date: "2026-09-24", routes: [entry("1", "morning", ["P4"])] },
    { date: "2026-09-21", routes: [entry("1", "morning", ["P1"])] }, // gestern
    { date: "2026-09-23", routes: [entry("1", "morning", ["P2"])] },
  ];
  const result = planPointSelection({ days, route: "1", points, direction: "morning", today: "2026-09-22" });
  assert.deepEqual(ids(result), ["P2"]);
  assert.equal(result.date, "2026-09-23");
});

test("gibt es die passende Richtung nicht, wird die andere genommen (mit richtiger Richtung im Ergebnis)", () => {
  const days = [{ date: "2026-09-23", routes: [entry("1", "morning", ["P1"])] }];
  const result = planPointSelection({ days, route: "1", points, direction: "evening", today: "2026-09-22" });
  assert.deepEqual(ids(result), ["P1"]);
  assert.equal(result.direction, "morning");
});

test("Punkt-IDs werden auch über storage_id gefunden", () => {
  const days = [{ date: "2026-09-23", routes: [entry("1", "morning", ["1899-12-30-legacy", "P1"])] }];
  const result = planPointSelection({ days, route: "1", points, direction: "morning", today: "2026-09-22" });
  assert.deepEqual(ids(result), ["P1", "SHORT"]);
});

test("kein Plan / keine passenden Punkte: null (dann gilt weiter der letzte Bericht)", () => {
  assert.equal(planPointSelection({ days: [], route: "1", points, direction: "morning" }), null);
  assert.equal(planPointSelection({ days: undefined, route: "1", points, direction: "morning" }), null);
  const unknown = [{ date: "2026-09-23", routes: [entry("1", "morning", ["X9"])] }];
  assert.equal(planPointSelection({ days: unknown, route: "1", points, direction: "morning" }), null);
  const otherRoute = [{ date: "2026-09-23", routes: [entry("2", "morning", ["P1"])] }];
  assert.equal(planPointSelection({ days: otherRoute, route: "1", points, direction: "morning" }), null);
});

test("ein Tag ohne passende Punkte wird übersprungen, der nächste Tag zählt", () => {
  const days = [
    { date: "2026-09-23", routes: [entry("1", "morning", ["X9"])] },
    { date: "2026-09-24", routes: [entry("1", "morning", ["P2"])] },
  ];
  const result = planPointSelection({ days, route: "1", points, direction: "morning", today: "2026-09-22" });
  assert.deepEqual(ids(result), ["P2"]);
  assert.equal(result.date, "2026-09-24");
});
