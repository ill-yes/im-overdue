# Docker und Unraid

[English](../docker.md) · [Deutsch](docker.md) · [Startseite](../../README.de.md)

[Dokumentation](README.md) · [Verwendung](usage.md) · [Docker und Unraid](docker.md) · [Importformat](import-format.md) · [Entwicklung](development.md)

Betreibe I'm Overdue auf deinem eigenen Server. Beginne mit Compose; die
weiteren Abschnitte erklären dauerhafte Daten, HTTPS, Unraid und Wiederherstellung.

Ein Container betreibt Oberfläche, API und SQLite auf HTTP-Port `4317`; weitere
Dienste sind nicht nötig. Mehrstufige Builds nutzen Node 24 auf Debian Bookworm
Slim für `linux/amd64` und `linux/arm64`. Das Laufzeitimage enthält gebaute App,
Produktionsabhängigkeiten und den kleinen Benutzerwechsel-Helfer `gosu`.
Es enthält außerdem `/app/LICENSE`, `/app/NOTICE`, `/app/COMMERCIAL-LICENSE.md`
und `/app/CONTRIBUTING.md`; das OCI-Label `org.opencontainers.image.licenses`
lautet `PolyForm-Noncommercial-1.0.0`.
Die originalen Lizenztexte für gebündelte React-, React-DOM-, Lucide- und
Manrope-Assets bleiben unter `/app/third-party-licenses` erhalten.
Laufzeitabhängigkeiten behalten ihre Lizenzdateien unter `/app/node_modules`.

Das Projekt nutzt die [PolyForm Noncommercial License 1.0.0](../../LICENSE).
Die folgende Compose-Konfiguration baut das Image aus dem Quellcode.

**Auf dieser Seite**

