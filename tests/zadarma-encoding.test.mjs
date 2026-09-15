import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const source = readFileSync(new URL('../source/code.gs', import.meta.url), 'utf8');
const fn = source.match(/function formEncode_\(value\) \{[\s\S]*?\n\}/)[0];
const ctx = vm.createContext({});
vm.runInContext(fn, ctx);
test('Zadarma PHP RFC1738 encoding includes punctuation in reminder text', () => {
  assert.equal(ctx.formEncode_('Früh R1: 2 Berichte (doppelt)'), 'Fr%C3%BCh+R1%3A+2+Berichte+%28doppelt%29');
  assert.equal(ctx.formEncode_("!'()*~ +\n"), '%21%27%28%29%2A%7E+%2B%0A');
  assert.equal(ctx.formEncode_('Teamsale'), 'Teamsale');
});
