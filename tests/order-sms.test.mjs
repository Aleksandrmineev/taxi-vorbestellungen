import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const source = readFileSync(new URL('../source/code.gs', import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(source.match(/function orderSmsText_\(item, reminder\) \{[\s\S]*?\n\}/)[0], ctx);
test('message with embedded phone needs no separate phone field', () => {
  assert.equal(ctx.orderSmsText_({time:'09:30',message:'Bahnhof +436811234567',id:'123'}), '09:30\nBahnhof +436811234567\n#123');
});
test('separate phone follows message in confirmations and reminders', () => {
  for (const reminder of [false,true]) {
    assert.equal(ctx.orderSmsText_({time:'09:30',message:'Bahnhof',phone_raw:'+436811234567',id:'123'},reminder), '09:30\nBahnhof\nTel: +436811234567\n#123');
  }
});
