import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays, cleanDates, formatDate, formatSelection, fromISO, monthGrid, toISO, untilChips, workweek, MAX_DATES,
} from "../assets/js/ui/datePicker.js";

test("fromISO rejects impossible dates, toISO round-trips", () => {
  assert.equal(fromISO("2026-02-30"), null);
  assert.equal(fromISO("22.09.2026"), null);
  assert.equal(fromISO(""), null);
  assert.equal(toISO(fromISO("2026-09-22")), "2026-09-22");
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("monthGrid: Monday first, blanks before/after the month", () => {
  const grid = monthGrid(2026, 8); // September 2026 starts on a Tuesday
  assert.equal(grid.length, 42);
  assert.equal(grid[0], null);
  assert.equal(grid[1].iso, "2026-09-01");
  assert.equal(grid.filter(Boolean).length, 30);
  assert.equal(grid.filter(Boolean).at(-1).iso, "2026-09-30");
  const feb = monthGrid(2028, 1); // leap year, starts on a Tuesday
  assert.equal(feb.filter(Boolean).length, 29);
});

test("workweek: Mo–Fr of this/next week, past days dropped", () => {
  assert.deepEqual(workweek("2026-09-21", 0), ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]); // Monday
  assert.deepEqual(workweek("2026-09-23", 0), ["2026-09-23", "2026-09-24", "2026-09-25"]); // Wednesday
  assert.deepEqual(workweek("2026-09-23", 1), ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.deepEqual(workweek("2026-09-26", 0), []); // Saturday: this week is over
  assert.equal(workweek("2026-09-26", 1).length, 5);
  assert.deepEqual(workweek("2026-12-30", 1), ["2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08"]);
});

test("cleanDates: valid, unique, sorted, capped", () => {
  assert.deepEqual(cleanDates(["2026-09-24", "x", "2026-09-22", "2026-09-24", "2026-02-30"]), ["2026-09-22", "2026-09-24"]);
  assert.deepEqual(cleanDates(null), []);
  const many = Array.from({ length: 100 }, (_, i) => addDays("2026-09-01", i));
  assert.equal(cleanDates(many).length, MAX_DATES);
});

test("formatDate / formatSelection", () => {
  assert.match(formatDate("2026-09-23"), /^Mi\.?,? 23\.09\.2026$/);
  assert.equal(formatSelection([]), "");
  assert.match(formatSelection(["2026-09-23"]), /23\.09\.2026/);
  assert.equal(formatSelection(["2026-09-23", "2026-09-24"]), "2 Tage · 23.09., 24.09.");
  assert.equal(formatSelection(["2026-09-24", "2026-09-22", "2026-09-23"]), "3 Tage · 22.09., 23.09., 24.09.");
  assert.equal(formatSelection(workweek("2026-09-21", 0)), "5 Tage · 21.09. – 25.09.");
});

test("untilChips: relative to the start date, month end only if it is later", () => {
  assert.deepEqual(untilChips("2026-09-22").map((c) => [c.label, c.dates[0]]),
    [["+1 Woche", "2026-09-29"], ["+2 Wochen", "2026-10-06"], ["+4 Wochen", "2026-10-20"], ["Monatsende", "2026-09-30"]]);
  assert.ok(!untilChips("2026-09-30").some((c) => c.label === "Monatsende"));
  assert.deepEqual(untilChips(""), []);
});
