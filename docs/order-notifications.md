# Vorbestellungen: SMS → WhatsApp (Murtal Taxi) + Schicht-Übersicht

## Was sich ändert

1. **Erinnerung 10–15 Min. vor Abholung** (bisher SMS an Tag-/Nachtnummer) geht künftig als WhatsApp-Nachricht
   in die Gruppe **Murtal Taxi** (`436605703688-1417303237@g.us`). Text: `TaxiApp: HH:MM`, Notiz, `Tel: …`, `#<Nr.>`
   — gleiche Felder wie die alte SMS, nur mit `TaxiApp:`-Präfix statt Telefonnummer als Absender.
2. **Neu: Schicht-Übersicht** um **06:00** und **18:00** (Europe/Vienna) mit allen offenen Vorbestellungen der
   nächsten 12 Stunden, an dieselbe Gruppe.

Die Telefonnummern-SMS-Logik (Tag-/Nachtnummer, Admin-Seite `vorbestellungen-admin.html`) bleibt im Code erhalten,
wird aber nicht mehr aufgerufen, solange WhatsApp aktiv ist — einfacher Rollback über ein Script Property.

## Script Properties

| Property | Werte | Bedeutung |
|---|---|---|
| `ORDER_REMINDER_CHANNEL` | `sms` (Standard) \| `whatsapp` | Kanal der Einzel-Erinnerung. Erst nach einem Test umstellen. |
| `ORDER_WHATSAPP_GROUP_JID` | z. B. `…@g.us` | Überschreibt die Ziel-Gruppe (Standard: Murtal Taxi, fest im Code). Nur setzen, wenn eine andere Gruppe genutzt werden soll (z. B. zum Testen). |
| `ORDER_SHIFT_ENABLED` | `true`/`false` | Schicht-Übersicht ein/aus. Wird von `setupOrderShiftReminders()` gesetzt, nicht von Hand. |

`MINEEV_BOT_URL` / `MINEEV_BOT_TOKEN` sind bereits für Lehrlinge konfiguriert und werden hier mitverwendet.

## Einrichten (der Reihe nach)

1. `clasp push` + neue Deploy-Version (ändert `source/code.gs`, neu: `source/order_shift_reminders.gs`).
   Ohne Property-Änderungen läuft alles wie bisher (SMS, keine Schicht-Übersicht).
2. **Einzel-Erinnerung testen, ohne die Gruppe zu benachrichtigen:** in GAS `sendOrderReminderTestNow()`
   ausführen. Schickt `[TEST] TaxiApp: …` (nächste offene Bestellung oder ein Beispiel) **nur an die persönliche
   Nummer** (+43 681 81289405). Prüfen, ob Format und mineev-bot-Zustellung passen.
3. **Umschalten:** Script Property `ORDER_REMINDER_CHANNEL` = `whatsapp`. Ab dem nächsten 5-Minuten-Lauf von
   `processOrderNotifications` gehen neue Erinnerungen an die Gruppe. Bereits gesendete Erinnerungen (`reminder_sent_at`
   gesetzt) werden nicht wiederholt.
4. **Schicht-Übersicht testen:** `sendOrderShiftSummaryTestNow()` — schickt die aktuelle 12-Stunden-Liste mit
   `[TEST]`-Präfix nur an die persönliche Nummer. Optional `sendOrderShiftSummaryTestNow("06")` /
   `("18")` für das jeweils andere Fenster. `previewOrderShiftSummary(slot)` zeigt Text/Anzahl nur im Journal,
   ohne zu senden.
5. **Schicht-Übersicht einschalten:** `setupOrderShiftReminders()` ausführen. Legt einen 5-Minuten-Trigger an
   (sendet nur exakt in der Stunde 06 bzw. 18, höchstens einmal pro Fenster) und setzt `ORDER_SHIFT_ENABLED=true`.
   Erneuter Aufruf ist ungefährlich (kein doppelter Trigger).

## Ausschalten / Rollback

| Was | Wie |
|---|---|
| Nur Einzel-Erinnerung zurück auf SMS | Property `ORDER_REMINDER_CHANNEL` löschen oder auf `sms` setzen |
| Schicht-Übersicht aus | `disableOrderShiftReminders()` ausführen (Trigger weg, `ORDER_SHIFT_ENABLED=false`) |
| Andere Zielgruppe (z. B. Testgruppe) | Property `ORDER_WHATSAPP_GROUP_JID` setzen |
| Alles (Code) | `git revert` der Commits „Orders: WhatsApp reminders …“ |

## Verhalten der Schicht-Übersicht

- Format: `TaxiApp: Tagschicht 22.09. · 2 Fahrten:` bzw. `TaxiApp: Nachtschicht 23.09. · 1 Fahrt:`, dann eine
  Zeile je Fahrt (`HH:MM · Notiz · Tel: … · #Nr.`). Keine Uhrzeiten im Header (steckt schon im Schicht-Namen);
  bei der Nachtschicht ist das Datum das vom Schichtende (Folgetag-Morgen), da sie über Mitternacht geht.
- Fenster: 06:00 → 18:00 desselben Tages; 18:00 → 06:00 des Folgetages (Europe/Vienna).
- Enthält offene Bestellungen (`status` ≠ `cancelled`/`done`) mit Startzeit im Fenster, sortiert nach Uhrzeit.
- Ohne Fahrten im Fenster wird nichts an die Gruppe gesendet (wie bei den Lehrlinge-Erinnerungen) — intern wird
  das Fenster trotzdem als geprüft markiert (`skipped_empty`, kein Wiederholungsversuch). Der manuelle Test
  (`sendOrderShiftSummaryTestNow()`) zeigt „Keine Vorbestellungen in diesem Zeitraum.“ weiterhin an, damit man
  auch an fahrtenlosen Tagen prüfen kann, dass alles läuft.
- Wie bei den Lehrlinge-/SMS-Erinnerungen: pro Fenster höchstens ein Versuch, Status in
  `ORDER_SHIFT_LAST_06` / `ORDER_SHIFT_LAST_18` (`sent` / `failed_or_unknown`), kein automatischer Neuversuch
  bei unklarem Ergebnis (verhindert doppelte Nachrichten in der Gruppe).

## Test

```
node --test tests/order-whatsapp-reminder.test.mjs tests/order-shift-reminders.test.mjs
```
