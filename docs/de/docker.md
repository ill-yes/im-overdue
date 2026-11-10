# Docker und Unraid

[English](../docker.md) · [Deutsch](docker.md) · [Startseite](../../README.de.md)

[Dokumentation](README.md) · [Verwendung](usage.md) · [Docker und Unraid](docker.md) · [Importformat](import-format.md) · [Entwicklung](development.md)

Betreibe I'm Overdue auf deinem eigenen Server mit dem öffentlichen GHCR-Image.
Die folgende Compose-Konfiguration lädt das Image herunter; Docker wählt passend
zum Host `linux/amd64` oder `linux/arm64`.
[Container-Paket ansehen](https://github.com/ill-yes/im-overdue/pkgs/container/im-overdue).

**Auf dieser Seite**

- [Mit Compose starten](#mit-compose-starten)
- [Image-Versionen](#image-versionen)
- [Befehle im Alltag](#befehle-im-alltag)
- [Persistente Daten und Rechte](#persistente-daten-und-rechte)
- [HTTPS mit vorhandenem Reverse Proxy](#https-mit-vorhandenem-reverse-proxy)
- [Unraid](#unraid)
- [Passwort ändern und aktualisieren](#passwort-ändern-und-aktualisieren)
- [Backup und Offline-Wiederherstellung](#backup-und-offline-wiederherstellung)
- [Optionaler lokaler Quellbuild](#optionaler-lokaler-quellbuild)
- [Lokale Containerprüfungen](#lokale-containerprüfungen)
- [Image-Inhalt und Lizenzen](#image-inhalt-und-lizenzen)

## Mit Compose starten

### 1. Konfigurationsdateien herunterladen

Installiere Docker mit Compose und curl. Lege ein neues, leeres Verzeichnis für
den Betrieb an und lade dort die Compose-Datei und Umgebungsvorlage herunter.

```sh
mkdir im-overdue &&
cd im-overdue &&
curl -fsSL https://raw.githubusercontent.com/ill-yes/im-overdue/main/compose.yaml -o compose.yaml &&
curl -fsSL https://raw.githubusercontent.com/ill-yes/im-overdue/main/.env.example -o .env &&
chmod 600 .env
```

### 2. Installation konfigurieren

Bearbeite `.env` und fülle die beiden Pflichtwerte aus.

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

Um vor dem ersten Start eine bestimmte Version auszuwählen, siehe
[Image-Versionen](#image-versionen).

### 3. Starten und anmelden

```sh
docker compose pull
docker compose up -d --no-build
docker compose ps
```

Öffne die konfigurierte Adresse und melde dich an. Jede andere Browseradresse
wird abgelehnt, auch ein anderer Hostname desselben Servers. Passe bei einem
Hostportwechsel auch den Origin an. HTTP überträgt Passwort und Daten
unverschlüsselt; nutze für entfernten Zugriff [HTTPS](#https-mit-vorhandenem-reverse-proxy).

Wähle Englisch oder Deutsch vor der Anmeldung oder in den Einstellungen.
Beim ersten Aufruf gilt Englisch. Die Auswahl gilt pro Browser und ändert
weder Container noch Datenbank.

## Image-Versionen

Das voreingestellte Tag `latest` folgt der neuesten veröffentlichten Version.
Um Version `1.0.0` festzulegen, ändere vor dem Start die Zeile `image` in
`compose.yaml`.

```yaml
image: ghcr.io/ill-yes/im-overdue:1.0.0
```

| Tag | Verwendung |
| --- | --- |
| `latest` | Der neuesten veröffentlichten Version folgen. |
| `1.0.0` | Version 1.0.0 ausdrücklich auswählen. |

## Befehle im Alltag

Führe diese und alle anderen Compose-Befehle für diese Installation im
Installationsverzeichnis aus, in dem `compose.yaml` und `.env` liegen.

| Aufgabe | Befehl |
| --- | --- |
| Status anzeigen | `docker compose ps` |
| Aktuelle Logs anzeigen | `docker compose logs --tail=100 im-overdue` |
| Stoppen | `docker compose stop` |
| Starten | `docker compose up -d --no-build` |

Schwärze private Werte in Logs und Screenshots, bevor du sie teilst.

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

Nutze unter **Docker → Add Container** die mitgelieferte
[XML-Vorlage](../../templates/im-overdue.xml) als Referenz für eine manuelle
Einrichtung. Behalte für **Repository** den Wert
`ghcr.io/ill-yes/im-overdue:latest` und für **Registry** die Seite des öffentlichen
[Container-Pakets](https://github.com/ill-yes/im-overdue/pkgs/container/im-overdue).
Unraid lädt das Image von GHCR herunter.

Stelle in der Vorlage die folgenden Werte ein.

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

Bearbeite bei Compose das Passwort in `.env` und erstelle den Container neu.

```sh
docker compose up -d --no-build --force-recreate
```

Nutze bei Unraid **Edit → Password → Apply**. Der Neustart meldet alle Browser
ab. Sitzungen sind nicht im Backup enthalten.

Lade vor einem Update ein Backup herunter. Wenn du eine Version festgelegt
hast, ändere das `image`-Tag in `compose.yaml` auf die gewünschte Version.
Lade danach das Image herunter und erstelle den Container neu.

```sh
docker compose pull
docker compose up -d --no-build
```

Aktualisiere unter Unraid das Image über die Docker-Seite. Wenn du eine Version
festgelegt hast, ändere **Repository** auf das gewünschte Tag und übernimm die
Änderung. Behalte dieselben Einstellungen und dieselbe Appdata-Zuordnung.
Halte vor einem Downgrade ein passendes Backup bereit und prüfe die
Datenbankkompatibilität.

Stelle für einen lokalen Quellbuild die gewünschte Quellversion bereit und
führe `docker compose up -d --build` in diesem Checkout aus. Baue ein lokales
Unraid-Image aus dieser Version neu und erstelle den Container mit denselben
Einstellungen und derselben Appdata-Zuordnung neu.

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
4. Starte mit `docker compose up -d --no-build`. Der Helfer setzt private Rechte.
   Melde dich an und prüfe Zeitzone, Sollprofile, eine Woche und deren Bilanz.

Stoppe unter Unraid zuerst den Container und nutze denselben Ablauf mit seinem
Appdata-Pfad. Stoppe bei einem benannten Volume ebenfalls den Container, sichere
alle alten Inhalte separat, lege den Snapshot in ein frisches Volume und stelle
Compose auf dessen Namen um. Behalte das Original bis zur Prüfung.
Setze bei explizitem Nicht-Root-Benutzer Eigentümer und Modi vor dem Start selbst.

## Optionaler lokaler Quellbuild

Um das Image selbst zu bauen, nutze einen vollständigen Git-Checkout mit dem
mitgelieferten `Dockerfile`.

```sh
git clone https://github.com/ill-yes/im-overdue.git &&
cd im-overdue &&
cp .env.example .env &&
chmod 600 .env
```

Konfiguriere `.env` wie unter [Mit Compose starten](#mit-compose-starten)
beschrieben. Baue und starte anschließend den Container.

```sh
docker compose up -d --build
docker compose ps
```

Führe für ein lokales Unraid-Image `docker build -t im-overdue:local .` im
Checkout aus, setze **Repository** auf `im-overdue:local` und leere **Registry**.

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

## Image-Inhalt und Lizenzen

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

## Weiterführende Schritte

- [Den ersten Arbeitstag erfassen](usage.md#einen-arbeitstag-erfassen)
- [Lokale Entwicklungsprüfungen ausführen](development.md#prüfungen)
- [Gesamte Dokumentation ansehen](README.md)
