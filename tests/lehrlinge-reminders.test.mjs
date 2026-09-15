import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(new URL('../source/lehrlinge_reminders.gs', import.meta.url), 'utf8');
function fixture() {
  const props = new Map();
  const calls = [];
  let rows = [];
  let fail = false;
  let now = '2026-09-16T07:01:00Z';
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  const ctx = vm.createContext({ Date: Clock, console,
    Utilities: { formatDate: (d, zone, format) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(p => [p.type, p.value]));
      return format === 'HH' ? parts.hour : `${parts.year}-${parts.month}-${parts.day}`;
    } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k), setProperty: (k,v) => props.set(k,v), deleteProperty: k => props.delete(k) }) },
    SpreadsheetApp: { getActive: () => ({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => [['report_date','shift','route','timestamp'], ...rows] }) }) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    orderNotificationConfig_: () => ({ key: 'mock', secret: 'mock', notifyPhoneDay: '+431234' }),
    sendZadarmaSms_: (...args) => { calls.push(args); if (fail) throw Error('timeout'); return { status: 'success' }; },
  });
  vm.runInContext(source, ctx);
  return { ctx, props, calls, setRows: r => { rows = r; }, setNow: n => { now = n; }, fail: () => { fail = true; } };
}
test('national holidays, weekends, Easter and valid dates', () => {
  const {ctx:c} = fixture();
  for (const day of ['2026-04-06','2026-05-14','2026-05-25','2026-06-04','2026-10-26','2026-12-25','2027-03-29','2026-09-19']) assert.equal(c.lrWorking_(day, []), false, day);
  assert.equal(c.lrWorking_('2026-09-16', []), true);
  assert.equal(c.lrWorking_('2026-09-16', ['2026-09-16']), false);
  assert.equal(c.lrDate_('2026-02-30'), '');
});
test('previous workday stays within current week, including holiday Monday', () => {
  const {ctx:c} = fixture();
  assert.equal(c.lrTargets_('2026-09-14','09',[]).length, 1);
  assert.equal(c.lrTargets_('2026-04-07','17',[]).length, 1);
  assert.equal(c.lrTargets_('2026-05-15','17',[])[1].date, '2026-05-13');
  assert.equal(c.lrTargets_('2026-09-16','09',[])[1].date, '2026-09-15');
  assert.equal(c.lrTargets_('2026-10-26','09',[]).length, 0);
});
test('missing, duplicate, corrected reports and afternoon recheck', () => {
  const {ctx:c} = fixture();
  const targets = [{date:'2026-09-16', shifts:['Früh','Nachmittag']}];
  const rows = ['Früh','Nachmittag'].flatMap(shift => [1,2].map(route => ({report_date:'2026-09-16', shift, route})));
  assert.equal(c.lrIssues_(rows,targets).length,0);
  rows.pop();
  assert.match(c.lrIssues_(rows,targets).join(), /Nachmittag R2: fehlt/);
  rows.push({...rows[0]});
  assert.match(c.lrIssues_(rows,targets).join(), /Früh R1: 2 Berichte/);
  rows.pop(); rows.push({report_date:'2026-09-16',shift:'Nachmittag',route:2});
  assert.equal(c.lrIssues_(rows,targets).length,0);
});
test('suspicious shift, invalid fields, late morning correction', () => {
  const {ctx:c} = fixture();
  vm.runInContext(`var early = new Date('2026-09-16T06:00:00Z'); var late = new Date('2026-09-16T14:00:00Z');`, c);
  const targets=[{date:'2026-09-16',shifts:['Früh']}];
  assert.match(c.lrIssues_([{report_date:'2026-09-16',shift:'Nachmittag',route:1,timestamp:c.early,row_num:2}],targets).join(), /Schicht prüfen/);
  assert.doesNotMatch(c.lrIssues_([{report_date:'2026-09-16',shift:'Früh',route:1,timestamp:c.late}],targets).join(), /Schicht prüfen/);
  assert.match(c.lrIssues_([{report_date:'',timestamp:c.early,row_num:3}],targets).join(), /Berichtsdatum/);
  assert.match(c.lrIssues_([{report_date:'2026-09-16',shift:'?',route:3}],targets).join(), /ungültig/);
});
test('disabled by default; test recipient only; repeated execution deduplicated', () => {
  const f=fixture(); f.ctx.processLehrlingeReminders(); assert.equal(f.calls.length,0);
  f.props.set('LEHRLINGE_REMINDERS_ENABLED','true');
  f.ctx.processLehrlingeReminders(); f.ctx.processLehrlingeReminders();
  assert.equal(f.calls.length,1); assert.equal(f.calls[0][0],'+4368181289405');
  assert.equal(f.calls[0][2],true); assert.match(f.calls[0][1],/^\[TEST\]/);
});
test('uncertain delivery is recorded and not automatically resent', () => {
  const f=fixture(); f.props.set('LEHRLINGE_REMINDERS_ENABLED','true'); f.fail();
  assert.throws(() => f.ctx.processLehrlingeReminders(), /timeout/);
  f.ctx.processLehrlingeReminders(); assert.equal(f.calls.length,1);
  assert.match(f.props.get('LEHRLINGE_REMINDERS_LAST_09_4368181289405'), /failed_or_unknown/);
});
test('preview does not send; correct reports do not send', () => {
  const f=fixture();
  f.setRows(['2026-09-15','2026-09-16'].flatMap(date => ['Früh','Nachmittag'].flatMap(shift => [1,2].map(route => [date,shift,route,'']))));
  assert.equal(f.ctx.previewLehrlingeMorning().message,'');
  f.props.set('LEHRLINGE_REMINDERS_ENABLED','true'); f.ctx.processLehrlingeReminders();
  assert.equal(f.calls.length,0);
});
test('Vienna schedule, evening reminder, winter time and weekend silence', () => {
  const f=fixture(); f.props.set('LEHRLINGE_REMINDERS_ENABLED','true');
  f.setNow('2026-09-16T06:59:00Z'); f.ctx.processLehrlingeReminders(); assert.equal(f.calls.length,0);
  f.setNow('2026-09-16T07:01:00Z'); f.ctx.processLehrlingeReminders(); assert.equal(f.calls.length,1);
  f.setNow('2026-09-16T15:01:00Z'); f.ctx.processLehrlingeReminders(); assert.equal(f.calls.length,2);
  assert.match(f.calls[1][1], /16\.09\. Nachmittag R2: fehlt/);
  f.setNow('2026-09-19T07:01:00Z'); f.ctx.processLehrlingeReminders(); assert.equal(f.calls.length,2);
  f.setNow('2026-12-16T07:01:00Z'); f.ctx.processLehrlingeReminders(); assert.equal(f.calls.length,2);
  f.setNow('2026-12-16T08:01:00Z'); f.ctx.processLehrlingeReminders(); assert.equal(f.calls.length,3);
});
test('live mode uses first day phone and does not use test number', () => {
  const f=fixture(); f.props.set('LEHRLINGE_REMINDERS_ENABLED','true'); f.props.set('LEHRLINGE_REMINDERS_MODE','live');
  f.ctx.processLehrlingeReminders(); assert.equal(f.calls[0][0],'+431234'); assert.equal(f.calls[0][2],false);
});
test('automatic rollout on date, two recipients, removable copy and deduplication', () => {
  const f=fixture(); f.props.set('LEHRLINGE_REMINDERS_ENABLED','true');
  f.props.set('LEHRLINGE_REMINDERS_LIVE_FROM','2026-09-23');
  f.props.set('LEHRLINGE_REMINDERS_COPY_PHONE','+4368181289405');
  f.ctx.processLehrlingeReminders(); assert.equal(f.calls.length,1);
  f.setNow('2026-09-23T07:01:00Z'); f.ctx.processLehrlingeReminders(); f.ctx.processLehrlingeReminders();
  assert.equal(f.calls.length,3); assert.equal(f.calls[1][0],'+431234'); assert.equal(f.calls[2][0],'+4368181289405');
  assert.doesNotMatch(f.calls[1][1], /\[TEST\]/);
  f.props.delete('LEHRLINGE_REMINDERS_COPY_PHONE');
  f.setNow('2026-09-23T15:01:00Z'); f.ctx.processLehrlingeReminders(); assert.equal(f.calls.length,4);
});
