// Optional Lehrlinge SMS add-on. See lehrlinge/SMS-REMINDERS.md.
// Disabled until setupLehrlingeReminderTest() is run explicitly.
const LR_PREFIX_ = 'LEHRLINGE_REMINDERS_';
const LR_ZONE_ = 'Europe/Vienna';
const LR_WHATSAPP_TEST_TARGET_ = '4368181289405';
const LR_WHATSAPP_GROUP_JID_ = '436506367662-1552028657@g.us'; // Pöls Lehrlinge-wer fährt?

const LR_WA_MAX_ATTEMPTS_ = 3;
const LR_DEFAULT_PREVIOUS_DAYS_ = 3; // Script Property LEHRLINGE_REMINDERS_PREVIOUS_DAYS (0-10)

// Kanäle: Script Property LEHRLINGE_REMINDERS_CHANNELS = "sms,whatsapp" (Standard) | "whatsapp" | "sms".
function lrChannels_(props) {
  const list = String(props.getProperty(LR_PREFIX_ + 'CHANNELS') || 'sms,whatsapp').toLowerCase()
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length || list.some(c => !['sms', 'whatsapp'].includes(c))) throw new Error('Invalid LEHRLINGE_REMINDERS_CHANNELS');
  return { sms: list.includes('sms'), whatsapp: list.includes('whatsapp') };
}

function lrWhatsAppTarget_(mode) {
  return mode === 'test' ? LR_WHATSAPP_TEST_TARGET_ : LR_WHATSAPP_GROUP_JID_;
}

