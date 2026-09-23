# MurtalTaxi — Überblick für Claude Code

Mehrere statische Frontend-Module (HTML/CSS/vanilla JS) + **ein gemeinsames** Google Apps Script
(GAS) Backend + Vercel als Hosting/Proxy/Cache-Schicht. Kein Build-Schritt, keine Bundler — Dateien
werden 1:1 deployt.

## Projektstruktur

| Pfad | Was |
|---|---|
| `vorbestellungen.html`, `vorbestellungen-admin.html`, `assets/js/`, `assets/css/` | Haupt-App: Taxi-Vorbestellungen (Bestellungen, Nächste, Suche) |
| `lehrlinge/` | Fahrer-App für den Zellstoff-Pöls-Lehrlingsshuttle (Fahrtenplan, Punkte, Berichte) |
| `abrechnung/` | Schichtabrechnung für Fahrer (Umsatz/Ausgaben/Saldo) |
| `minicrm/`, `main/`, `sitecalc/` | weitere kleinere Module, teilen sich `assets/css/theme-tokens.css` |
| `source/*.gs` | **das gemeinsame GAS-Backend** — bedient ALLE Module oben (ein einziges Apps-Script-Projekt, `rootDir` laut `.clasp.json`) |
| `api/*.js` | Vercel-Serverless-Functions: `gas.js` (Proxy zu GAS), `orders.js`/`api/lehrlinge/*` (Redis-Fastpath + Write-Behind-Outbox vor GAS), `send.js` (Web-Push) |
| `tests/*.test.mjs` | Node-Testsuite, aktuell ~169 Tests |
| `docs/*.md` | Feature-Dokus mit Rollout/Rollback-Anleitung (siehe unten) |
| `student-portal/` | **eigenes Git-Repo** (`taxi-lehrlinge-portal`, eigene Remote), nur lokal hier ausgecheckt — NICHT Teil dieses Repos, eigenständig committen/pushen |

Alle Module unter `assets/css/theme-tokens.css` teilen sich die Farb-Tokens (hell/dunkel) — Änderungen
dort wirken auf jedes Modul, nicht nur auf eines.

## Deploy

**Frontend + Vercel-Functions (alles außer `source/*.gs`):**
```
git push origin main
```
Vercel deployt automatisch. Projekt `taxi-murtal`, Produktion: `https://taxi-murtal.vercel.app`
(bedient Haupt-App, `lehrlinge/`, `abrechnung/`, `minicrm/`, `main/`, `sitecalc/` — alles aus diesem Repo).
`student-portal/` (`taxi-lehrlinge-portal`) ist ein separates Vercel-Projekt mit eigenem Repo/Push.

**GAS-Backend (`source/*.gs`) — zwei Schritte, beide nötig:**
```
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i AKfycbwS88JTgj1NVqhGAaMKi3MXxTawF9zA6mkG6avgxmIj8c61_20EjNZdY0_0U6kKor29 -d "<kurze Beschreibung>"
```
- `clasp push` allein aktualisiert nur den HEAD-Stand im Editor — die **live** Web-App-URL (aus
  `assets/js/config.js` → `GAS_URL`, bzw. gleiche ID in `abrechnung/app.js`) hängt an einer
  **versionierten Deployment-ID**, die sich davon NICHT automatisch aktualisiert. Immer `clasp deploy -i
  <diese exakte ID>` danach ausführen, sonst ändert sich am Live-Verhalten nichts.
- Diese ID stammt aus `GAS_URL` in `assets/js/config.js` — nicht raten, dort nachsehen falls sie sich
  mal ändert. `clasp deployments` listet viele weitere (alte/fremde) Deployments — nur die eine oben
  verwenden.
- `.claspignore` schließt Secrets aus (`*.txt`, `*.zip`, `*.pdf`, `.env*`, `source/ssh_mineev.at.txt`) —
  `clasp push` ist dadurch gefahrlos, es überschreibt/löscht diese nie in GAS.

**Cache-Busting nicht vergessen:** CSS/JS werden mit `?v=YYYYMMDD-N` eingebunden (siehe `<link>`/`<script>`
in den `.html`-Dateien). Beim Ändern einer CSS/JS-Datei die Versionsnummer in der einbindenden HTML-Datei
mit hochzählen — sonst kann der Browser/CDN die alte Version weiter ausliefern (ist in dieser Session schon
mal passiert).

## Testen

```
node --test tests/*.test.mjs
```
Viele Tests laden den echten `.gs`-Quelltext per `node:vm` mit gemockten GAS-Globals (`SpreadsheetApp`,
`Utilities`, `PropertiesService`, …) — Business-Logik wird so ohne Deploy geprüft ("Parity-Tests").
`process.env.TZ = "Europe/Vienna"` steht am Dateianfang der Tests, die mit lokalen Datums-/Zeitstrings
rechnen — muss zur GAS-Zeitzone (`Europe/Vienna`, siehe `source/appsscript.json`) passen.

Für visuelle/DOM-Prüfungen: headless Chrome (`google-chrome --headless=new --disable-gpu --dump-dom`
bzw. `--screenshot`) gegen einen lokalen `python3 -m http.server`, mit `window.fetch` gemockt — siehe
Git-Historie für Beispiele. **Wichtig:** window-size unter ~500px wird von diesem headless-Chrome auf
500px geklemmt (Bug/Quirk dieser Umgebung); Höhe ebenfalls gedeckelt — bei Bedarf `--user-data-dir`
explizit setzen, wenn ein Test über mehrere Chrome-Aufrufe hinweg denselben `localStorage` braucht (ohne
das startet jeder Aufruf mit leerem Profil). Reale Bildschirm-Screenshots (`screencapture`, `open -a
Safari`) fangen den **echten Bildschirm** dieser Maschine ein, nicht nur die App — nur mit exakter
Fensterposition/-größe und `screencapture -R x,y,w,h` (Region), nie ohne Region/Fensterbezug.

## Architektur-Grundmuster

- **Sheet ist Source of Truth.** Vercel/Redis ist ein optionaler Fastpath davor (Lesen + Schreiben je
  eigener Feature-Flag), fällt bei jedem Problem auf GAS zurück. Details: `docs/orders-redis.md`.
- **Feature-Flags:** neue Nachrichten-/Automatisierungs-Features sind standardmäßig AUS (ein Script
  Property wie `ORDER_SHIFT_ENABLED`, `LSS_ENABLED`, …), mit `setupX()`/`disableX()`-Funktionspaar und
  einer `sendXTestNow()`-Funktion, die nur `[TEST]`-Nachrichten an eine persönliche Testnummer schickt.
- **WhatsApp-Versand** läuft über den separaten Sibling-Dienst `mineev-bot` (eigenes Repo, nicht hier) —
  GAS ruft ihn über `sendWhatsAppMessage_()` auf (`MINEEV_BOT_URL`/`MINEEV_BOT_TOKEN` Script Properties).
- **Secrets** liegen nie im Repo. `source/ssh_mineev.at.txt` (gitignored) hat SSH-Zugang zum
  `mineev-bot`-Server + diverse Tokens, Format `LABEL wert` pro Zeile. Nie Secret-Werte in den Chat
  ausgeben.

## Feature-Dokus (`docs/`)

- `order-notifications.md` — WhatsApp statt SMS für Bestell-Erinnerungen + Schicht-Übersicht 06:00/18:00
- `orders-redis.md` — Redis-Fastpath für Bestellungen (Rollout/Rollback, Sicherheitsprinzipien)
- `lehrlinge-shuttle-summary.md` — Fahrtenplan-Zusammenfassung per WhatsApp 03:00/12:00
