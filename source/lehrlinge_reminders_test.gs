// Manual test only. Does not enable or change scheduled reminders.
function previewLehrlingeTestNow() {
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, LR_ZONE_, 'HH'));
  const date = hour < 9 ? lrOffset_(lrDate_(now), -1) : lrDate_(now);
  const slot = hour >= 9 && hour < 17 ? '09' : '17';
  const result = lrPreview_(new Date(date + 'T12:00:00Z'), slot);
  result.phones = ['+4368181289405'];
  result.mode = 'test';
  result.message = '[TEST] ' + (result.message ? result.message.replace(/^\[TEST\] /, '') : 'Lehrlinge: Keine Abweichungen für ' + date + ' (Prüfung ' + slot + ':00).');
  console.log(JSON.stringify(result));
  return result;
}

function sendLehrlingeTestNow() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another reminder is running');
  try {
    const result = previewLehrlingeTestNow();
    const props = PropertiesService.getScriptProperties();
    const key = LR_PREFIX_ + 'MANUAL_TEST_RFC1738';
    const token = result.today + ':' + result.slot;
    const previous = JSON.parse(props.getProperty(key) || '{}');
    if (previous.token === token) throw new Error('Manual test already attempted; check delivery before retrying');
    const cfg = orderNotificationConfig_();
    if (!cfg.key || !cfg.secret) throw new Error('Zadarma not configured');
    props.setProperty(key, JSON.stringify({ token: token, status: 'attempting' }));
    try {
      const sent = sendZadarmaSms_('+4368181289405', result.message, true);
      if (!sent || sent.skipped || sent.status !== 'success') throw new Error('SMS not confirmed');
      props.setProperty(key, JSON.stringify({ token: token, status: 'sent' }));
      console.log('Manual test SMS accepted by Zadarma');
    } catch (err) {
      props.setProperty(key, JSON.stringify({ token: token, status: 'failed_or_unknown' }));
      throw err;
    }
  } finally { lock.releaseLock(); }
}

// Manual test only: checks the mineev-bot WhatsApp wiring directly, independent
// of any missing-report state or the 09:00/17:00 schedule.
function sendWhatsAppTestNow() {
  const result = sendWhatsAppMessage_(LR_WHATSAPP_TEST_TARGET_, '[TEST] mineev-bot WhatsApp integration check');
  console.log(JSON.stringify(result));
  return result;
}