function lrDate_(value) {
  if (value instanceof Date && !isNaN(value)) return Utilities.formatDate(value, LR_ZONE_, 'yyyy-MM-dd');
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(s + 'T12:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : '';
}

function lrOffset_(date, days) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function lrHolidays_(year) {
  // Gregorian Easter (Meeus/Jones/Butcher); national Austrian holidays.
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114;
  const easter = new Date(Date.UTC(year, Math.floor(n / 31) - 1, n % 31 + 1, 12)).toISOString().slice(0, 10);
  return ['01-01', '01-06', '05-01', '08-15', '10-26', '11-01', '12-08', '12-25', '12-26']
    .map(s => year + '-' + s).concat([1, 39, 50, 60].map(days => lrOffset_(easter, days)));
}

function lrWorking_(date, excluded) {
  const day = new Date(date + 'T12:00:00Z').getUTCDay();
  return day !== 0 && day !== 6 && !lrHolidays_(Number(date.slice(0, 4))).includes(date) && !excluded.includes(date);
}

// Heute (09:00 nur Früh, 17:00 Früh und Nachmittag) plus die letzten `previousDays` Arbeitstage (ganze Tage).
// Wochenenden und Feiertage werden übersprungen, sie unterbrechen das Fenster nicht.
// Tage ganz ohne Berichte gelten als frei (Ferien, Brückentag), siehe lrIssues_:
//  - vergangene Tage ohne jeden Bericht werden nicht geprüft;
//  - heute 17:00 ohne jeden Bericht: freier Tag, keine Erinnerung;
//  - heute 09:00 ohne Bericht, aber schon der vorige Arbeitstag war leer: die freie Zeit dauert vermutlich an, keine Erinnerung.
function lrTargets_(today, slot, excluded, previousDays) {
  if (!lrWorking_(today, excluded)) return [];
  const wanted = previousDays === undefined ? LR_DEFAULT_PREVIOUS_DAYS_ : previousDays;
  const todayTarget = { date: today, shifts: slot === '09' ? ['Früh'] : ['Früh', 'Nachmittag'], skipIfNoReports: slot === '17' };
  const result = [todayTarget];
  let cursor = today;
  let previousWorkday = '';
  for (let guard = 0; guard < 60 && (!previousWorkday || result.length - 1 < wanted); guard++) {
    cursor = lrOffset_(cursor, -1);
    if (!lrWorking_(cursor, excluded)) continue;
    if (!previousWorkday) previousWorkday = cursor;
    if (result.length - 1 < wanted) result.push({ date: cursor, shifts: ['Früh', 'Nachmittag'], skipIfNoReports: true });
  }
  if (slot === '09' && previousWorkday) todayTarget.skipIfPreviousEmpty = previousWorkday;
  return result;
}

function lrIssues_(rows, targets) {
  const issues = [];
  // Ein Bericht (auch mit ungültigem Datum, aber an diesem Tag gesendet) heißt: es wurde gefahren.
  const hasReports = date => rows.some(row => lrDate_(row.report_date) === date ||
    (!lrDate_(row.report_date) && lrDate_(row.timestamp) === date));
  targets.forEach(target => {
    if (target.skipIfNoReports && !hasReports(target.date)) return; // freier Tag: keine Erinnerung
    if (target.skipIfPreviousEmpty && !hasReports(target.date) && !hasReports(target.skipIfPreviousEmpty)) return;
    const dateLabel = target.date.slice(8) + '.' + target.date.slice(5, 7) + '.';
    const relevant = rows.filter(row => lrDate_(row.report_date) === target.date);
    rows.filter(row => !lrDate_(row.report_date) && lrDate_(row.timestamp) === target.date).forEach(row => {
      issues.push(dateLabel + ' Zeile ' + row.row_num + ': Berichtsdatum fehlt/ungültig');
    });
    target.shifts.forEach(shift => {
      ['1', '2'].forEach(route => {
        const count = relevant.filter(row => String(row.route).trim() === route && String(row.shift).trim() === shift).length;
        if (count !== 1) issues.push(dateLabel + ' ' + shift + ' R' + route + ': ' + (count ? count + ' Berichte (doppelt)' : 'fehlt'));
      });
    });
    relevant.forEach(row => {
      const shift = String(row.shift).trim();
      if (!['Früh', 'Nachmittag'].includes(shift) || !['1', '2'].includes(String(row.route).trim())) {
        issues.push(dateLabel + ' Zeile ' + row.row_num + ': Route/Schicht ungültig');
      }
      // Only an early afternoon report is suspicious; late morning corrections are valid.
      const submitted = row.timestamp;
      if (shift === 'Nachmittag' && submitted instanceof Date && !isNaN(submitted) &&
          lrDate_(submitted) === target.date && Number(Utilities.formatDate(submitted, LR_ZONE_, 'HH')) < 12) {
        issues.push(dateLabel + ' Zeile ' + row.row_num + ': Nachmittag vor 12 Uhr gemeldet; Schicht prüfen');
      }
    });
  });
  return issues;
}

function lrPreview_(now, slot) {
  const props = PropertiesService.getScriptProperties();
  const excluded = String(props.getProperty(LR_PREFIX_ + 'EXCLUDED_DATES') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (excluded.some(s => !lrDate_(s))) throw new Error('Invalid LEHRLINGE_REMINDERS_EXCLUDED_DATES');
  const today = lrDate_(now);
  const previousRaw = String(props.getProperty(LR_PREFIX_ + 'PREVIOUS_DAYS') || '').trim();
  const previousDays = previousRaw === '' ? LR_DEFAULT_PREVIOUS_DAYS_ : Number(previousRaw);
  if (!Number.isInteger(previousDays) || previousDays < 0 || previousDays > 10) throw new Error('Invalid LEHRLINGE_REMINDERS_PREVIOUS_DAYS');
  const targets = lrTargets_(today, slot, excluded, previousDays);
  if (!targets.length) return { today: today, slot: slot, issues: [], message: '' };
  const ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('Lehrlinge spreadsheet unavailable');
  const sheet = ss.getSheetByName('Submissions');
  if (!sheet) throw new Error('Submissions sheet missing; no SMS sent');
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  ['report_date', 'shift', 'route', 'timestamp'].forEach(h => {
    if (!headers.includes(h)) throw new Error('Missing Submissions column: ' + h);
  });
  const allRows = values.slice(1).map((r, index) => {
    const row = { row_num: index + 2 };
    headers.forEach((h, i) => { row[h] = r[i]; });
    return row;
  });
  // Zeilen mit deletion_status = DELETE (in der Tabelle/„Letzte Sendungen“ zum Löschen markiert) sind keine Berichte:
  // sie zählen weder als Doppelt noch als vorhandener Bericht (wie submissionMarkedForDeletion_ im Hauptmodul).
  const rows = allRows.filter(row => String(row.deletion_status || '').trim().toUpperCase() !== 'DELETE');
  const deletion = { deletionColumn: headers.includes('deletion_status'), ignoredDeleted: allRows.length - rows.length };
  // Diagnose: fehlt die Spalte, hier die Spaltennamen zeigen (Tippfehler/Leerzeichen im Kopf erkennen).
  if (!deletion.deletionColumn) deletion.headers = headers;
  const issues = lrIssues_(rows, targets);
  const liveFrom = props.getProperty(LR_PREFIX_ + 'LIVE_FROM') || '';
  if (liveFrom && !lrDate_(liveFrom)) throw new Error('Invalid Lehrlinge LIVE_FROM date');
  const mode = liveFrom && today >= liveFrom ? 'live' : (props.getProperty(LR_PREFIX_ + 'MODE') || 'test');
  if (!['test', 'live'].includes(mode)) throw new Error('Invalid Lehrlinge reminder mode');
  const channels = lrChannels_(props);
  const copyPhone = String(props.getProperty(LR_PREFIX_ + 'COPY_PHONE') || '').trim();
  // Ohne SMS-Kanal werden weder Empfänger noch Tagesnummer gebraucht.
  const phones = !channels.sms ? [] : mode === 'test' ? ['+4368181289405'] : [...new Set([orderNotificationConfig_().notifyPhoneDay, copyPhone].filter(Boolean))];
  if (mode === 'live' && channels.sms && !orderNotificationConfig_().notifyPhoneDay) throw new Error('Day phone missing');
  return { today: today, slot: slot, mode: mode, channels: channels, deletion: deletion, phones: phones,
    whatsappTarget: channels.whatsapp ? lrWhatsAppTarget_(mode) : null, targets: targets, issues: issues,
    message: issues.length ? (mode === 'test' ? '[TEST] ' : '') + 'Lehrlinge:\n' + issues.join('\n') + '\nBitte Berichte ergänzen/korrigieren.' : '' };
}

function previewLehrlingeMorning() { const result = lrPreview_(new Date(), '09'); console.log(JSON.stringify(result)); return result; }
function previewLehrlingeAfternoon() { const result = lrPreview_(new Date(), '17'); console.log(JSON.stringify(result)); return result; }

function processLehrlingeReminders() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(LR_PREFIX_ + 'ENABLED') !== 'true') return;
  const now = new Date();
  const slot = Utilities.formatDate(now, LR_ZONE_, 'HH');
  if (!['09', '17'].includes(slot)) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    if (props.getProperty(LR_PREFIX_ + 'ENABLED') !== 'true') return;
    const result = lrPreview_(now, slot);
    if (!result.message) return;
    const errors = [];
    for (const phone of result.phones) {
    if (!phone) throw new Error('Day phone missing; no SMS sent');
    const key = LR_PREFIX_ + 'LAST_' + slot + '_' + phone.replace(/\D/g, '');
    const token = result.today + ':' + result.mode + ':' + phone;
    const previous = JSON.parse(props.getProperty(key) || '{}');
    if (previous.token === token) continue;
    const cfg = orderNotificationConfig_();
    if (!cfg.key || !cfg.secret) throw new Error('Zadarma not configured');
    // Persist before network call: an ambiguous timeout must not send duplicate SMS.
    props.setProperty(key, JSON.stringify({ token: token, status: 'attempting' }));
    try {
      // Suppress shared balance-warning SMS to other recipients during the test.
      const sent = sendZadarmaSms_(phone, result.message, result.mode === 'test');
      if (!sent || sent.skipped || sent.status !== 'success') throw new Error('SMS not confirmed');
      props.setProperty(key, JSON.stringify({ token: token, status: 'sent' }));
    } catch (err) {
      props.setProperty(key, JSON.stringify({ token: token, status: 'failed_or_unknown' }));
      errors.push(String(err.message || err));
    }
    }
    if (result.channels.whatsapp) {
      const waTarget = lrWhatsAppTarget_(result.mode);
      const waKey = LR_PREFIX_ + 'LAST_WA_' + slot;
      const waToken = result.today + ':' + result.mode;
      const waPrevious = JSON.parse(props.getProperty(waKey) || '{}');
      const attempts = waPrevious.token === waToken ? Number(waPrevious.attempts || 0) : 0;
      // Nur eine bestätigte Nichtzustellung ("failed") wird wiederholt (max. LR_WA_MAX_ATTEMPTS_ je Prüfzeit);
      // bei unklarem Ergebnis ("attempting"/"failed_or_unknown") keine automatische Wiederholung, sonst Doppelmeldungen.
      const blocked = waPrevious.token === waToken && (waPrevious.status !== 'failed' || attempts >= LR_WA_MAX_ATTEMPTS_);
      if (waTarget && !blocked) {
        props.setProperty(waKey, JSON.stringify({ token: waToken, status: 'attempting', attempts: attempts + 1 }));
        try {
          const sent = sendWhatsAppMessage_(waTarget, result.message);
          // sendWhatsAppMessage_ meldet fehlende Zugangsdaten als {ok:false, skipped:true}: das ist nicht gesendet.
          if (!sent || sent.skipped || sent.ok === false) {
            const notSent = new Error('whatsapp_not_sent');
            notSent.confirmed = true;
            throw notSent;
          }
          props.setProperty(waKey, JSON.stringify({ token: waToken, status: 'sent', attempts: attempts + 1 }));
        } catch (err) {
          const message = String(err.message || err);
          const confirmed = err.confirmed === true || /^whatsapp_http_/.test(message);
          props.setProperty(waKey, JSON.stringify({ token: waToken, status: confirmed ? 'failed' : 'failed_or_unknown', attempts: attempts + 1 }));
          errors.push('whatsapp:' + message);
        }
      }
    }
    if (errors.length) throw new Error(errors.join('; '));
  } finally { lock.releaseLock(); }
}

