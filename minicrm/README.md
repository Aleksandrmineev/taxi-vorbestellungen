Beschreibung

Ein leichtes, lokales Web-Tool zur Unterstützung eines Taxi-Disponenten (oder Fahrers),
der Anrufe entgegennimmt und häufige Kunden schneller zuordnen möchte.

Während eines Telefonats kann der Disponent:

ein paar Ziffern der Telefonnummer eingeben,

den zuletzt gespeicherten Auftrag finden,

per Klick den Telefon- und Adress-Text in die Zwischenablage kopieren
(um ihn direkt im WhatsApp- oder Telegram-Chat an Fahrer zu senden),

bei Bedarf einen neuen Auftrag hinzufügen,
der im Browser gespeichert bleibt.

✳️ Hauptfunktionen

🔍 Sofortsuche nach Teilnummern (z. B. „6601“ findet „+43 660 123 4567“)

✨ Hervorhebung der gefundenen Ziffern im Ergebnis

📋 Ein-Klick-Kopie („+43 660 123 4567 Bahnhof Knittelfeld“)

💾 Letzte Suchanfragen (automatisch gespeichert, klickbar)

➕ Neuer Auftrag über ein modales Formular (lokal gespeichert im Browser)

⚙️ Offline-fähig, läuft komplett lokal mit index.html + data.json

🎯 Mobile-optimiert (große Bedienelemente, numerische Tastatur)

💡 Automatischer Fokus beim Öffnen der Seite

📁 Struktur
project/
│
├── index.html → Haupt-Anwendung (JS, CSS inline)
├── data.json → Auftragsdaten (WhatsApp-Parser-Ergebnis)
├── parse_whatsapp.py → Parser für exportierte WhatsApp-Chats
├── stopnames.json → Wörterbuch zum Bereinigen von Namen u. Füllwörtern
└── README.md → Projektbeschreibung

🚀 Verwendung

data.json aus WhatsApp-Chat generieren (mit parse_whatsapp.py)

index.html + data.json in einen beliebigen Ordner oder auf Webserver legen
(z. B. https://taxi-suche.de/lookup)

Seite öffnen → Eingabe von 3–4 Ziffern → Klick → Adresse kopieren.

🔧 Zukünftige Erweiterungen

Synchronisation mit Google Sheets oder Supabase

Automatisches Laden neuer Chat-Daten

Integration mit WhatsApp API / Telegram-Bot

Karten-Button (Google Maps Route)

Zentrale Datenhaltung für mehrere Dispatcher

👨‍💻 Entwickler

Erstellt von Aleksandr Mineev, 2025
Verwendung und Anpassung für betriebsinterne Zwecke erlaubt.
