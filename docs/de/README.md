# Dokumentation

[English](../README.md) · [Deutsch](README.md) · [Projektstartseite](../../README.de.md)

Starte mit dem, was du erledigen möchtest. Du kannst direkt Arbeitszeit erfassen;
importierte Aktivitäten sind optionale Belege, die beim Erinnern an die Woche helfen.

## Wähle deinen nächsten Schritt

### 🚀 Installieren und selbst hosten

Starte deine eigene Instanz und bewahre ihre Daten sicher auf.

[Mit Docker Compose starten](docker.md#mit-compose-starten) ·
[Unraid einrichten](docker.md#unraid) ·
[Lokal mit Node.js starten](development.md#lokal-ausführen)

### 🔧 Deine Instanz betreiben

Prüfe ihren Status, aktualisiere das Image und halte eine wiederherstellbare Kopie deiner Daten bereit.

[Befehle im Alltag](docker.md#befehle-im-alltag) ·
[Image-Version wählen](docker.md#image-versionen) ·
[Aktualisieren oder Passwort ändern](docker.md#passwort-ändern-und-aktualisieren) ·
[Sichern und wiederherstellen](docker.md#backup-und-offline-wiederherstellung)

### 📅 Arbeitszeit erfassen und prüfen

Prüfe die Einstellungen, erfasse einen Arbeitstag und schließe fertige Wochen ab.

[Den ersten Tag erfassen](usage.md#einen-arbeitstag-erfassen) ·
[Wochen abschließen und Salden verstehen](usage.md#wochen-abschließen-und-salden-lesen) ·
[Stundenzettel exportieren](usage.md#stundenzettel-exportieren)

### ⚖️ Konto und Abwesenheiten verwalten

Starte ein laufendes Stundenkonto, erfasse Auszahlungen und Korrekturen und
kombiniere Urlaub, Freizeitausgleich und Krankheit mit den für dich geltenden Feiertagen.

[Stundenkonto einrichten](usage.md#stundenkonto) ·
[Abwesenheiten erfassen](usage.md#abwesenheiten) ·
[Feiertage einrichten](usage.md#feiertage) ·
[Feiertagsregeln und Geltungsbereich](../holiday-rules.md)

### 🔌 Aktivitätsimporte vorbereiten

Übernimm Kalender-, Slack- oder GitHub-Belege aus deinem eigenen Exporter in benannte Quellen.

[In der App importieren](usage.md#aktivitäten-importieren) ·
[JSON-/CSV-Format](import-format.md) ·
[Grenzen und Beispieldateien](import-format.md#grenzen-und-beispiele)

### 🛠️ Entwickeln und beitragen

Starte das Projekt, lerne seine Grenzen kennen und prüfe deine Änderungen.

[Entwicklungsumgebung und Prüfungen](development.md) ·
[Lokale Import-API](import-format.md#lokale-api) ·
[Beitragsbedingungen](../../CONTRIBUTING.md)

## Schnell Hilfe finden

- **Browseradresse abgewiesen?** Prüfe die [genau konfigurierte Origin](docker.md#mit-compose-starten).
- **Datenverzeichnis beim Start abgewiesen?** Prüfe [erlaubte Dateien und Rechte](docker.md#persistente-daten-und-rechte).
- **Kein bestätigter Kontostand?** Lege einen wirksamen [Anfangsbestand](usage.md#stundenkonto) fest.
- **Unerwartete Feiertags- oder Abwesenheitsgutschrift?** Prüfe die [Tagesreihenfolge](usage.md#abwesenheiten) und [Feiertagsausnahmen](usage.md#feiertage).
- **Stundenzettel leer?** Prüfe [Zeitraum, Abschlussfilter und optionalen Kontoteil](usage.md#stundenzettel-exportieren).