function setupLehrlingeReminderTest() {
  disableLehrlingeReminders();
  const props = PropertiesService.getScriptProperties();
  props.setProperty(LR_PREFIX_ + 'MODE', 'test');
  props.deleteProperty(LR_PREFIX_ + 'LIVE_FROM');
  ScriptApp.newTrigger('processLehrlingeReminders').timeBased().everyMinutes(5).create();
  props.setProperty(LR_PREFIX_ + 'ENABLED', 'true');
}

// WhatsApp-Gruppe statt SMS, sofort im Echtbetrieb (ohne [TEST]-Präfix).
// Rückweg: restoreLehrlingeSmsChannel() (SMS + WhatsApp) oder setupLehrlingeReminderTest() (Testmodus).
function setupLehrlingeWhatsAppLive() {
  const bot = mineevBotConfig_();
  if (!bot.url || !bot.token) throw new Error('mineev-bot not configured; WhatsApp channel unavailable');
  const props = PropertiesService.getScriptProperties();
  setupLehrlingeReminderTest(); // ein einziger Trigger, Modul eingeschaltet
  props.setProperty(LR_PREFIX_ + 'MODE', 'live');
  props.deleteProperty(LR_PREFIX_ + 'LIVE_FROM');
  props.setProperty(LR_PREFIX_ + 'CHANNELS', 'whatsapp');
  console.log('Lehrlinge: live, WhatsApp group only (no SMS, no [TEST])');
}

function restoreLehrlingeSmsChannel() {
  PropertiesService.getScriptProperties().setProperty(LR_PREFIX_ + 'CHANNELS', 'sms,whatsapp');
  console.log('Lehrlinge: channels = sms,whatsapp');
}

function setupLehrlingeWeekTrial() {
  const props = PropertiesService.getScriptProperties();
  if (!orderNotificationConfig_().notifyPhoneDay) throw new Error('Configure first day phone before scheduling rollout');
  setupLehrlingeReminderTest();
  props.setProperty(LR_PREFIX_ + 'COPY_PHONE', '+4368181289405');
  props.setProperty(LR_PREFIX_ + 'LIVE_FROM', lrOffset_(lrDate_(new Date()), 7));
  console.log('Lehrlinge: enabled; test until ' + props.getProperty(LR_PREFIX_ + 'LIVE_FROM') + '; then day phone + COPY_PHONE');
}

function disableLehrlingeReminders() {
  PropertiesService.getScriptProperties().setProperty(LR_PREFIX_ + 'ENABLED', 'false');
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'processLehrlingeReminders') ScriptApp.deleteTrigger(t);
  });
}
