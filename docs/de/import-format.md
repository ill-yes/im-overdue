# Importformat für Aktivitäten (Version 1)

[English](../import-format.md) · [Deutsch](import-format.md) · [Startseite](../../README.de.md)

[Dokumentation](README.md) · [Verwendung](usage.md) · [Docker und Unraid](docker.md) · [Importformat](import-format.md) · [Entwicklung](development.md)

Diese Referenz hilft dir, Dateien für den Import vorzubereiten. Für den
Ablauf in der Oberfläche siehe [Verwendung](usage.md).

Importiere normalisierte Aktivitäten deiner eigenen Exporter. Die App liest
keine beliebigen nativen Slack-, GitHub- oder Kalenderexporte, verbindet sich
nicht mit deren APIs und speichert keine Zugangsdaten. Aktivitäten sind Belege;
nur manuell erfasste Einträge zählen als Arbeitszeit. Das technische Format
bleibt in beiden App-Sprachen gleich.

**Auf dieser Seite**

- [JSON](#json)
- [CSV](#csv)
- [Vorschau und Aktualisierung](#vorschau-und-aktualisierung)
- [Grenzen und Beispiele](#grenzen-und-beispiele)
- [Lokale API](#lokale-api)
- [Checkliste für Exporter](#checkliste-für-exporter)

## JSON

Nutze UTF-8 und ein Objekt mit `schemaVersion: 1` und einem Array `activities`:

```json
{
  "schemaVersion": 1,
  "activities": [
    {
      "source": "slack",
      "id": "workspace-id:channel-id:message-ts",
      "start": "2026-10-01T09:15:00+02:00",
      "end": null,
      "title": "Nachricht gesendet",
      "url": null
    }
  ]
}
```

| Feld | Bedeutung |
| --- | --- |
| `source` | `google_calendar`, `slack`, `github` oder `other` |
| `id` | Stabile ID, innerhalb der Quelle eindeutig |
| `start` | ISO-8601-Zeitstempel **mit Offset oder Z**, kein reines lokales Datum mit Uhrzeit |
| `end` | Optional/null; wenn vorhanden, strikt nach `start` |
| `title` | Nicht leerer Anzeigetext, kein HTML |
| `url` | Optional/null; nur vollständige HTTP-/HTTPS-URL |

IDs enthalten ihren Ursprung: Slack-Workspace + Kanal + Nachrichten-ID,
GitHub-Repository + Aktivitätstyp + ID oder Google-Kalender-ID + Event-ID.
Wiederkehrende Termine brauchen je Vorkommen eine eigene stabile ID.

Zeitstempel werden zu UTC normalisiert und in der eingestellten IANA-Zeitzone
angezeigt. Termine über Mitternacht erscheinen an den betroffenen Tagen.
Dein Exporter entscheidet, ob ein Ganztagstermin als zeitlich begrenzter Beleg
sinnvoll ist; automatisch Arbeitszeit wird er nie.

## CSV

Nutze UTF-8, Komma als Trenner und diese Kopfzeile:

```csv
source,id,start,end,title,url
slack,workspace:channel:001,2026-10-01T09:15:00+02:00,,Nachricht gesendet,
google_calendar,calendar:meeting:001,2026-10-01T10:00:00+02:00,2026-10-01T11:00:00+02:00,"Abstimmung, Team",
```

Leere optionale Felder bedeuten `null`. Werte mit Kommas, Zeilenumbrüchen oder
Anführungszeichen werden nach CSV-Regeln zitiert; ein Anführungszeichen im
zitierten Feld wird verdoppelt. CSV verwendet implizit Version 1.
Dieses Komma-Importformat unterscheidet sich vom Semikolonformat des
[Stundenzettelexports](usage.md#stundenzettel-exportieren).

## Vorschau und Aktualisierung

1. Wähle eine Datei oder füge Daten ein, analysiere sie und ordne jeden
   enthaltenen Quellentyp einer benannten Datenquelle zu. Prüfe danach die Vorschau.
2. Speichern ist atomar und verlangt ausdrückliche Bestätigung.
3. Bei vorhandenem `(dataSourceId, id)` bleiben identische Werte unverändert;
   abweichende Werte aktualisieren den Eintrag. In der Datei fehlende Aktivitäten bleiben erhalten.
4. Identische Duplikate in einer Datei werden zusammengefasst.
   Widersprüchliche Duplikate blockieren den gesamten Import.
5. Fehlerhafte Zeilen blockieren den gesamten Import; es gibt keinen stillen
   Teilimport. Eine Datenbankänderung nach der Vorschau verlangt eine neue Vorschau.

`source` in der Datei bleibt der technische Typ, nicht der frei vergebene Name.
Gemischte Dateien ordnen jeden enthaltenen Typ genau einer passenden Quelle zu.
Getrennte Slack-Quellen dürfen dieselben externen IDs enthalten. Namen sind keine
Schlüssel; ID-Präfixe bestimmen keine Zuordnung.

Ein gemischter Import speichert alle geänderten Quellen in einer Revision. Nur
Quellen mit neuen oder geänderten Belegen erhalten ein Paket. Dessen unveränderlicher
Snapshot enthält alle deduplizierten eingereichten Belege dieser Quelle, auch
unveränderte Zeilen. Ein vollständig unveränderter Import erzeugt weder Paket noch
Schreibvorgang oder neue Revision und erhält Rückgängig.

## Grenzen und Beispiele

Grenzen: **5 MiB Rohdaten** und **20.000 Zeilen pro Import**. Teile große
Historien in mehrere Dateien und importiere sie nacheinander.

[examples/activities.json](../../examples/activities.json) und
[examples/activities.csv](../../examples/activities.csv) enthalten dieselben 13
**synthetischen** Aktivitäten für 28. September–4. Oktober 2026. Beide
nacheinander zu importieren erzeugt keine doppelten Belege. Die App lädt sie
niemals automatisch.

## Lokale API

Dateiformat und `schemaVersion: 1` bleiben unverändert. Die HTTP-Hülle für
`POST /api/import/analyze`, `/api/import/preview` und `/api/import/commit` lautet:

```json
{
  "format": "json",
  "text": "{\"schemaVersion\":1,\"activities\":[]}",
  "assignments": { "slack": "ID-der-eingerichteten-Slack-Quelle" },
  "fileName": "slack-export.json"
}
```

Die Analyse benötigt nur `format` und `text`; sie schreibt nichts. Die Vorschau
liefert `revision`, die der Commit als `expectedRevision` übernehmen muss.
Explizite Zuordnungen müssen jeden enthaltenen Typ einer bestehenden Quelle
desselben Typs zuweisen. Der optionale Dateiname verwendet sonst die lokalisierte
Bezeichnung für eingefügte Daten.

Alte Aufrufe ohne Zuordnung nutzen je Typ eine eindeutig vorhandene Quelle oder
eine Standardquelle; mehrere passende Quellen verlangen eine explizite Auswahl.
Vorschauen erstellen keine Quellen. Nötige Standardquellen entstehen erst im
erfolgreichen Commit.

`POST /api/data-sources` legt Quellen mit `type`, `name` und `expectedRevision` an.
`PUT /api/data-sources/:id` ändert nur den Namen; `DELETE /api/data-sources/:id`
entfernt Quelle, Belege und Pakete. Beide verlangen ebenfalls `expectedRevision`.
AppState enthält `dataSources` samt Anzahl und Zeitraum; Aktivitäten tragen
zusätzlich `dataSourceId`.

`GET /api/data-sources/:id/activities`, `/api/data-sources/:id/packages` und
`GET /api/import-packages/:id` liefern Seiten mit 50 Einträgen. `page` beginnt
bei null; `q` sucht nach Titel/ID/URL beziehungsweise Dateiname. Host-/Origin-
und Sitzungsschutz gelten unverändert. Paketinhalte liegen nicht in AppState.

## Checkliste für Exporter

- Exportiere nur die gewünschten Aktionen des Nutzers, etwa gesendete statt
  empfangene Nachrichten. Die App prüft keine Dienstnutzer-Identitäten.
- Lasse Tokens, Zugangsdaten und unnötige Nachrichtenvolltexte weg.
- Belege erhalten sekundengenaue Zeitstempel. Manuelle Zeiterfassung und Salden
  leiten keine ununterbrochene Arbeit zwischen Belegen ab.
- Wandle Abstände zwischen Aktivitäten niemals automatisch in Arbeit um.

## Weiterführende Schritte

- [Aktivitäten in der App importieren](usage.md#aktivitäten-importieren)
- [Die App lokal ausführen und prüfen](development.md)
- [Gesamte Dokumentation ansehen](README.md)
