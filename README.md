MurtalTaxi – TaxiApp (Vorbestellung)

Kurze, praxisnahe Dokumentation für Entwickler:innen und Admins.
Frontend: statisches HTML/CSS/JS · Backend: Google Apps Script (GAS) + Google Calendar + Google Sheets.

Inhalt

Überblick

Features

Projektstruktur

Setup – Schnellstart

Konfiguration

Google Apps Script (Backend)

API-Endpunkte

Kalender-Integration

UI-Hinweise

Troubleshooting

Sicherheit & Datenschutz

Lizenz

Überblick

Die App erleichtert die Aufnahme und Verwaltung von Taxi-Bestellungen.
Sie speichert Aufträge in Google Sheets, erstellt/entfernt Termine im gemeinsamen Google-Kalender und stellt dem Team eine schnelle Suche sowie „Nächste Fahrten“ bereit.

Features

Neue Bestellung mit Datum/Uhrzeit, Fahrtart (Orts/KT), Dauer, Telefon, Notiz.

Responsive UI mit Tabs (mobil: aside/main als Icons).

Schnellsuche (Telefon, Notiz, Typ).

Nächste Fahrten (12h / 24h / 1W).

Suche nach Datum (mit/ohne gefilterte Status).

Wiederholen („Wie beim letzten Mal“ / Kopieren).

Statuswechsel: done/cancelled → Event im Kalender wird automatisch gelöscht.

Kalender-Link im Footer (Intent-Link für Android-Unterstützung).

Projektstruktur
.
├── index.html
├── hilfe.html
├── assets/
│ ├── css/
│ │ ├── global.css
│ │ ├── header.css
│ │ ├── main.css
│ │ ├── footer.css
│ │ └── responsive.css
│ ├── js/
│ │ ├── config.js # export const API = '...GAS_WEB_APP_URL...'
│ │ ├── api.js
│ │ ├── theme.js
│ │ ├── main.js
│ │ ├── ui/
│ │ │ ├── todoList.js
│ │ │ ├── ordersList.js
│ │ │ └── dialog.js # modaler Dialog für Storno-Grund (optional)
│ └── img/ & favicon/
└── Code.gs # Google Apps Script (Server)

Setup – Schnellstart

Google Sheet

Erstelle eine Tabelle mit Sheet-Name Orders und folgenden Spalten (Zeile 1):

id | created_at | date | time | type | duration_min | phone_raw | phone_norm | message | rrule | until | gcal_event_id | status | status_comment

Google Calendar

Lege einen Teamkalender an oder verwende einen bestehenden.

ID des Kalenders in Code.gs → CALENDAR_ID eintragen.

Google Apps Script

Öffne Apps Script, füge Code.gs ein.

Advanced Service „Calendar“ aktivieren (Services → Google Calendar API).

Web App veröffentlichen: Deploy → New deployment → Web app

Execute as: Me

Who has access: Anyone with the link (oder eingeschränkt – dann Proxy nutzen).

Die Web App URL in assets/js/config.js als API eintragen.

Frontend

Lokal oder auf beliebigem Static Hosting deployen (GitHub Pages, Netlify, Vercel, Nginx, …).

Konfiguration
// assets/js/config.js
export const API = "https://script.google.com/macros/s/.../exec"; // GAS Web App URL

Optional: Umgebungsvarianten (dev/prod) per zwei Configs und einfacher Umschaltung.

Google Apps Script (Backend)

Wichtige Konstanten in Code.gs:

const SHEET_NAME = 'Orders';
const CALENDAR_ID = '...@group.calendar.google.com';

Erstellen von Events: Beim Speichern wird ein Kalendereintrag mit lokaler Zeitzone Europe/Vienna angelegt (Start/Ende + timeZone gesetzt).
Löschen von Events: Bei status = cancelled oder done wird der Termin aus dem Kalender entfernt und gcal_event_id geleert.

