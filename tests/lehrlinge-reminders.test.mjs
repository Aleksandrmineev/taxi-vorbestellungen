import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(new URL('../source/lehrlinge_reminders.gs', import.meta.url), 'utf8');
function fixture() {
  const props = new Map();
  const calls = [];
  const waCalls = [];
  let rows = [];
  let fail = false;
  let waFail = false;
  let waImpl = null;
  const triggers = [];
  let botConfigured = true;
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
    sendWhatsAppMessage_: (...args) => { waCalls.push(args); if (waImpl) return waImpl(...args); if (waFail) throw Error('wa-timeout'); return { ok: true }; },
    mineevBotConfig_: () => (botConfigured ? { url: 'https://bot.test', token: 't' } : { url: '', token: '' }),
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: fn => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }),
    },
  });
  vm.runInContext(source, ctx);
  return { ctx, props, calls, waCalls, setRows: r => { rows = r; }, setNow: n => { now = n; }, fail: () => { fail = true; }, failWa: () => { waFail = true; }, setWa: fn => { waImpl = fn; }, triggers, noBot: () => { botConfigured = false; } };
}
test('national holidays, weekends, Easter and valid dates', () => {
  const {ctx:c} = fixture();
  for (const day of ['2026-04-06','2026-05-14','2026-05-25','2026-06-04','2026-10-26','2026-12-25','2027-03-29','2026-09-19']) assert.equal(c.lrWorking_(day, []), false, day);
  assert.equal(c.lrWorking_('2026-09-16', []), true);
  assert.equal(c.lrWorking_('2026-09-16', ['2026-09-16']), false);
  assert.equal(c.lrDate_('2026-02-30'), '');
});
test('window = today + last 3 workdays; weekends and holidays are skipped, not a barrier', () => {
  const {ctx:c} = fixture();
  const dates = (today, slot='17', excluded=[], previous) => [...c.lrTargets_(today, slot, excluded, previous)].map(x => x.date);
  // Monday: Fri, Thu, Wed of the previous week
  assert.deepEqual(dates('2026-09-14'), ['2026-09-14','2026-09-11','2026-09-10','2026-09-09']);
  // Wednesday: Tue, Mon, and Fri across the weekend
  assert.deepEqual(dates('2026-09-16'), ['2026-09-16','2026-09-15','2026-09-14','2026-09-11']);
  // Tuesday after Easter Monday: holiday is skipped
  assert.deepEqual(dates('2026-04-07'), ['2026-04-07','2026-04-03','2026-04-02','2026-04-01']);
  // excluded dates (e.g. school holidays) are skipped as well
  assert.deepEqual(dates('2026-09-16','17',['2026-09-15','2026-09-14']), ['2026-09-16','2026-09-11','2026-09-10','2026-09-09']);
  // explicit window sizes
  assert.deepEqual(dates('2026-09-16','17',[],1), ['2026-09-16','2026-09-15']);
  assert.deepEqual(dates('2026-09-16','17',[],0), ['2026-09-16']);
  // nothing on weekends and holidays
  assert.deepEqual(dates('2026-09-19'), []); assert.deepEqual(dates('2026-10-26'), []);
  // shifts: morning check looks at today's Früh only; previous days are complete
  const morning = c.lrTargets_('2026-09-16','09',[]);
  assert.deepEqual([...morning[0].shifts], ['Früh']); assert.deepEqual([...morning[1].shifts], ['Früh','Nachmittag']);
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
  f.setRows(['2026-09-11','2026-09-14','2026-09-15','2026-09-16'].flatMap(date => ['Früh','Nachmittag'].flatMap(shift => [1,2].map(route => [date,shift,route,'']))));
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
test('WhatsApp duplicate sent once per slot with the same text, deduplicated like SMS', () => {
  const f=fixture(); f.props.set('LEHRLINGE_REMINDERS_ENABLED','true');
  f.ctx.processLehrlingeReminders(); f.ctx.processLehrlingeReminders();
  assert.equal(f.waCalls.length,1);
  assert.equal(f.waCalls[0][0],'4368181289405');
  assert.equal(f.waCalls[0][1],f.calls[0][1]);
  f.setNow('2026-09-16T15:01:00Z'); f.ctx.processLehrlingeReminders();
  assert.equal(f.waCalls.length,2);
});
test('WhatsApp switches to the group JID once in live mode', () => {
  const f=fixture(); f.props.set('LEHRLINGE_REMINDERS_ENABLED','true'); f.props.set('LEHRLINGE_REMINDERS_MODE','live');
  f.ctx.processLehrlingeReminders();
  assert.equal(f.waCalls.length,1);
  assert.equal(f.waCalls[0][0],'436506367662-1552028657@g.us');
});
test('WhatsApp failure is recorded and surfaced, independent of SMS status', () => {
  const f=fixture(); f.props.set('LEHRLINGE_REMINDERS_ENABLED','true'); f.failWa();
  assert.throws(() => f.ctx.processLehrlingeReminders(), /wa-timeout/);
  assert.equal(f.calls.length,1);
  assert.match(f.props.get('LEHRLINGE_REMINDERS_LAST_WA_09'), /failed_or_unknown/);
  f.ctx.processLehrlingeReminders();
  assert.equal(f.waCalls.length,1);
});

const enable = (f, extra = {}) => {
  f.props.set('LEHRLINGE_REMINDERS_ENABLED', 'true');
  Object.entries(extra).forEach(([k, v]) => f.props.set('LEHRLINGE_REMINDERS_' + k, v));
};
const GROUP = '436506367662-1552028657@g.us';

test('default channels unchanged: SMS and WhatsApp both', () => {
  const f = fixture(); enable(f);
  const preview = f.ctx.previewLehrlingeMorning();
  assert.deepEqual({ ...preview.channels }, { sms: true, whatsapp: true });
  f.ctx.processLehrlingeReminders();
  assert.equal(f.calls.length, 1); assert.equal(f.waCalls.length, 1);
});

test('channels=whatsapp in live mode: group only, no SMS, no [TEST] prefix', () => {
  const f = fixture(); enable(f, { MODE: 'live', CHANNELS: 'whatsapp' });
  const preview = f.ctx.previewLehrlingeMorning();
  assert.deepEqual([...preview.phones], []);
  assert.equal(preview.whatsappTarget, GROUP);
  f.ctx.processLehrlingeReminders(); f.ctx.processLehrlingeReminders();
  assert.equal(f.calls.length, 0);
  assert.equal(f.waCalls.length, 1);
  assert.equal(f.waCalls[0][0], GROUP);
  assert.doesNotMatch(f.waCalls[0][1], /\[TEST\]/);
  assert.match(f.waCalls[0][1], /^Lehrlinge:/);
});

test('channels=whatsapp in test mode: test number with [TEST], no SMS', () => {
  const f = fixture(); enable(f, { CHANNELS: 'whatsapp' });
  f.ctx.processLehrlingeReminders();
  assert.equal(f.calls.length, 0);
  assert.equal(f.waCalls[0][0], '4368181289405');
  assert.match(f.waCalls[0][1], /^\[TEST\]/);
});

test('channels=whatsapp does not need the SMS day phone', () => {
  const f = fixture(); enable(f, { MODE: 'live', CHANNELS: 'whatsapp' });
  f.ctx.orderNotificationConfig_ = () => ({ key: 'mock', secret: 'mock', notifyPhoneDay: '' });
  assert.doesNotThrow(() => f.ctx.processLehrlingeReminders());
  assert.equal(f.waCalls.length, 1);
  const sms = fixture(); enable(sms, { MODE: 'live', CHANNELS: 'sms' });
  sms.ctx.orderNotificationConfig_ = () => ({ key: 'mock', secret: 'mock', notifyPhoneDay: '' });
  assert.throws(() => sms.ctx.processLehrlingeReminders(), /Day phone missing/);
});

test('channels=sms: no WhatsApp; invalid channel value sends nothing', () => {
  const f = fixture(); enable(f, { CHANNELS: 'sms' });
  f.ctx.processLehrlingeReminders();
  assert.equal(f.calls.length, 1); assert.equal(f.waCalls.length, 0);
  const bad = fixture(); enable(bad, { CHANNELS: 'whatsap' });
  assert.throws(() => bad.ctx.processLehrlingeReminders(), /Invalid LEHRLINGE_REMINDERS_CHANNELS/);
  assert.equal(bad.calls.length, 0); assert.equal(bad.waCalls.length, 0);
});

test('WhatsApp "skipped" (bot not configured) is not recorded as sent and is retried, up to 3 attempts per slot', () => {
  const f = fixture(); enable(f, { MODE: 'live', CHANNELS: 'whatsapp' });
  f.setWa(() => ({ ok: false, skipped: true }));
  for (let i = 0; i < 3; i++) assert.throws(() => f.ctx.processLehrlingeReminders(), /whatsapp:whatsapp_not_sent/);
  f.ctx.processLehrlingeReminders(); f.ctx.processLehrlingeReminders(); // Limit erreicht: keine weiteren Versuche
  assert.equal(f.waCalls.length, 3);
  assert.match(f.props.get('LEHRLINGE_REMINDERS_LAST_WA_09'), /"status":"failed"/);
  // sobald der Bot geht, wird beim nächsten Durchlauf (neuer Tag) wieder gesendet
  f.setWa(() => ({ ok: true }));
  f.setNow('2026-09-17T07:01:00Z'); f.ctx.processLehrlingeReminders();
  assert.equal(f.waCalls.length, 4);
  assert.match(f.props.get('LEHRLINGE_REMINDERS_LAST_WA_09'), /"status":"sent"/);
});

test('confirmed HTTP failure is retried and then delivered once; sent is not repeated', () => {
  const f = fixture(); enable(f, { MODE: 'live', CHANNELS: 'whatsapp' });
  let n = 0;
  f.setWa(() => { n += 1; if (n === 1) throw new Error('whatsapp_http_502:bad_gateway'); return { ok: true }; });
  assert.throws(() => f.ctx.processLehrlingeReminders(), /whatsapp_http_502/);
  f.ctx.processLehrlingeReminders();
  f.ctx.processLehrlingeReminders();
  assert.equal(f.waCalls.length, 2);
  assert.match(f.props.get('LEHRLINGE_REMINDERS_LAST_WA_09'), /"status":"sent"/);
});

test('unclear WhatsApp outcome (timeout, invalid JSON) is not retried automatically', () => {
  const f = fixture(); enable(f, { MODE: 'live', CHANNELS: 'whatsapp' }); f.failWa();
  assert.throws(() => f.ctx.processLehrlingeReminders(), /wa-timeout/);
  f.ctx.processLehrlingeReminders();
  assert.equal(f.waCalls.length, 1);
  assert.match(f.props.get('LEHRLINGE_REMINDERS_LAST_WA_09'), /failed_or_unknown/);
});

test('setupLehrlingeWhatsAppLive: live now, WhatsApp only, single trigger; restore brings SMS back', () => {
  const f = fixture();
  f.props.set('LEHRLINGE_REMINDERS_LIVE_FROM', '2026-09-23');
  f.props.set('LEHRLINGE_REMINDERS_MODE', 'test');
  f.ctx.setupLehrlingeWhatsAppLive();
  f.ctx.setupLehrlingeWhatsAppLive(); // idempotent
  assert.equal(f.props.get('LEHRLINGE_REMINDERS_MODE'), 'live');
  assert.equal(f.props.get('LEHRLINGE_REMINDERS_CHANNELS'), 'whatsapp');
  assert.equal(f.props.get('LEHRLINGE_REMINDERS_LIVE_FROM'), undefined);
  assert.equal(f.props.get('LEHRLINGE_REMINDERS_ENABLED'), 'true');
  assert.equal(f.triggers.length, 1);
  f.ctx.processLehrlingeReminders();
  assert.equal(f.calls.length, 0); assert.equal(f.waCalls[0][0], GROUP);
  f.ctx.restoreLehrlingeSmsChannel();
  assert.equal(f.props.get('LEHRLINGE_REMINDERS_CHANNELS'), 'sms,whatsapp');
});

test('setupLehrlingeWhatsAppLive refuses to switch when the WhatsApp bot is not configured', () => {
  const f = fixture(); f.noBot();
  assert.throws(() => f.ctx.setupLehrlingeWhatsAppLive(), /mineev-bot not configured/);
  assert.equal(f.props.get('LEHRLINGE_REMINDERS_CHANNELS'), undefined);
  assert.equal(f.triggers.length, 0);
});

test('errors of the last 3 workdays are all in one message, oldest not dropped', () => {
  const f = fixture(); enable(f, { MODE: 'live', CHANNELS: 'whatsapp' });
  // Wednesday 16.09. 09:00: Tue, Mon and Fri (across the weekend) are checked
  f.setRows(['2026-09-15','2026-09-14'].flatMap(date => ['Früh','Nachmittag'].flatMap(shift => [1,2].map(route => [date,shift,route,''])))
    .concat([['2026-09-16','Früh',1,''],['2026-09-16','Früh',2,'']]));
  const preview = f.ctx.previewLehrlingeMorning();
  assert.equal(preview.issues.length, 4); // nur Freitag 11.09.: Früh/Nachmittag R1/R2 fehlen
  assert.match(preview.message, /11\.09\. Früh R1: fehlt/);
  assert.match(preview.message, /11\.09\. Nachmittag R2: fehlt/);
  assert.doesNotMatch(preview.message, /10\.09\./); // nur 3 Arbeitstage zurück
});

test('PREVIOUS_DAYS property changes the window; invalid value stops sending', () => {
  const f = fixture(); enable(f, { PREVIOUS_DAYS: '1' });
  const days = new Set([...f.ctx.previewLehrlingeMorning().issues].map(x => x.slice(0, 6)));
  assert.deepEqual([...days].sort(), ['15.09.','16.09.']);
  for (const bad of ['-1', '11', 'abc', '1.5']) {
    const g = fixture(); enable(g, { PREVIOUS_DAYS: bad });
    assert.throws(() => g.ctx.processLehrlingeReminders(), /Invalid LEHRLINGE_REMINDERS_PREVIOUS_DAYS/, bad);
    assert.equal(g.calls.length + g.waCalls.length, 0);
  }
});
