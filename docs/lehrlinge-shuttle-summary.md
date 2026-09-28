# Zellstoff Pöls Shuttle: Fahrtenplan per WhatsApp (20:00 / 11:00)

Sendet um **20:00** (Hinfahrt des nächsten Tages) und **11:00** (Rückfahrt heute), Europe/Vienna, die zu diesem Zeitpunkt endgültige
Liste des Lehrlinge-Fahrtenplans an die WhatsApp-Gruppe **Pöls Lehrlinge-wer fährt?**
(`436506367662-1552028657@g.us`, dieselbe Gruppe wie die Lehrlinge-Berichtserinnerungen; bis 23.09.2026:
Zellstoff Pöls Shuttle `436506367662-1535622857@g.us`). Diese Uhrzeiten sind genau die Änderungsfristen im Portal
(Hinfahrt bis 20:00 am Vortag, Rückfahrt bis 11:00 — `lehrlingeCutoffOpen_` in `lehrlinge_plan.gs`), die Liste kann sich
danach also nicht mehr ändern. Bis 28.09.2026 galten 03:00 / 12:00 am Fahrtag. Freitag 20:00 (Samstag) und
Samstag 20:00 (Sonntag) gehen leer aus; die Montagsliste kommt Sonntag um 20:00.

## Format

Route für Route, nur Vor- und Nachnamen (keine Adressen), eine Zeile je Lehrling, in Fahrtreihenfolge
(Reihenfolge der Haltepunkte auf der Fahrtenplan-Seite):

```
TaxiApp: Fahrtenplan Zellstoff Pöls — Hinfahrt 22.09. · 7 Lehrlinge

Route 1 (4):
Anna Muster
Ben B
Cara C
Dan D

Route 2 (3):
Eve E
Frank F
Gerda G
```

Keine Absagen-Zeile (seit 23.09.2026) — nur wer fährt. Eine Route ohne Fahrten wird nicht mit ausgegeben
(z. B. Route 2 fährt an diesem Tag nicht); fährt an dem Tag niemand, wird nichts gesendet.

## Änderungen im Anhang (20:00 und 11:00)

An jede Nachricht (20:00 und 11:00) wird „Änderungen seit …“ aus dem Änderungsprotokoll angehängt (seit der
letzten gesendeten Nachricht, Wochenende sammelt sich bis Sonntagabend; ohne neue Änderungen kein Block). Details: `docs/lehrlinge-log.md`.
Abschalten: `LSS_CHANGES_ENABLED = false`.

## An schulfreien Tagen (Wochenende, Ferien, Feiertag)

Keine Nachricht — anders als bei den Bestellungs-Schichtübersichten wird hier **nicht** trotzdem eine
„keine Fahrten"-Meldung gesendet, um die Gruppe nicht jedes Wochenende unnötig zu benachrichtigen. Intern wird
das Fenster trotzdem als geprüft markiert (kein Wiederholungsversuch).

## Script Properties

| Property | Werte | Bedeutung |
|---|---|---|
| `LSS_ENABLED` | `true`/`false` | Ein/Aus. Wird von `setupLehrlingeShuttleSummary()` gesetzt, nicht von Hand. |
| `LSS_WHATSAPP_GROUP_JID` | z. B. `…@g.us` | Überschreibt die Zielgruppe (Standard: Pöls Lehrlinge-wer fährt?, fest im Code) — z. B. zum Testen mit einer eigenen Gruppe. |

## Einrichten

1. `clasp push` + neue Deploy-Version (neu: `source/lehrlinge_shuttle_summary.gs`). Ohne weitere Schritte ändert
   sich nichts — die Nachricht ist aus.
2. **Testen, ohne die Gruppe zu benachrichtigen:** `sendLehrlingeShuttleSummaryTestNow()` (oder mit `"20"`/`"11"`
   als Argument für das jeweils andere Fenster) — schickt `[TEST] …` nur an die persönliche Nummer
   (+43 681 81289405), auch wenn gerade nichts geplant ist (zeigt dann „Keine Fahrten geplant.").
   `previewLehrlingeShuttleSummary(slot)` zeigt Text/Anzahl nur im Journal, ohne zu senden.
3. **Einschalten:** `setupLehrlingeShuttleSummary()` ausführen. Legt einen 5-Minuten-Trigger an (sendet nur
   exakt in der Stunde 03 bzw. 12, höchstens einmal pro Fenster) und setzt `LSS_ENABLED=true`. Erneuter Aufruf
   ist ungefährlich (kein doppelter Trigger).

## Ausschalten / Rollback

- `disableLehrlingeShuttleSummary()` — Trigger weg, `LSS_ENABLED=false`.
- Andere Zielgruppe (z. B. zum Testen): Property `LSS_WHATSAPP_GROUP_JID` setzen.
- Alles (Code): `git revert` des Commits „Lehrlinge: shuttle Fahrtenplan summary …“.

## Status prüfen

Script Properties `LSS_LAST_03` / `LSS_LAST_12`: `{"token":"<Datum>:<Stunde>","status":"sent"|"skipped_empty"|"failed_or_unknown"}`.

## Test

```
node --test tests/lehrlinge-shuttle-summary.test.mjs tests/lehrlinge-shuttle-summary-real-shape.test.mjs
```