Hinweis: Auf Smartphones erfolgt die Kalender-Synchronisation mit Verzögerung (Sekunden bis Minuten), im Web meist sofort.

API-Endpunkte

Alle via GET (für Simplicity), JSON-Ergebnisse mit { ok: true, ... } oder { ok: false, error }.

Action Params Beschreibung
create data (JSON: date, time, type, duration_min, phone, message, rrule?, until?) Erstellt Bestellung + Kalender-Event
updatestatus id, status (done | cancelled), comment? Setzt Status; bei done/cancelled Event löschen
ordersbydate date (ISO), includeAll (1|0) Bestellungen eines Tages
todos hours (z. B. 12, 24, 168) Nächste Fahrten (aus Kalender, gemappt auf Sheet)
search q, limit? Volltextsuche (Telefon, Notiz, Typ)

Frontend-Wrapper: assets/js/api.js.

Kalender-Integration
Anlegen

Beim Speichern einer Bestellung erzeugt Code.gs ein Event in CALENDAR_ID und schreibt dessen id in gcal_event_id.

Löschen

Bei updatestatus(id, 'done'/'cancelled') löscht Code.gs das Event per Calendar.Events.remove(CALENDAR_ID, gcal_event_id) und leert die Spalte gcal_event_id.

Hinzufügen (Nutzer)

Android: Footer → Kalender → Google Calendar App → Abonnieren.

iPhone: Footer → Kalender → in Safari Abonnieren oder „In Google Kalender öffnen“.

Desktop: Link öffnet Google Kalender (Web) und fügt den Kalender hinzu.

Temporär ein-/ausblenden

Android: Google Kalender → ☰ → Einstellungen → Konto → Kalender → Sichtbar/Synchronisieren.

iPhone (Google Kalender): ☰ → Settings → Kalender sichtbar/unsichtbar.

iPhone (Apple Kalender): App Kalender → unten „Kalender“ → Häkchen setzen/entfernen.

Desktop: Links in der Kalenderliste an-/abwählen.

Synchronisation (Wichtig)

Auf Smartphones aktualisiert sich der Kalender nicht sofort, sondern mit kleiner Verzögerung (typ. Sekunden bis wenige Minuten).

Web (calendar.google.com) zeigt Änderungen i. d. R. unmittelbar.

UI-Hinweise

Button-Loader beim Speichern (.icon-btn--primary.loading) → klares Feedback.

Weiche Entfernung von Karten (fade/translate) nach Statuswechsel in todoList.js und ordersList.js.

Storno-Dialog: assets/js/ui/dialog.js – stilvoll, Grund optional.

Troubleshooting

Event im Handy-Kalender fehlt

In der App herunterziehen (Refresh).

Kalender sichtbar und Synchronisieren aktiv?

Android: App-Einstellungen → Kalender → Cache leeren.

Zeitformat korrekt? Backend nutzt Europe/Vienna + timeZone-Feld.

Duplikate

Achte darauf, gcal_event_id pro Bestellung nur einmal zu setzen.

Wiederholte Speicherung ohne neue Bestellung vermeiden.

403/401

GAS Deployment-Berechtigungen prüfen; ggf. Zugriff einschränken und Proxy verwenden.

Sicherheit & Datenschutz

PII (Telefon/Adresse) nur für Auftragsabwicklung verwenden.

Web-App-Zugriff ggf. nur für authentifizierte Accounts öffnen.

API nicht öffentlich verlinken; Rate-Limits/Token in Erwägung ziehen.

Google Sheet-Berechtigungen auf Team einschränken.

## Lizenz

© 2025 Aleksandr Mineev. Alle Rechte vorbehalten.

Dieses Projekt ("MurtalTaxi") ist eine proprietäre Entwicklung.
Die Nutzung, Verteilung oder Wiederverwendung des Codes ist ohne ausdrückliche
schriftliche Genehmigung des Autors nicht gestattet.
# taxi-vorbestellungen
# taxi-vorbestellungen
# taxi-vorbestellungen
