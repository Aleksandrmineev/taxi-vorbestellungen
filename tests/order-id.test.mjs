import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../source/code.gs", import.meta.url), "utf8");
const start = source.indexOf("function orderId_(");
const fn = source.slice(start, source.indexOf("\n}\n", start) + 3);

function orderIdWith(usedIds) {
  const ctx = vm.createContext({
    SpreadsheetApp: {
      getActive: () => ({
        getSheetByName: () => ({
          getLastRow: () => usedIds.length + 1,
          getRange: () => ({ getValues: () => usedIds.map((id) => [id]) }),
        }),
      }),
    },
  });
  vm.runInContext(fn, ctx);
  return ctx.orderId_;
}

test("empty sheet: three-digit id", () => {
  const id = orderIdWith([])();
  assert.match(id, /^[1-9]\d{2}$/);
});

test("mostly full three-digit range: never returns a used id, moves on to four digits when needed", () => {
  const used = Array.from({ length: 900 }, (_, i) => String(100 + i)); // every 3-digit id taken
  for (let i = 0; i < 50; i++) {
    const id = orderIdWith(used)();
    assert.match(id, /^\d{4}$/);
    assert.ok(!used.includes(id));
  }
});

test("a nearly full range still yields unused ids (3 or 4 digits)", () => {
  const used = Array.from({ length: 890 }, (_, i) => String(100 + i)); // 10 free 3-digit ids
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const id = orderIdWith(used)();
    assert.ok(!used.includes(id), id);
    seen.add(id.length);
  }
  assert.ok([...seen].every((n) => n === 3 || n === 4));
});

test("extremely full 3- and 4-digit ranges fall through to five digits", () => {
  const used = [
    ...Array.from({ length: 900 }, (_, i) => String(100 + i)),
    ...Array.from({ length: 9000 }, (_, i) => String(1000 + i)),
  ];
  assert.match(orderIdWith(used)(), /^\d{5}$/);
});
