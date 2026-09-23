# Lehrlinge: Änderungsprotokoll des Fahrtenplans

Seit 23.09.2026. Jede **echte** Änderung am Fahrtenplan (alter Status ≠ neuer Status), egal über welchen Weg,
landet als Zeile im Sheet **`_LehrlingeLog`**. Code: `source/lehrlinge_log.gs`, Aufruf aus
`saveLehrlingePlan_` (`source/lehrlinge_plan.gs`), durch den alle Wege laufen:

| Weg | `channel` | `actor` |
|---|---|---|
| Lehrling mit eigenem Konto (Portal, GAS direkt) | `student` | Lehrling-ID |
| Gemeinsames Konto `lehrlinge` (Portal → Vercel-Outbox → GAS) | `shared` | `portal:lehrlinge` |
| Fahrer (driver-plan / driver-student → Vercel-Outbox → GAS) | `driver` | `driver:<Taxinummer>` |
| Admin-Seite `lehrlinge/admin.html` | `admin` | `admin` |

Zusätzlich: jeder Login eines Lehrlings mit eigener PIN (`event = login`).
**Nicht** erfasst: manuelle Änderungen direkt im Sheet, Berichte (`Submissions`).
Zeitstempel = Zeitpunkt, an dem die Änderung im Sheet ankommt (bei der Vercel-Outbox Sekunden später).
Ein Fehler beim Protokollieren bricht das Speichern nie ab.

Spalten: `at, event, channel, actor, student_id, date, from, to` (Status: `both`/`out`/`back`/`none`).
Status vor einer Änderung wird wie im Fahrtenplan berechnet: keine Zeile = `both`, an Ferientagen `none`.

## Wo sichtbar

- **`lehrlinge/driver-plan.html`** (nur Fahrer): Uhr-Symbol neben dem Stift → Popup mit allen Einträgen,
  Filter Alle/Lehrlinge/Fahrer/Büro und nach Lehrling. Handy: Karten, breit: Tabelle.
  Daten: `GET /api/lehrlinge/plan-log` → GAS `lehrlinge_log` (vertrauenswürdig mit `SYNC_SECRET`).
- **Kontoübersicht** („Noch nie eingeloggt“ / „Kein eigenes Konto“ / „Nutzt eigenes Konto“) im selben Popup,
  aber nur für Taxinummern in der Script Property **`LEHRLINGE_LOG_ACCOUNTS_TAXIS`** (z. B. `12` oder `12,7`).
  Leer/nicht gesetzt = für niemanden sichtbar.
- **Student-Portal** (eigenes Repo `student-portal/`): Block „Änderungen“ unter „Route & Hinweise“ — nur der
  eigene Plan, ohne Taxinummern (nur „Fahrer“/„Büro“). Eigenes Konto: GAS `fn=student_plan_log`;
  gemeinsames Konto: `plan-log?studentId=` (GAS erzwingt die Einschränkung selbst).
- **WhatsApp**: an die 03:00-Nachricht (Fahrtenplan Hinfahrt, Gruppe „Pöls Lehrlinge-wer fährt?“) wird
  „Änderungen seit …“ angehängt — alles seit der letzten gesendeten 03:00-Nachricht (max. 7 Tage), netto je
  Lehrling und Tag, gleiche Änderung von Fahrer/Büro für ≥ 4 Lehrlinge als eine Sammelzeile, max. 25 Zeilen.
  Keine Änderungen → kein Abschnitt. Abschalten: Script Property `LSS_CHANGES_ENABLED = false`.
- **Editor**: `previewLehrlingeLog()` schreibt Kontostatus + letzte 30 Einträge ins Journal.
- **Server/Wartung**: GAS `lehrlinge_accounts` mit `serverKey = SYNC_SECRET` liefert den Kontostatus als JSON.

## Kontostatus

- `no_pin`: keine PIN in `_Lehrlinge` → kein eigenes Konto.
- `never`: PIN gesetzt, aber nie eingeloggt.
- `active`: Login im Protokoll **oder** gespeichertes „angemeldet bleiben“-Token (Script Property
  `lehrlinge_remember_token:<id>`; Loginzeit = `expiresAt` − 365 Tage, so sind auch Logins vor dem
  Protokoll sichtbar) **oder** eine eigene Änderung.

## Aufbewahrung

Vormonat + laufender Monat. Ältere Zeilen löscht der 03:00-Lauf (`llPrune_`), praktisch einmal im Monat.

## Rollback

- WhatsApp-Abschnitt aus: `LSS_CHANGES_ENABLED = false`.
- Protokoll komplett: Aufruf von `llRecordPlanChanges_`/`llRecordLogin_` in `lehrlinge_plan.gs` entfernen
  (per `typeof`-Prüfung abgesichert: `lehrlinge_log.gs` löschen genügt ebenfalls). Das Sheet kann bleiben.
