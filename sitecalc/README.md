# 🚕 Taxi-Tarifrechner Steiermark (ab 2025)

Ein minimalistischer **JavaScript-Tarifrechner** für Taxiunternehmen in der Steiermark.  
Berechnet automatisch Tag- und Nacht/Feiertag-Tarife gemäß der offiziellen Tarifordnung ab 2025 — **ohne Button, live beim Tippen**.

---

## 💡 Funktionsweise

Der Rechner nutzt folgende Preisstruktur (gültig ab 2025):

| Zeitraum           | Grundtarif | 1–5 km    | > 5 km    | Zuschlag |
| ------------------ | ---------- | --------- | --------- | -------- |
| **Tag (6–20 Uhr)** | 5,00 €     | 2,90 €/km | 2,80 €/km | 2,70 €   |
| **Nacht/Feiertag** | 5,00 €     | 3,30 €/km | 2,80 €/km | 2,70 €   |

Zuschlag kann für:

- mehr als **4 Personen**
- **Schneeketten**
- **Transport von Sportgeräten**

aktiviert werden.

---

## ⚙️ Aufbau

Die Seite besteht nur aus **einer HTML-Datei** mit eingebettetem CSS + JavaScript.

### Hauptbestandteile

- `index.html` – zentrale Datei mit Layout, Stil und Berechnungslogik
- **Zentriertes Eingabefeld** für Entfernung (km)
- **Automatische Berechnung** beim Eintippen
- Anzeige von:
  - **Formel (Tag & Nacht)** mit den aktuellen Werten
  - **Ergebnisfeldern** für beide Tarife
  - optionalem **Zuschlag**

---

## 🧮 Beispielrechnung
# taxi-tarifrechner
