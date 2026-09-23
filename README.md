# MurtalTaxi — TaxiApp

Praxisnahe Dokumentation für Entwickler:innen und Admins.
Frontend: statisches HTML/CSS/vanilla JS (kein Build-Schritt) · Backend: **ein** gemeinsames Google
Apps Script (GAS) Projekt für alle Module · Vercel als Hosting/Proxy/Cache-Schicht.

> Für eine KI-Session (Claude Code o. ä.), die schnell produktiv werden soll: siehe **`CLAUDE.md`** —
> dort stehen Deploy-Befehle, die exakte Live-Deployment-ID, Test-Kommandos und Architektur-Stichpunkte
> kompakt. Dieses README richtet sich an Menschen und geht mehr in die Tiefe.

## Inhalt

- [Überblick](#überblick)
- [Module / Projektstruktur](#module--projektstruktur)
- [Architektur](#architektur)
- [Setup – Schnellstart](#setup--schnellstart)
- [Google Apps Script (Backend)](#google-apps-script-backend)
- [Deploy](#deploy)
- [Benachrichtigungen (WhatsApp/SMS)](#benachrichtigungen-whatsappsms)
- [Redis-Fastpath (Vercel)](#redis-fastpath-vercel)
- [Testen](#testen)
- [Feature-Flags](#feature-flags)
- [Troubleshooting](#troubleshooting)
- [Sicherheit & Secrets](#sicherheit--secrets)
- [Lizenz](#lizenz)

## Überblick

Die App deckt den Betrieb eines Taxiunternehmens ab: Vorbestellungen aufnehmen und verwalten, den
Lehrlingsshuttle (Zellstoff Pöls) planen und den Fahrern anzeigen, Schichtabrechnungen der Fahrer
erfassen, Kundenchat/Feedback. Alles läuft ohne eigenen Server — Google Sheets ist die Datenbank, Google
Apps Script das Backend, Vercel liefert die statischen Seiten aus und stellt eine schnellere,
Redis-gestützte Zwischenschicht für die am meisten genutzten Lese-/Schreibpfade bereit.

## Module / Projektstruktur

| Pfad | Was | Live |
|---|---|---|
| `vorbestellungen.html`, `vorbestellungen-admin.html` | Taxi-Vorbestellungen: Bestellungen erfassen, „Nächste Fahrten“, Suche | `taxi-murtal.vercel.app` |
| `lehrlinge/` | Fahrer-App für den Zellstoff-Pöls-Lehrlingsshuttle (Fahrtenplan, Punkte je Route, Berichte) | `taxi-murtal.vercel.app/lehrlinge/` |
| `abrechnung/` | Schichtabrechnung der Fahrer (Umsatz/Ausgaben/Saldo, Monatsstatistik, Admin-Korrektur) | `taxi-murtal.vercel.app/abrechnung/` |
| `minicrm/`, `main/`, `sitecalc/` | kleinere Zusatzmodule (QR-Zahlung, Anleitung, Rechner) | `taxi-murtal.vercel.app/…` |
| `chat.html`, `feedback.html`, `hilfe.html` | Team-Chat, Kundenfeedback, Hilfeseite | `taxi-murtal.vercel.app` |
| `source/*.gs` | **das gemeinsame GAS-Backend** für alle Module oben — ein einziges Apps-Script-Projekt | Apps-Script-Editor |
| `api/*.js` | Vercel-Functions: `gas.js` (Proxy zu GAS), `orders.js` + `lehrlinge/*` (Redis-Fastpath + Write-Behind-Outbox vor GAS), `send.js` (Web-Push) | `taxi-murtal.vercel.app/api/*` |
| `tests/*.test.mjs` | Node-Testsuite (Parity-Tests gegen echten `.gs`-Quelltext) | — |
| `docs/*.md` | Feature-Dokus mit Rollout/Rollback | — |
| `student-portal/` | **eigenes Git-Repo** (`taxi-lehrlinge-portal`), hier nur lokal ausgecheckt — separat committen/pushen/deployen | `taxi-lehrlinge-portal.vercel.app` |

Alle Module unter `assets/css/theme-tokens.css` teilen sich Hell-/Dunkel-Farbtokens — eine Änderung dort
wirkt auf jedes Modul.

## Architektur

```
[Browser/PWA]
  └─ statisches HTML/CSS/JS (kein Build) ── Cache-Busting per ?v=YYYYMMDD-N in den <link>/<script>-Tags
        │
        ▼
  [Vercel: taxi-murtal.vercel.app]
    ├─ statisches Hosting aller Module oben
    ├─ /api/gas.js ──────────────► [Google Apps Script Web App] ──► [Google Sheet(s)] (Source of Truth)
    ├─ /api/orders.js ─┐                    ▲
    └─ /api/lehrlinge/* ┴─ Redis-Fastpath ───┘  (Snapshot lesen sofort, Schreiben per Write-Behind-Outbox
                                                  nachträglich in die Sheet einsortiert; bei jedem Problem
                                                  fällt der Client automatisch auf den GAS-Pfad zurück)
                                                       │
                                                       ▼
                                           [mineev-bot] (separates Repo/Server, WhatsApp via Baileys)
```

Wichtig: **das Sheet ist immer die Wahrheit.** Redis ist ein optionaler, per Script-Property/Env-Var
zuschaltbarer Fastpath für Geschwindigkeit — nie die einzige Kopie der Daten.

## Setup – Schnellstart

1. **Google Sheet** anlegen mit den Tabellen, die GAS beim ersten Aufruf selbst erstellt/ergänzt
   (`ensureHeaders_` in `source/code.gs`), u. a. `Orders` mit den Spalten:
   `id · created_at · date · time · type · duration_min · phone_raw · phone_norm · message · rrule ·
   until · series_id · gcal_event_id · status · status_comment · created_by_name · created_by_device ·
   confirmation_sent_at · reminder_sent_at`
   (`gcal_event_id` ist ein historisches Feld — die frühere Google-Calendar-Integration wurde entfernt,
   die Spalte bleibt aus Kompatibilität bestehen.)
2. **Google Apps Script**: Projekt mit den Dateien aus `source/*.gs` (per `clasp push`, siehe unten).
   Script Properties setzen (Project Settings → Script Properties) — welche genau, siehe
   [Benachrichtigungen](#benachrichtigungen-whatsappsms) und die jeweiligen `docs/*.md`.
3. **Web App veröffentlichen**: Deploy → Manage deployments → die bestehende Deployment-ID verwenden
   (nicht wahllos neue anlegen, siehe [Deploy](#deploy)). Execute as: *Me*, Access: *Anyone*.
4. **Vercel**: Projekt `taxi-murtal`, Root = dieses Repo. Env Vars nach Bedarf setzen (`ORDERS_REDIS`,
   `ORDERS_REDIS_WRITES`, `REDIS_URL`, `SYNC_SECRET`, `JWT_SECRET`, `GAS_URL`, …).
5. Die Web-App-URL aus Schritt 3 in `assets/js/config.js` (`GAS_URL`) eintragen — dieselbe ID wird auch
   in `abrechnung/app.js` referenziert.

## Google Apps Script (Backend)

Ein einziges Projekt (`.clasp.json` → `scriptId`, `rootDir: "source"`) bedient **alle** Module. Wichtige
Dateien:

- `code.gs` — zentraler Router (`doGet`/`doPost`), Bestellungen (CRUD, Status), Auth-Helfer, WhatsApp-/SMS-Versand.
- `order_shift_reminders.gs` — Schicht-Übersicht 06:00/18:00 (siehe `docs/order-notifications.md`).
- `lehrlinge_plan.gs`, `lehrlinge_sync.gs`, `lehrlinge_reminders*.gs`, `lehrlinge_shuttle_summary.gs`,
  `lehrlinge.gs.gs` — Fahrtenplan, Redis-Sync, Erinnerungen, WhatsApp-Zusammenfassung (siehe
  `docs/lehrlinge-shuttle-summary.md`).
- `orders_sync.gs` — Redis-Snapshot-Sync für Bestellungen (siehe `docs/orders-redis.md`).
- `qr.gs.gs` — QR-Zahlungen.
- `appsscript.json` — Manifest (Zeitzone `Europe/Berlin` für das Skript selbst; einzelne Module rechnen
  explizit mit `Europe/Vienna`, siehe Kommentare im jeweiligen `.gs`).

## Deploy

**Frontend + Vercel-Functions** (alles außer `source/*.gs`):
```
git push origin main
```
Vercel deployt automatisch (`taxi-murtal.vercel.app`). `student-portal/` ist ein eigenes Repo — dort
separat `git push`.

**GAS-Backend** — zwei Schritte, beide nötig:
```
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i <LIVE_DEPLOYMENT_ID> -d "<kurze Beschreibung>"
```
`clasp push` allein aktualisiert nur den HEAD-Stand im Editor — die **live** Web-App-URL hängt an einer
versionierten Deployment-ID, die sich davon nicht automatisch mitändert. Die aktuelle Live-ID steht in
`assets/js/config.js` (`GAS_URL`); `clasp deployments` listet daneben viele weitere, alte/fremde
Deployments — nicht verwechseln. Details und die exakte ID: `CLAUDE.md`.

**Cache-Busting:** CSS/JS werden mit `?v=YYYYMMDD-N` eingebunden. Beim Ändern einer solchen Datei die
Versionsnummer in der einbindenden `.html` mit hochzählen, sonst liefert Browser/CDN ggf. die alte
Version weiter aus.

## Benachrichtigungen (WhatsApp/SMS)

- **Einzel-Erinnerung** vor Abholung: per Script Property `ORDER_REMINDER_CHANNEL` umschaltbar zwischen
  `sms` (Zadarma, historischer Standard) und `whatsapp` (aktueller Produktivkanal). Details, Setup und
  Rollback: `docs/order-notifications.md`.
- **Schicht-Übersicht** 06:00/18:00 (offene Bestellungen der nächsten 12 Std.) und die
  **Lehrlinge-Fahrtenplan-Zusammenfassung** 03:00/12:00 laufen beide über WhatsApp, siehe
  `docs/order-notifications.md` bzw. `docs/lehrlinge-shuttle-summary.md`.
- WhatsApp-Versand läuft über den separaten Sibling-Dienst **`mineev-bot`** (eigenes Repo, Baileys-Bridge,
  nicht Teil dieses Repos) — GAS ruft ihn über `sendWhatsAppMessage_()` auf
  (Script Properties `MINEEV_BOT_URL` / `MINEEV_BOT_TOKEN`).
- Zadarma-SMS (Fallback/historisch): Script Properties `ZADARMA_API_KEY`, `ZADARMA_API_SECRET`,
  `SMS_NOTIFICATION_PHONE`, optional `PUBLIC_BASE_URL`. Fehlen sie oder ist Zadarma nicht erreichbar,
  läuft die Bestellung normal weiter — nur die SMS wird übersprungen. Guthaben-Warnung (< 3 €, < 1 €)
  läuft automatisch mit, Status in Script Properties gegen Doppel-Warnungen.

## Redis-Fastpath (Vercel)

Bestellungen und der Lehrlinge-Fahrtenplan haben optional eine Redis-Kopie vor GAS, um Lese-/Schreib­
latenz zu senken (GAS-Zugriffe dauern mehrere Sekunden). Prinzip: **aus, bis ein Env-Var/Script-Property
es explizit einschaltet**, jeder Fehler fällt auf den bisherigen GAS-Pfad zurück, das Sheet bleibt
führend. Details, Rollout-Reihenfolge und Rollback: **`docs/orders-redis.md`**.

## Testen

```
node --test tests/*.test.mjs
```
Ein großer Teil lädt den echten `.gs`-Quelltext per `node:vm` mit gemockten GAS-Globals
(`SpreadsheetApp`, `Utilities`, `PropertiesService`, …) — Business-Logik wird so ohne Deploy geprüft
("Parity-Tests"). Tests, die mit lokalen Datums-/Zeitstrings rechnen, setzen `process.env.TZ =
"Europe/Vienna"` am Dateianfang, passend zur tatsächlichen Laufzeitzone der betroffenen Module.

Für visuelle/DOM-Prüfungen eignet sich headless Chrome gegen einen lokalen `python3 -m http.server` mit
gemocktem `window.fetch` — siehe `CLAUDE.md` für Umgebungs-Eigenheiten (Fenstergrößen-Clamping,
`--user-data-dir` für persistenten `localStorage` zwischen mehreren Aufrufen).

## Feature-Flags

Neue Automatisierungen (Nachrichtenkanäle, Erinnerungen) starten **aus**. Muster:

- Ein Script Property wie `ORDER_SHIFT_ENABLED`, `LSS_ENABLED`, `ORDER_REMINDER_CHANNEL` schaltet das
  Feature scharf.
- Ein Funktionspaar `setupX()` / `disableX()` legt Trigger an bzw. entfernt sie und setzt das Property.
- Eine `sendXTestNow()`-Funktion schickt eine `[TEST]`-Nachricht nur an eine persönliche Testnummer,
  ohne echte Empfänger zu berühren — immer zuerst damit testen.

## Troubleshooting

- **403/401 vom GAS-Endpunkt**: Deployment-Berechtigungen prüfen (Execute as / Access), Secret in der
  Anfrage vs. Script Property vergleichen.
- **Änderung kommt nicht an, obwohl gepusht**: bei GAS fehlt oft der `clasp deploy -i …`-Schritt (siehe
  [Deploy](#deploy)); bei Frontend-Assets oft die Cache-Busting-Version nicht hochgezählt.
- **Redis/Vercel-Pfad zeigt falsche/alte Daten**: Client fällt bei jedem Fehler automatisch auf GAS
  zurück; einzelnes Gerät notfalls per `localStorage.setItem("mt_orders_redis","off")` (bzw. das
  Pendant für Lehrlinge) zwingen. Details: `docs/orders-redis.md`.
- **WhatsApp kommt nicht an**: `mineev-bot`-Erreichbarkeit prüfen (`MINEEV_BOT_URL`/`_TOKEN`), Journal
  in Apps Script (`safeNotificationLog_`-Einträge) ansehen.

## Sicherheit & Secrets

- Secrets liegen **nie** im Repo. `source/ssh_mineev.at.txt` (gitignored, Format `LABEL wert` pro Zeile)
  hält SSH-Zugang zum `mineev-bot`-Server sowie diverse Tokens.
- `.claspignore` schließt `*.txt`, `*.zip`, `*.pdf`, `.env*` u. Ä. aus — `clasp push` überschreibt/löscht
  in GAS liegende Secrets dadurch nie.
- Das im Frontend sichtbare `API_SECRET`/„secret“ ist **keine echte Zugriffskontrolle**, nur eine
  Markierung „das ist unser Client“ — PII (Telefon/Adresse) entsprechend behandeln, Sheet-Berechtigungen
  auf das Team beschränken.

## Lizenz

© 2025–2026 Aleksandr Mineev. Alle Rechte vorbehalten.

Dieses Projekt ("MurtalTaxi") ist eine proprietäre Entwicklung. Die Nutzung, Verteilung oder
Wiederverwendung des Codes ist ohne ausdrückliche schriftliche Genehmigung des Autors nicht gestattet.
