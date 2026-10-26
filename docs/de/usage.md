# I'm Overdue verwenden

[English](../usage.md) · [Deutsch](usage.md) · [Startseite](../../README.de.md)

[Dokumentation](README.md) · [Verwendung](usage.md) · [Docker und Unraid](docker.md) · [Importformat](import-format.md) · [Entwicklung](development.md)

Beginne mit deinen Einstellungen und einem Arbeitstag. Danach führen dich
die weiteren Abschnitte durch Belege, Wochenabschluss und Exporte. Aktivitäten
zu importieren ist optional; du kannst Arbeitszeit ohne Import erfassen.

**Auf dieser Seite**

- [Sprache und erste Einrichtung](#sprache-und-erste-einrichtung)
- [Einen Arbeitstag erfassen](#einen-arbeitstag-erfassen)
- [Navigieren und Belege prüfen](#navigieren-und-belege-prüfen)
- [Benannte Datenquellen und Importhistorie](#benannte-datenquellen-und-importhistorie)
- [Aktivitäten importieren](#aktivitäten-importieren)
- [Vorlagen und letzte Einträge](#vorlagen-und-letzte-einträge)
- [Urlaub und Anspruch](#urlaub-und-anspruch)
- [Notizen und Rückgängig](#notizen-und-rückgängig)
- [Wochen abschließen und Salden lesen](#wochen-abschließen-und-salden-lesen)
- [Stundenzettel exportieren](#stundenzettel-exportieren)
- [Daten sichern](#daten-sichern)

## Sprache und erste Einrichtung

Beim ersten Aufruf ist Englisch eingestellt, unabhängig von der Browsersprache.
Wähle **English / Deutsch** auf der Login-Seite oder in den Einstellungen. Die
Auswahl wird in diesem Browser gespeichert, nicht in der gemeinsamen Datenbank.
Ist der Browserspeicher nicht verfügbar, gilt die Auswahl für den aktuellen Besuch.

Ein Sprachwechsel aktualisiert Beschriftungen, Datum, Zahlen und sichtbare
Meldungen. Sitzung und offene Entwürfe bleiben erhalten. Englisch verwendet
`en-GB`, Deutsch `de-DE`; beide nutzen die 24-Stunden-Zeit und Montag als
Wochenbeginn. Zeitzone, eigene Texte, importierte Inhalte und gespeicherte
Berechnungen ändern sich nicht.

Prüfe in den Einstellungen IANA-Zeitzone, Wochenstunden und Arbeitstage. Eine
normale Solländerung beginnt nächsten Montag. Vergangenes Soll zu korrigieren
ist eine eigene Aktion: Betroffene abgeschlossene Wochen werden erst nach
Bestätigung wieder geöffnet.

## Einen Arbeitstag erfassen

1. Wähle ein Datum im Kalender. **Heute** gilt in der App-Zeitzone.
2. Ziehe mit der linken Maustaste einen Arbeitsblock im 15-Minuten-Raster.
3. Gib in der Schnellerfassung eine Tätigkeit ein und speichere mit Enter oder
   wähle einen letzten Eintrag beziehungsweise eine Vorlage. Diese Auswahl
   speichert den gezeichneten Zeitraum direkt.
4. Klicke einen Block an oder nutze **Zeit eintragen**, um genaue Zeiten,
   Notizen oder Arbeit über Mitternacht einzugeben. Nutze für Touch und Tastatur
   diesen Dialog.

Verschieben und Ziehen an Blockrändern speichert sofort. Escape bricht eine
laufende Geste ab. Blöcke dürfen sich nicht überschneiden. Pausen sind Lücken:
08:00–16:00 sind acht Stunden, wenn du keine Pause aussparst. Ein Eintrag reicht
höchstens sieben lokale Kalendertage weit, auch bei einer Zeitumstellung. Für
Arbeit über Mitternacht musst du das Enddatum ausdrücklich ändern.

Eine Lücke zwischen zwei Blöcken öffnet per Klick die Schnellerfassung, ohne zu
speichern. Das geht auch mit Tab/Enter und Touch. **Kleine Lücken** macht schmale
Lücken erreichbar. Vor dem ersten und nach dem letzten Block öffnet ein Klick
die genaue Zeiteingabe. Belege und Urlaub erzeugen keine Arbeitsblöcke oder
auffüllbaren Arbeitslücken.

Beim Speichern sind die Eingaben dieses Dialogs gesperrt. Schließen bricht eine
bereits gestartete Anfrage nicht ab. Ein neuer Entwurf bleibt bearbeitbar und
kann nach Abschluss der vorherigen Anfrage gespeichert werden. Fehler erhalten
die Eingabe; späte Antworten ersetzen keinen neueren Entwurf. Ein Sprachwechsel
wiederholt keine Änderungen.

## Navigieren und Belege prüfen

Die Hauptansichten sind **Kalender**, **Zeitkonto** und **Vorlagen**. Die
bestehenden Adressen `#/kalender`, `#/zeitkonto` und `#/vorlagen` unterstützen
Browser-Zurück und -Vorwärts. Beim Wechsel bleiben Kalenderdatum, Filter,
Scrollposition, Berichtszeitraum und Vorlagensuche erhalten. Ungespeicherte
Vorlagen oder Urlaubsansprüche verlangen vor dem Verwerfen Bestätigung; ihre
eigenen Speicherungen sperren den Wechsel kurz.

**Woche / Monat** zeigt Arbeit, Soll, Saldo, Wochenstatus und die Anzahl
gefilterter Aktivitäten je Tag. Ein Tagesklick im Monat öffnet seine Woche.
Randtage benachbarter Monate dienen nur der Orientierung und zählen nicht zur
Monatssumme. Nach Neuladen startet die Wochenansicht ohne Fokusmodus.

Die **Fokusansicht** vergrößert den Kalender und blendet globale Navigation und
Kennzahlen aus. Kalenderaktionen und Rückgängig bleiben erreichbar. Escape
schließt zuerst eine Auswahl oder einen Dialog beziehungsweise bricht eine Geste
ab und beendet erst danach den Fokus. Der Wechsel zum Monat beendet ihn ebenfalls.

Ein Tagesdatum oder **Tag prüfen** öffnet die chronologische Belegliste mit
Quelle, Uhrzeit und Quelllink. Quellenfilter gelten auch hier; die Titelsuche
filtert nur diese Liste. **Weitere 50** lädt bei Bedarf nach. Du kannst einen
Beleg im Kalender zeigen oder Zeit für diesen Tag eintragen. Termine über
Mitternacht sind markiert; ein Ende exakt um Mitternacht gehört nicht zum Folgetag.

## Benannte Datenquellen und Importhistorie

Unter **Einstellungen → Datenquellen** legst du benannte Quellen für Google
Kalender, Slack, GitHub oder Sonstige an. Mehrere Quellen desselben Typs sind
möglich, etwa „Slack Arbeit“ und „Slack Verein“. Der Typ bleibt fest; Umbenennen
ändert keine Belegidentität.

Die Details trennen **Importpakete** und **Aktuelle Belege**, mit Suche und
50 Einträgen pro Seite. Pakete bewahren normalisierte Snapshots der eingereichten
Belege, einschließlich unveränderter Zeilen. Spätere Änderungen betreffen nur
den aktuellen Bestand. Rohdateien werden nicht gespeichert. Ein vollständig
unveränderter Import erzeugt weder Paket noch Revision und erhält Rückgängig.

**Im Kalender öffnen** wählt den frühesten Belegtag. Nach Neuladen zeigen Filter
wieder alle Quellen; Arbeit, Salden und Wochenprüfung bleiben davon unabhängig.
**Quelle einblenden und öffnen** zeigt bewusst nur diese Quelle wieder an und
lässt andere ausgeblendete Quellen verborgen. Die normale Importnavigation
erhält die Filter.

Alte Datenbanken und Backups werden beim regulären Appstart atomar migriert:
bestehende Belege erhalten je bisherigem Typ eine Standardquelle und bleiben
**ohne Importhistorie**. Historische Pakete werden nicht erfunden.

Löschen verlangt eine Bestätigung mit Beleg- und Paketanzahl und entfernt Quelle,
Belege und Snapshots gemeinsam. Arbeitszeit, Notizen, Urlaub und Wochenstatus
bleiben erhalten. Wiederherstellung benötigt ein Backup; Arbeitszeit-Rückgängig
stellt keine Quelle wieder her. Pakete sind nicht einzeln löschbar. Echte
Quellenänderungen und Imports verwerfen Rückgängig; Lesen, Filtern und
unverändertes Speichern tun das nicht.

## Aktivitäten importieren

Wähle eine Datei, ziehe sie in den Dialog oder füge Daten ein. Dateiauswahl und
Texteingabe behalten eigene Entwürfe. Synthetische Beispieldateien sind im Dialog
herunterladbar. Das [Importformat](import-format.md) beschreibt erlaubte Daten.

Analysiere die Datei, ordne jeden enthaltenen Typ einer passenden benannten
Quelle zu und prüfe danach die Vorschau. Gemischte Dateien bleiben erlaubt.
**Hier importieren** in den Quellendetails überspringt die Zuordnung bei genau
dem passenden Quellentyp; **Zuordnung bearbeiten** ändert das sichtbare Ziel.
Beim Verlassen nicht übernommener Datei-/Textentwürfe fragt die App nach;
Abbrechen erhält Eingaben und Zuordnungen. Schließen bricht einen gestarteten
Commit nicht ab. Danach öffnet **Zur Datenquelle** Bestand und Historie.

Die Vorschau zeigt Quellen, Zeitraum, Fehler sowie neue, geänderte, unveränderte
und doppelte Einträge. Zeiten erscheinen in der eingestellten Zeitzone mit
UTC-Offset. Änderungen zeigen bisherige und neue Werte. Alle Zeilen sind auf
Seiten zu je 50 erreichbar; mobil stehen Vergleichsfelder untereinander.

Prüfe vor der Bestätigung: Fehler blockieren den gesamten Import; Änderungen
seit der Vorschau verlangen eine neue Vorschau. Das Ergebnis bleibt danach
offen. **Zeitraum öffnen** springt zum frühesten Beleg, auch bei unverändertem
Import. Vorhandene Quellenfilter bleiben erhalten; ausgeblendete importierte
Quellen werden genannt. Der Dateizeitraum beweist keinen vollständigen Export.
Aktivitäten beginnen keine Arbeitswoche, schließen sie nicht ab und erzeugen
keine erfasste Arbeit.

## Vorlagen und letzte Einträge

Vorlagen enthalten Tätigkeit, optionale Notiz und Dauer. Der Tätigkeitsname ist
Pflicht (höchstens 160 Zeichen), die Notiz erlaubt bis zu 2.000 Zeichen.
Identische Vorlagen werden nicht doppelt angelegt. Eine Vorlage allein zu
speichern oder zu ändern erfasst keine Arbeitszeit.

Die Schnellauswahl durchsucht Vorlagen, letzte und getrennt aufgeführte ältere
Einträge. Sie übernimmt Tätigkeit und Notiz. Bei einer frischen genauen Eingabe
schlägt sie auch die Dauer vor; gezeichnete, manuell geänderte und bestehende
Zeiträume bleiben erhalten. **Vorlagendauer übernehmen** wendet die Dauer ab dem
aufgelösten Beginn an. Wähle bei doppelten Ortszeiten zuerst das Vorkommen.
Es zählt verstrichene Zeit, auch über Mitternacht oder Zeitumstellungen.
Die Auswahl im ausführlichen Dialog speichert selbst keine Arbeitszeit.

Die Schnellerfassung übergibt Entwurf und Eingabezeitzone an die genaue
Bearbeitung. Wegklicken verwirft einen ungespeicherten Schnellentwurf. Escape
schließt zuerst die Auswahl, dann die Schnellerfassung, dann den Fokus.
Im ausführlichen Dialog führt Zurück oder Escape eine Ebene zurück; Kreuz und
Hintergrund schließen die gesamte Eingabe nach nötiger Bestätigung ungespeicherter
Vorlagenänderungen.

**Als Vorlage merken** speichert Arbeit und neue Vorlage atomar. **Nur als
Vorlage speichern** erzeugt weder Arbeit noch eine bearbeitete Woche.
Vorlagenänderungen verändern keine bestehenden Arbeitsblöcke. Gleichzeitige
Änderungen werden getrennt gezeigt; Überschreiben braucht Bestätigung.
Eigene Vorlagenspeicherungen und -löschungen sperren Zurück und Schließen kurz.

Letzte Einträge sind die 20 zuletzt erfolgreich neu angelegten, unterschiedlichen
Kombinationen aus Tätigkeit, Notiz und ursprünglicher Dauer. Die Erfassungszeit
bestimmt die Reihenfolge. Bearbeiten oder Löschen eines Blocks verändert die
Liste nicht. Altdaten ohne Erfassungszeit stehen getrennt nach Arbeitsdatum;
Importe erscheinen nicht. Vorlagen und letzte Einträge sind im SQLite-Backup enthalten.

## Urlaub und Anspruch

Wähle einen Tag oder bis zu 366 Kalendertage mit ganzen oder halben Tagen.
Prüfe die Tagesliste vor dem Speichern: Tage ohne Soll werden übersprungen;
Feiertage musst du selbst abwählen. Vorhandener Urlaub lässt sich im Bereich entfernen.

Urlaub ist eine Gutschrift, kein Arbeitsblock:

**Tagesbilanz = Arbeit + Urlaubsgutschrift − Soll.**

Ein voller Urlaubstag schreibt sein Tagessoll gut, ein halber die Hälfte,
gegebenenfalls sekundengenau. Arbeit am Urlaubstag zählt zusätzlich und wird
vor dem Speichern gezeigt. Urlaub bleibt nach Zeitzonenwechsel am lokalen Datum.
Ein geändertes Sollprofil verändert auch die Gutschrift. Bei Soll null entsteht
weder Anspruchsverbrauch noch Gutschrift; Urlaub bleibt sichtbar und entfernbar.

Änderungen öffnen betroffene abgeschlossene Wochen nach Bestätigung wieder und
lassen sich als eine Aktion rückgängig machen, einschließlich früherer Anteile
und Wochenstatus. Zukünftige reine Urlaubswochen erzeugen vor Beginn keinen
vorläufigen Fehlbetrag.

Unter **Zeitkonto → Urlaubskonto** legst du Jahresanspruch und Übertrag in ganzen
oder halben Tagen fest. Bis heute gilt Urlaub als genommen, danach als geplant.
Beides reduziert den Rest. Ohne Anspruch bleibt der Rest unbekannt; negative
Reste sind erlaubt. Es gibt keine automatische Übertragung, Verfallsregel,
anteilige Berechnung oder Feiertags-/Krankheitsbehandlung. Ein geänderter Anspruch
verwirft Rückgängig; unveränderte Werte nicht. Ungespeicherte Änderungen brauchen
beim Jahres-/Ansichtswechsel und Schließen Bestätigung.

## Notizen und Rückgängig

Tages- und Wochennotizen sind von Blocknotizen getrennt und erlauben je 5.000
Zeichen. Leeren und speichern entfernt eine Notiz. Bei Zeitzonenwechsel bleiben
Datum beziehungsweise Wochenmontag erhalten. Stunden und Wochenstatus ändern
sich nicht; auch abgeschlossene und unbearbeitete Wochen sind kommentierbar.
Ungespeicherte Entwürfe brauchen Bestätigung. Speicherfehler und Revisionsprüfungen
erhalten die Eingabe.

**Rückgängig** stellt genau die letzte erfolgreiche Arbeitszeit- oder
Urlaubsänderung wieder her: Tagessegmente, IDs, Tätigkeit, Notizen, Wochenstatus
und gegebenenfalls gemeinsam angelegte Vorlage und letzte Einträge. Die
Möglichkeit überlebt Neuladen und App-Neustart. Neue Arbeit oder Urlaub ersetzt
sie. Andere erfolgreiche Änderungen – Import, Wochenabschluss, Einstellungen,
Notizen, separate Vorlagen oder Ansprüche – verwerfen sie. Unveränderte Werte,
Fehler, Vorschauen, Navigation und Downloads erhalten sie. Revisionsprüfungen
verhindern veraltetes Überschreiben anderer Tabs. Es gibt einen Schritt und kein
Redo. **Strg/Cmd+Z** funktioniert außerhalb von Dialogen, Gesten und Textfeldern.

## Wochen abschließen und Salden lesen

Vor dem Abschluss prüfst du vergangene Solltage ohne Arbeit oder volle
Urlaubsgutschrift, Belege außerhalb der Arbeit und Tage mit mehr als zwölf
Arbeitsstunden. Die Prüfung nutzt alle Quellen unabhängig vom Kalenderfilter.
Sie dient der Orientierung und ist weder automatische Erfassung noch rechtliche
Prüfung. Bestätige Hinweise bewusst sowie beim vorzeitigen Abschluss der
laufenden Woche das volle Soll. Der Server prüft Daten und Hinweise erneut:
Eine neue Revision oder ein zeitabhängig neuer Hinweis braucht neue Bestätigung.

Abgeschlossene Wochen zählen als bestätigt. Begonnene offene Wochen bleiben
vorläufig, einschließlich aller ihrer Tage. Unbearbeitete Wochen bedeuten
fehlende Daten und keinen Nullsaldo. Eine bewusst leer abgeschlossene
Standardwoche ergibt −40 Stunden. Monat, Quartal und Jahr teilen Grenzwochen
nach lokalem Tag und trennen bestätigte und vorläufige Werte. Offene Wochen
führen zurück zum Kalender.

Das erste Soll gilt für die ganze Historie, weitere Profile beginnen montags.
Standard sind 40 Stunden von Montag bis Freitag; Restminuten gehen an die ersten
Arbeitstage. Arbeit an sollfreien Tagen ist Plus, Minusstunden reduzieren
positive Salden. Beispiel: 28. September–4. Oktober 2026 mit Arbeit
`9/8/10/8/7/2/0` Stunden und 40-Stunden-Soll ergibt +4 Stunden für die Woche,
+3 im September und +1 im Oktober.

Gespeichert werden UTC-Zeitpunkte; lokale Tage folgen der eingestellten Zeitzone.
Es zählt tatsächlich verstrichene Zeit. Zeitumstellungstage haben 23 oder 25
Stunden; doppelte Ortszeiten müssen eindeutig gewählt werden. Geänderte
abgeschlossene Arbeit öffnet alle betroffenen Wochen atomar. Feiertage, Krankheit
und gesetzliche Pausen werden nicht automatisch verrechnet. Der Abschluss ist
deine persönliche Bestätigung und keine Arbeitgeberfreigabe.

## Stundenzettel exportieren

Öffne den Stundenzettel aus dem gewählten Zeitkontozeitraum, einer Woche oder
einem eigenen Bereich bis 366 Tage. Tätigkeiten sind standardmäßig enthalten;
Block-, Tages- und Wochennotizen nur auf Wunsch. Ein optionaler Name gilt nur für
diesen Export. Anfangs sind nur abgeschlossene Wochen enthalten. Die Vorschau
nennt enthaltene und ausgeblendete Tage; ohne Tage sind CSV und Druck gesperrt,
bis du Zeitraum oder Filter änderst.

Vorschau, CSV und Druck teilen einen eingefrorenen Datenstand mit Revision und
Zeitzone. Ändere den Zeitraum oder öffne neu, um Daten zu aktualisieren.
Die Sprache folgt der App-Auswahl ohne Änderung des Datenstands. Jeder Tag
zeigt Arbeitsintervalle mit Tätigkeit, Arbeit, Urlaub, Soll und Saldo. Ohne
Abschlussfilter sind offene Tage vorläufig, unbearbeitete nicht erfasst; letztere
haben keinen bestätigten Saldo. Bestätigte und vorläufige Summen bleiben getrennt.

**PDF / Drucken** öffnet den Browserdruck für A4 hoch mit 12 mm Rand. Dort kannst
du eine PDF speichern. Ein typischer Monat mit zwei kurzen Intervallen je
Arbeitstag passt bei 100 % auf eine Seite. Lange Tätigkeiten und gewählte Notizen
umbrechen auf weitere Seiten mit wiederholten Tabellenköpfen. Dauern verwenden
h:mm, bei Bedarf Sekunden; Zeitumstellungen zeigen eindeutige UTC-Offsets.
Der Nachweis dient der Kenntnisnahme und ist kein Freigabeverfahren.

CSV verwendet UTF-8 mit BOM und Semikolon. Dauern sind numerische Minuten,
bei Bedarf auch halbe Minuten. ISO-Daten, Zahlenformat und Spaltenreihenfolge
bleiben sprachunabhängig; lesbare Beschriftungen folgen der App. Eigene Texte
sind gegen Tabellenformeln abgesichert. Prüfe Notizen und Vorschau vor dem
Teilen: Exporte können private Informationen enthalten. Sie entstehen lokal,
ohne Übertragung an einen Fremddienst.

## Daten sichern

Lade in den Einstellungen einen konsistenten SQLite-Snapshot herunter. Er
enthält Arbeit, Belege, Sollprofile, Zeitzone, Wochenstatus, Notizen, Urlaub,
Ansprüche, Vorlagen, letzte Einträge und gegebenenfalls Rückgängig einschließlich
früherer Notizen. Loginpasswort und Sitzungen sind nicht enthalten. Nur die
laufende Hauptdatei zu kopieren ist wegen SQLite-WAL kein konsistentes Backup.
Dateiverschlüsselung und Cloud-Sicherung gibt es nicht.

Für Docker/Unraid gilt die [Offline-Wiederherstellung](docker.md#backup-und-offline-wiederherstellung).
Für lokalen Node-Betrieb:

1. Stoppe die App und alle Prozesse, die diese Datenbank nutzen.
2. Verschiebe das gesamte bisherige Datenverzeichnis samt WAL/SHM an einen
   sicheren anderen Ort und behalte es.
3. Lege ein frisches Verzeichnis an und den heruntergeladenen Snapshot darin
   als `im-overdue.sqlite` ab. Keine alten WAL-/SHM-Dateien hinzufügen.
4. Starte neu und prüfe Zeitzone, Sollprofile, eine Arbeitswoche und ihre Bilanz.
   Passe den Pfad bei gesetztem `IM_OVERDUE_DB` an.

Standard ist `data/im-overdue.sqlite`. Nie zwei Prozesse mit derselben Datenbank
betreiben. Bestehende Datenbanken erhalten beim Start die benötigten leeren
Tabellen; für Altdaten werden keine Erfassungszeiten erfunden. Sichere vor
Updates und behalte die Originaldaten bis zur erfolgreichen Prüfung der Wiederherstellung.

## Weiterführende Schritte

- [Einen optionalen Aktivitätsimport vorbereiten](import-format.md)
- [Mit Docker oder Unraid betreiben](docker.md)
- [Gesamte Dokumentation ansehen](README.md)
