# Entwicklung

[English](../development.md) · [Deutsch](development.md) · [Startseite](../../README.de.md)

[Dokumentation](README.md) · [Verwendung](usage.md) · [Docker und Unraid](docker.md) · [Importformat](import-format.md) · [Entwicklung](development.md)

Hier findest du den lokalen Einstieg, Konfiguration und Prüfungen für
I'm Overdue. Die Architekturhinweise folgen nach den ausführbaren Schritten.

**Auf dieser Seite**

- [Lokal ausführen](#lokal-ausführen)
- [Prüfungen](#prüfungen)
- [Lokalisierung prüfen](#lokalisierung-prüfen)
- [Container-Images veröffentlichen](#container-images-veröffentlichen)
- [Architektur und Wartung](#architektur-und-wartung)

## Lokal ausführen

Nutze Node.js 24 oder neuer und npm. Der Container verwendet die Node-24-Reihe;
`.nvmrc` wählt sie für nvm und kompatible Versionsmanager, und npm verweigert die
Installation mit älteren Versionen.

```sh
npm ci
npm run dev
```

Öffne `http://127.0.0.1:4317`. Ein Server liefert Oberfläche und API;
ein zusätzlicher Frontend-Server ist nicht nötig. Standard ist Loopback ohne
Anmeldung. Für einen Produktionsbuild:

```sh
npm run build
npm start
```

| Variable | Lokales Verhalten |
| --- | --- |
| `PORT` | HTTP-Port, Standard `4317` |
| `HOST` | Standard `127.0.0.1`; `0.0.0.0` erlaubt Netzwerkzugriff |
| `IM_OVERDUE_DB` | SQLite-Pfad, Standard `data/im-overdue.sqlite` |
| `IM_OVERDUE_ORIGIN` | Genauer HTTP(S)-Browser-Origin, für Netzwerkbetrieb erforderlich |
| `IM_OVERDUE_PASSWORD` | Im Netzwerkbetrieb erforderlich; 12–256 Zeichen, höchstens 1024 UTF-8-Bytes |

Unvollständige Netzwerkkonfiguration scheitert vor dem Datenbankstart.
Weitergeleiteten Headern wird nicht vertraut. Die [Docker-Anleitung](docker.md)
erklärt Origin und HTTPS. Starte niemals zwei Prozesse mit derselben Datenbank.
Datenbank, WAL/SHM, Backups, `.env` und generierte Ausgaben gehören nicht in Git.

## Prüfungen

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Die Browser-Suite prüft die gebaute App. Tests nutzen isolierte temporäre
Datenbanken und nicht `data/im-overdue.sqlite`. Browserberichte und Screenshots
liegen im ignorierten `test-results/`. Installiere für Containerprüfungen Docker
und OpenSSL und führe aus:

```sh
docker build -t im-overdue:test .
npm run test:container -- im-overdue:test
```

CI prüft App, XML/Compose und Container je Architektur. Die Image-Veröffentlichung
hat einen eigenen manuellen Workflow mit Lizenz-, Versions- und Main-Branch-Prüfung.
Siehe [Container-Images veröffentlichen](#container-images-veröffentlichen).

## Lokalisierung prüfen

`npx vitest run tests/i18n.test.ts` prüft beide Katalogeinträge, gleiche
Platzhalter, Englisch als Standard und den Umgang mit gesperrtem Browserspeicher.
Technische Werte und Benutzertexte bleiben bei neuen Übersetzungen unverändert.

Bestehende deutsche Browserregressionen setzen ihre Sprache ausdrücklich über
`tests/e2e/language-fixture.ts`. Neue Standardsprachfälle starten ohne gespeicherte
Auswahl (`appLanguage: null`). `tests/e2e/i18n.spec.ts` prüft auch Englisch als
Standard bei deutscher Browsersprache, Speicherung, direkten Sprachwechsel und
Exportdarstellung. Führe vor `npx playwright test tests/e2e/i18n.spec.ts` zuerst
`npm run build` aus. Berücksichtige bei geänderten Beschriftungen oder zugänglichen
Namen beide Sprachen.

## Container-Images veröffentlichen

Veröffentlichung ist nur manuell möglich. Prüfe die Lizenzbedingungen und die
[erforderlichen Hinweise](../../NOTICE). Erhöhe vor der Veröffentlichung bei
Bedarf `version` in `package.json` auf eine stabile `X.Y.Z`-Version ohne Vorab- oder
Buildzusatz und stelle sicher, dass die gewünschten Änderungen auf `main` liegen.
Öffne in GitHub Actions **Publish container (manual) → Run workflow**, wähle
**main** und starte den Lauf selbst. Andere Branches und Tags werden abgelehnt.
Es gibt keine Versionseingabe: Der Workflow liest `package.json` aus dem gewählten
Commit und nutzt denselben Commit für App-, Browser- und AMD64-/ARM64-
Containerprüfungen sowie den abschließenden Build. Nach erfolgreichen Prüfungen
pusht er `ghcr.io/ill-yes/im-overdue:X.Y.Z` und `:latest`.
Er erzeugt weder Commit noch Git-Tag oder GitHub Release. Normale Pushes und Pull
Requests starten Prüfungen, keine Image-Veröffentlichung.

Die Sichtbarkeit des GHCR-Pakets ist unabhängig von der Repository-Sichtbarkeit.
Prüfe die Paketeinstellungen und wähle die für das Release passende Sichtbarkeit.
Für öffentliche Verteilung stelle das Paket auf öffentlich und prüfe anonymen
Zugriff mit einem Docker-Client ohne GHCR-Zugangsdaten:

```sh
docker pull ghcr.io/ill-yes/im-overdue:X.Y.Z
```

Ersetze `X.Y.Z` durch die veröffentlichte Version. Prüfe, dass die vorgesehenen
Nutzer das Image mit den konfigurierten Paketberechtigungen abrufen können.

## Architektur und Wartung

`src/components/import/useImportFlow.ts` hält Eingabe, Zuordnung, Vorschau und
Ergebnis, Anfrageversionen und Verwerfenschutz; die vier Schrittansichten rendern
nur. `src/components/data-sources/` trennt typisierte Paketlisten, aktuelle Belege
und unveränderliche Snapshots mit lokaler Suche, Seitennavigation und
Lebenszyklus-Guards. `src/download.ts` lädt freigegebene Blobs herunter;
Anfrage-, Sitzungs- und Löschschutz bleiben bei den Aufrufern.

Die Belegidentität ist `(dataSourceId, externe id)`; Namen sind änderbare
Anzeigetexte. Schema-Upgrades ordnen Altbelege atomar zu, ohne Historie zu erfinden.
Geänderte Imports erzeugen Snapshots und speichern gemischte Ziele in einer
Revision; unveränderte Imports erhalten Revision, Historie und Rückgängig.
Quellen-, Paket- und Importrouten behalten Authentifizierung, Origin- und
Nebenläufigkeitsschutz. Sprachwechsel erhalten Namen, Belege, Snapshots und
offene Entwürfe und wiederholen keine Schreibanfragen.

Der Stack besteht aus React, TypeScript und Vite, Express, Node-`node:sqlite`
und Temporal-Polyfill. Schriften werden lokal ausgeliefert; normale App-Nutzung
lädt keine externen Schriften, Analyse- oder Fremddienst-APIs.

| Bereich | Verantwortung |
| --- | --- |
| `src/App.tsx`, Header und Arbeitsplatzkomponenten | Navigation, Dialogsitzungen und Mutationen |
| Kalender-Ansichtsmodelle und `src/calendar-model.ts` | Reine Wochen-, Marker- und Gestenberechnungen |
| `src/components/import/` | Vorschauzeilen, Vergleich, Zusammenfassung und reine Vorschaumodelle |
| `server/app.ts` | App-Aufbau: Sicherheit, Anmeldung, Größenlimits und Routenregistrierung |
| Routenmodule in `server/` (`blocks.ts`, `accounting.ts`, …) | Eine `register…Routes`-Funktion je Bereich; Schreibzugriffe laufen über `mutate()` in `state-changes.ts` |
| HTTP-/Sicherheits-/Validierungshelfer | Transaktionen, Zugriffsschutz und Eingabefehler |
| `shared/` | Zeit, Berechnung, Importvertrag, Prüfung, Wiederverwendung und Export |

Pointer-Steuerung, Fokus und Scrollen bleiben in Kalenderkomponenten;
Ansichtsmodelle verändern keine Zeitpunkte und keinen Dialog-/Gestenlebenszyklus.
Die Anfrage-/Versionssteuerung des Imports bleibt im Importdialog. Mutationen
und Rückgängig prüfen die Datenbankrevision. Späte Mutationsfehler gehören zur
auslösenden Dialoginstanz und dürfen nicht in neueren Entwürfen erscheinen.

Browser und Server teilen das Rohimportlimit von 5 MiB und 20.000 Zeilen.
Vorschau und Speichern validieren dieselbe Eingabe; Speichern prüft innerhalb
der Revisionstransaktion erneut. Belege werden nanosekundengenau halboffenen
Intervallen zugeordnet: Ein Ende um Mitternacht gehört nicht zum Folgetag.

Die Lokalisierung nutzt typisierte englische und deutsche Kataloge ohne neue
Laufzeitbibliothek. Englisch ist Standard; gespeichert wird im Browser unter
`im-overdue-language`. Keine Ableitung aus der Browsersprache oder Speicherung
in SQLite. Übersetze lesbaren Text und Meldungsschlüssel, keine technischen
Routen, Benutzerinhalte, Importfelder oder Berechnungen. Neue Schlüssel brauchen
beide Sprachen mit gleichen Platzhaltern. Gespeicherte Prüfobjekte,
Bestätigungsschlüssel und Rücknahmeeinträge bleiben unverändert.

Die API ergänzt `messageKey` und bei Bedarf `messageParams` für übersetzte
Rückmeldungen. Bestehende Meldungsfelder, Status- und Fachcodes bleiben kompatibel.
Übersetze sichtbare Fehler anhand dieser Kennungen statt durch Abgleich deutscher
Texte. Sprachwechsel dürfen Entwürfe nicht neu aufbauen, Mutationen wiederholen
oder Sitzungs- und Antwortschutz schwächen.

Bei Änderungen an Zeit, Parallelität, Authentifizierung, Rechten oder Releases
sind passende Regressionstests und ein unabhängiges Review nötig. Native
Unraid-Installation und Registry-Zugriffsprüfungen bleiben getrennt von lokalen
oder emulierten Tests.

## Weiterführende Schritte

- [Mit Docker oder Unraid betreiben](docker.md)
- [Die lokale Import-API nachlesen](import-format.md#lokale-api)
- [Gesamte Dokumentation ansehen](README.md)