- [Mit Compose starten](#mit-compose-starten)
- [Persistente Daten und Rechte](#persistente-daten-und-rechte)
- [HTTPS mit vorhandenem Reverse Proxy](#https-mit-vorhandenem-reverse-proxy)
- [Unraid](#unraid)
- [Passwort ändern und aktualisieren](#passwort-ändern-und-aktualisieren)
- [Backup und Offline-Wiederherstellung](#backup-und-offline-wiederherstellung)
- [Lokale Containerprüfungen](#lokale-containerprüfungen)

## Mit Compose starten

Installiere Docker mit Compose. Im Projektverzeichnis:

```sh
cp .env.example .env
chmod 600 .env
```

Fülle die beiden Pflichtwerte aus:

| Variable | Wert |
| --- | --- |
| `IM_OVERDUE_ORIGIN` | Genaue Browseradresse, z. B. `http://192.168.1.20:4317` oder `https://zeit.example.net` |
| `IM_OVERDUE_PASSWORD` | Eigenes Passwort: 12–256 Zeichen, höchstens 1024 UTF-8-Bytes; kein Standardpasswort |
| `IM_OVERDUE_PORT` | Hostport, Standard `4317` |
| `PUID` / `PGID` | Laufzeitbenutzer/-gruppe, Standard `99` / `100` |

Der Origin darf keinen Pfad, abschließenden Schrägstrich, Zugangsdaten oder
Querystring enthalten. Gib abweichende Außenports an; Standardports `:80` und
`:443` weglassen. Setze das Passwort in `.env` in einfache Anführungszeichen,
damit `$` und `#` unverändert bleiben. Halte `.env`, Containerkonfiguration und
Support-Screenshots privat.

```sh
docker compose up -d --build
docker compose ps
```

Öffne die konfigurierte Adresse und melde dich an. Jede andere Browseradresse
wird abgelehnt, auch ein anderer Hostname desselben Servers. Passe bei einem
Hostportwechsel auch den Origin an. HTTP überträgt Passwort und Daten
unverschlüsselt; nutze für entfernten Zugriff [HTTPS](#https-mit-vorhandenem-reverse-proxy).

Wähle Englisch oder Deutsch vor der Anmeldung oder in den Einstellungen.
Beim ersten Aufruf gilt Englisch. Die Auswahl gilt pro Browser und ändert
weder Container noch Datenbank.

## Persistente Daten und Rechte

Compose bindet `./appdata` nach `/data` und verwendet vorhandenes lokales `./data`
nicht. Das Verzeichnis muss leer sein oder nur diese regulären Dateien enthalten:

- `im-overdue.sqlite`
- `im-overdue.sqlite-wal`
- `im-overdue.sqlite-shm`

Fremde Dateien, Unterverzeichnisse, Symlinks und Hardlinks verhindern den Start.
Sichere Backups an einem anderen Ort. Nur ein App-Prozess darf eine Datenbank nutzen.

Ersetze für ein benanntes Volume den Bind-Mount in `compose.yaml` durch
`im-overdue-data:/data` und ergänze oben `volumes: { im-overdue-data: {} }`.
Docker legt es bei erster Nutzung an. `docker compose down` erhält Daten;
`down -v` löscht benannte Volumes. Docker Desktop unter macOS bildet Linux-
Eigentümer und Rechte bei Dateifreigaben abweichend ab. Prüfe Linux-Rechte mit
einem benannten Linux-Volume.

| Containereinstellung | Verhalten |
| --- | --- |
| `HOST` | `0.0.0.0`, damit Docker den Server erreicht |
| `PORT` | Interner HTTP-Port `4317` |
| `IM_OVERDUE_DB` | Im Container fest `/data/im-overdue.sqlite` |
| `PUID` / `PGID` | Positive numerische IDs ohne führende Nullen, höchstens `2147483647` |

Der Starthelfer läuft zunächst als Root. Er prüft nur das dedizierte
Datenverzeichnis und die bekannten SQLite-Dateien, setzt das Verzeichnis auf
`0700`, Dateien auf `0600` und weist ihren Eigentümer zu. Es gibt kein rekursives
`chown`. Danach ersetzt er sich per `exec gosu` durch die App als `PUID:PGID`;
Root als App-Benutzer ist ausgeschlossen. Bei explizitem `--user UID:GID` müssen
PUID/PGID passen; Eigentümer und private Rechte müssen bereits stimmen.
Der Helfer umgeht diese Prüfungen nicht.

Das Passwort liegt in `.env` oder der Docker-/Unraid-Konfiguration. Ein Docker-
Administrator kann es lesen; Unraids maskiertes Feld verschlüsselt es nicht.
Die App schreibt es weder in Logs noch SQLite-Backups. Sitzungen liegen für
feste 24 Stunden nur im Arbeitsspeicher. Abmelden entwertet die eigene Sitzung,
ein Neustart alle. Es gelten höchstens 64 Sitzungen, zehn Loginversuche pro
Client-Adresse und fünf Minuten (IPv6 pro /56-Präfix) und eine gleichzeitige
Passwortprüfung. Ein Client am Limit sperrt keine anderen Clients aus, und
bestehende Sitzungen bleiben nutzbar. Ein erfolgreicher Login setzt den Zähler
des Clients zurück.

Der öffentliche Healthcheck verwendet `/api/health` ohne Nutzerdaten. Docker
stoppt per `SIGTERM`; Node schließt HTTP und SQLite. Außerhalb Docker bleibt
`IM_OVERDUE_DB` konfigurierbar. Lokaler Standardbetrieb bindet `127.0.0.1` ohne
Passwort; Netzwerkbetrieb benötigt Origin und Passwort.

## HTTPS mit vorhandenem Reverse Proxy

TLS endet am Proxy, der Container nutzt intern HTTP. Für einen vorhandenen
Nginx-HTTPS-VHost mit separat eingerichtetem Zertifikat:

```nginx
location / {
    proxy_pass http://127.0.0.1:4317;
    proxy_set_header Host $http_host;
    client_max_body_size 31m;
}
```

31 MiB berücksichtigen die JSON-Kodierung eines maximal 5 MiB großen Rohimports.
Passe den Upstream an die vom Proxy erreichbare Adresse an. Auf demselben Host
kann Compose den Port auf `127.0.0.1:${IM_OVERDUE_PORT:-4317}:4317` begrenzen.
Bei anderem Proxy-Host beschränke direkten Containerzugriff per Firewall auf
diesen Proxy.

Setze `IM_OVERDUE_ORIGIN=https://zeit.example.net` und erstelle den Container neu.
Der ursprüngliche Host einschließlich abweichendem Außenport muss ankommen;
der Browser-Origin muss unverändert bleiben. `X-Forwarded-Host` und
`X-Forwarded-Proto` werden nicht vertraut. HTTPS als konfigurierter Origin setzt
das Sitzungscookie auf `Secure`; direktes HTTP ist dann kein alternativer
Loginweg.

Hinter einem Proxy kommen alle Logins von der Adresse des Proxys, alle Browser
teilen sich also ein Loginlimit. Damit jeder Browser einzeln begrenzt wird, setze
`IM_OVERDUE_TRUSTED_PROXIES` auf Adresse oder Bereich des Proxys, zum Beispiel
`172.16.0.0/12` für einen Proxy-Container im Docker-Bridge-Netz, und lass den
Proxy `X-Forwarded-For` setzen (Nginx: `proxy_set_header X-Forwarded-For
$proxy_add_x_forwarded_for;`). Der Wert ist eine kommagetrennte Liste von
IP-Adressen oder CIDR-Bereichen. Die App liest `X-Forwarded-For` nur für das
Loginlimit und nur von diesen Gegenstellen; Host-, Origin- und Protokollprüfung
bleiben unverändert. Trage keine Bereiche ein, aus denen nicht vertrauenswürdige
Clients direkt verbinden können, denn sie könnten sonst ihre Adresse selbst wählen.

## Unraid

Baue auf dem Unraid-Host im Projektverzeichnis dein eigenes Image:

```sh
docker build -t im-overdue:local .
```

Nutze unter **Docker → Add Container** die Datei `templates/im-overdue.xml`
als Referenz für eine manuelle Einrichtung. Setze **Repository** auf
`im-overdue:local` und leere **Registry** für dieses lokale Image. Passe auch
eine verwendete lokale Kopie der XML-Vorlage entsprechend an. Bei einem selbst
in einer Registry bereitgestellten Image trägst du stattdessen dessen Image-Tag
und Registry-Seite ein.

Stelle in der Vorlage ein:

1. Bridge-Netz und HTTP-Hostport, Standard `4317`. Kein privilegierter Modus.
2. Dediziertes Appdata, etwa `/mnt/user/appdata/im-overdue`, nach `/data`.
3. **App URL** auf den genauen Browser-Origin setzen und **Password** ausfüllen.
4. Unter **Advanced View** PUID/PGID bei Bedarf anpassen. Unraids übliche `99:100` sind `nobody:users`.

Der normale **WebUI**-Link lautet `http://[IP]:[PORT:4317]/`. Setze für HTTPS
zusätzlich **Docker → Edit → Advanced View → WebUI** auf dieselbe kanonische
HTTPS-Adresse wie **App URL** und wähle **Apply**. Umgebungsvariablen werden
nicht automatisch übernommen: Die [Unraid-WebUI-Auflösung](https://github.com/unraid/webgui/blob/26eb1b5c1d547ddbf44a38e63956ba24f659098b/emhttp/plugins/dynamix.docker.manager/include/DockerClient.php#L296)
ersetzt eigene IP-/Port-Platzhalter. Der Proxy muss Host und Origin erhalten.

## Passwort ändern und aktualisieren

Bearbeite bei Compose `.env` und führe `docker compose up -d --force-recreate`
aus. Nutze bei Unraid **Edit → Password → Apply**. Der Neustart meldet alle
Browser ab; Sitzungen sind nicht im Backup enthalten.

Lade vor einem Update ein Backup herunter, stelle die gewünschte Quellversion
bereit und führe `docker compose up -d --build` aus. Baue unter Unraid dein
lokales Image aus dieser Version neu und erstelle den Container mit denselben
Einstellungen und derselben Appdata-Zuordnung neu. Halte vor einem Downgrade ein
passendes Backup bereit und prüfe die Datenbankkompatibilität.

## Backup und Offline-Wiederherstellung

Lade nach der Anmeldung in den Einstellungen ein Backup herunter. Es ist ein
konsistenter SQLite-Snapshot; nur die laufende Hauptdatei zu kopieren genügt
wegen WAL nicht. Backups enthalten private Zeitdaten und Notizen, aber weder
Loginpasswort noch Sitzungen. Es gibt keinen Restore-Webendpunkt.

Für den Standard-Bind-Mount von Compose:

1. Führe `docker compose stop` aus. Kein weiterer Prozess darf die Datenbank nutzen.
2. Verschiebe das gesamte bisherige `appdata` einschließlich WAL/SHM an einen
   sicheren **anderen Ort** und behalte es.
3. Lege frisches `appdata` an. Lege nur den Snapshot als `im-overdue.sqlite`
   hinein; keine alten WAL-/SHM-Dateien dazukopieren.
4. Starte mit `docker compose up -d`. Der Helfer setzt private Rechte.
   Melde dich an und prüfe Zeitzone, Sollprofile, eine Woche und deren Bilanz.

Stoppe unter Unraid zuerst den Container und nutze denselben Ablauf mit seinem
Appdata-Pfad. Stoppe bei einem benannten Volume ebenfalls den Container, sichere
alle alten Inhalte separat, lege den Snapshot in ein frisches Volume und stelle
Compose auf dessen Namen um. Behalte das Original bis zur Prüfung.
Setze bei explizitem Nicht-Root-Benutzer Eigentümer und Modi vor dem Start selbst.

## Lokale Containerprüfungen

So prüfst du ein lokales Image:

```sh
docker build -t im-overdue:test .
npm run test:container -- im-overdue:test
```

Voraussetzung sind Docker, Node 24+ und OpenSSL auf dem Host. Die Prüfungen
nutzen temporäre Container, Volumes und isolierte Daten. Normale CI prüft App,
Browser und beide Architekturen; ARM64 läuft auf dem GitHub-AMD64-Runner per
QEMU. Den manuellen Veröffentlichungsablauf für Maintainer findest du unter
[Container-Images veröffentlichen](development.md#container-images-veröffentlichen).

## Weiterführende Schritte

- [Den ersten Arbeitstag erfassen](usage.md#einen-arbeitstag-erfassen)
- [Lokale Entwicklungsprüfungen ausführen](development.md#prüfungen)
- [Gesamte Dokumentation ansehen](README.md)
