# Docker and Unraid

[English](docker.md) · [Deutsch](de/docker.md) · [Home](../README.md)

[Documentation](README.md) · [Usage](usage.md) · [Docker and Unraid](docker.md) · [Import format](import-format.md) · [Development](development.md)

Run I'm Overdue on your own server. Start with Compose, then use the sections
below for persistent storage, HTTPS, Unraid and recovery.

One container runs the UI, API and SQLite on HTTP port `4317`; no database or
other service is needed. Multi-stage builds use Node 24 on Debian Bookworm Slim
for `linux/amd64` and `linux/arm64`. The runtime contains the built app, production
dependencies and the small `gosu` user-switch helper. It also includes
`/app/LICENSE`, `/app/NOTICE`, `/app/COMMERCIAL-LICENSE.md` and
`/app/CONTRIBUTING.md`; the OCI label
`org.opencontainers.image.licenses` is `PolyForm-Noncommercial-1.0.0`.
Original license texts for bundled React, React DOM, Lucide and Manrope assets
are retained in `/app/third-party-licenses`. Runtime dependencies keep their
own license files in `/app/node_modules`.

The project uses the [PolyForm Noncommercial License 1.0.0](../LICENSE).
The Compose setup below builds the image from source.

**On this page**

- [Start with Compose](#start-with-compose)
- [Persistent storage and permissions](#persistent-storage-and-permissions)
- [HTTPS with an existing reverse proxy](#https-with-an-existing-reverse-proxy)
- [Unraid](#unraid)
- [Change the password or update](#change-the-password-or-update)
- [Backup and offline restore](#backup-and-offline-restore)
- [Local container checks](#local-container-checks)

## Start with Compose

Install Docker with Compose. In the project directory:

```sh
cp .env.example .env
chmod 600 .env
```

Fill in the two required values:

| Variable | Value |
| --- | --- |
| `IM_OVERDUE_ORIGIN` | Exact browser origin, e.g. `http://192.168.1.20:4317` or `https://time.example.net` |
| `IM_OVERDUE_PASSWORD` | Unique password: 12–256 characters, at most 1024 UTF-8 bytes; no default |
| `IM_OVERDUE_PORT` | Host port; default `4317` |
| `PUID` / `PGID` | Runtime user/group; default `99` / `100` |

The origin must contain no path, trailing slash, credentials or query string.
Include a non-standard external port; omit default ports `:80` and `:443`.
Single-quote the password in `.env` so `$` and `#` stay literal. Keep `.env`,
container configuration and support screenshots private.

```sh
docker compose up -d --build
docker compose ps
```

Open the configured address and sign in. Every other browser address is rejected,
even another hostname for the same server. Match the origin whenever you change
the host port. HTTP transmits the password and data without encryption; use
[HTTPS](#https-with-an-existing-reverse-proxy) for remote access.

Choose English or German before signing in or in settings. English is the first-use
default. The language is saved per browser and does not change the container or database.

## Persistent storage and permissions

Compose mounts `./appdata` at `/data`; it does not use an existing local `./data`.
The directory must be empty or contain only these regular files:

- `im-overdue.sqlite`
- `im-overdue.sqlite-wal`
- `im-overdue.sqlite-shm`

Other files, subdirectories, symlinks and hardlinks stop startup. Store backups
elsewhere. Only one app process may use a database.

For a named volume, replace the bind mount in `compose.yaml` with
`im-overdue-data:/data` and add `volumes: { im-overdue-data: {} }` at the top level.
Docker creates it on first use. `docker compose down` keeps data; `down -v` deletes
named volumes. Docker Desktop's macOS file sharing represents Linux ownership
and modes differently. Use a named Linux volume when testing Linux permissions.

| Container setting | Behavior |
| --- | --- |
| `HOST` | `0.0.0.0`, so Docker can reach the server |
| `PORT` | Internal HTTP port `4317` |
| `IM_OVERDUE_DB` | Fixed `/data/im-overdue.sqlite` inside the container |
| `PUID` / `PGID` | Positive numeric IDs without leading zeroes, up to `2147483647` |

The startup helper initially runs as root. It checks only the dedicated data
directory and known SQLite files, sets the directory to `0700` and files to `0600`,
and assigns their owner. It never uses recursive `chown`. It then replaces itself
with the app through `exec gosu`, running as `PUID:PGID`; root is refused as the
app user. With explicit `--user UID:GID`, PUID/PGID must match and ownership and
private modes must already be correct. The helper does not bypass those checks.

The password is stored in `.env` or Docker/Unraid configuration. A Docker
administrator can read it; Unraid's masked field does not encrypt it. The app
never writes it to logs or SQLite backups. Sessions live only in memory for a
fixed 24 hours. Logout invalidates the current session; restart invalidates all.
There are at most 64 sessions and ten login attempts per five minutes across the
instance, with one password check at a time. Existing sessions still work when
the login limit has been reached.

The unauthenticated healthcheck uses `/api/health` and returns no user data.
Docker stops the app with `SIGTERM`; Node closes HTTP and SQLite. Outside Docker,
`IM_OVERDUE_DB` remains configurable. The default local mode listens on
`127.0.0.1` without a password; network mode requires both origin and password.

## HTTPS with an existing reverse proxy

Terminate TLS at the proxy; the container stays on internal HTTP. For an existing
Nginx HTTPS virtual host with its certificate configured separately:

```nginx
location / {
    proxy_pass http://127.0.0.1:4317;
    proxy_set_header Host $http_host;
    client_max_body_size 31m;
}
```

The 31 MiB limit accommodates JSON encoding of the maximum 5 MiB raw import.
Adjust the upstream to the address your proxy can reach. With a proxy on the same
host, Compose can bind the published port to
`127.0.0.1:${IM_OVERDUE_PORT:-4317}:4317`. With another proxy host, restrict direct
container access to that proxy through your firewall.

Set `IM_OVERDUE_ORIGIN=https://time.example.net` and recreate the container.
The original Host, including any non-standard external port, must reach the app;
the browser's Origin must also remain unchanged. `X-Forwarded-Host` and
`X-Forwarded-Proto` are not trusted. A configured HTTPS origin makes the session
cookie `Secure`; direct HTTP is then not an alternative login route. No extra
trust-proxy setting is needed.

## Unraid

Build your own image on the Unraid host from the project directory:

```sh
docker build -t im-overdue:local .
```

In **Docker → Add Container**, use `templates/im-overdue.xml` as a reference
for a manual setup. Set **Repository** to `im-overdue:local` and clear
**Registry** for this local image. Make the same changes in any local copy of
the XML template you use. If you host your own image in a registry, use its
image tag and registry page instead.

Configure the template:

1. Use bridge networking and an HTTP host port, default `4317`. Do not enable privileged mode.
2. Mount dedicated appdata, for example `/mnt/user/appdata/im-overdue`, at `/data`.
3. Set **App URL** to the exact browser origin and fill in **Password**.
4. In **Advanced View**, adjust PUID/PGID if needed. Unraid's usual `99:100` is `nobody:users`.

The normal **WebUI** link is `http://[IP]:[PORT:4317]/`. For HTTPS, also set
**Docker → Edit → Advanced View → WebUI** to the same canonical HTTPS address as
**App URL**, then choose **Apply**. It cannot automatically read the environment
variable: [Unraid's WebUI resolver](https://github.com/unraid/webgui/blob/26eb1b5c1d547ddbf44a38e63956ba24f659098b/emhttp/plugins/dynamix.docker.manager/include/DockerClient.php#L296)
substitutes its own IP/port placeholders. Preserve Host and Origin at the proxy.

## Change the password or update

For Compose, edit `.env`, then run `docker compose up -d --force-recreate`.
For Unraid, use **Edit → Password → Apply**. Restart signs out every browser;
sessions are not included in backups.

Before an update, download a backup, check out the intended source version and
run `docker compose up -d --build`. For Unraid, rebuild your local image from
that version and recreate the container with the same settings and appdata
mapping. Before downgrading, retain a matching backup and check database
compatibility.

## Backup and offline restore

After signing in, download a backup in settings. This is a consistent SQLite
snapshot; copying only the running main file is insufficient because of WAL.
Backups contain private time data and notes, but no login password or sessions.
There is no restore web endpoint.

For Compose's default bind mount:

1. Run `docker compose stop`. Ensure no other process uses the database.
2. Move all existing `appdata`, including WAL/SHM, to a safe **different location** and keep it.
3. Create fresh `appdata`. Put only the downloaded snapshot there as
   `im-overdue.sqlite`; do not copy old WAL/SHM files alongside it.
4. Run `docker compose up -d`. The helper sets private permissions. Sign in and
   check time zone, target profiles, a work week and its balance.

For Unraid, stop the container first and follow the same steps for its appdata
path. For a named volume, stop the container, separately preserve all old volume
contents, place the snapshot in a fresh volume and point Compose at that new
volume. Keep the original until verification. With an explicit non-root user,
set ownership and modes before starting.

## Local container checks

To test a local image:

```sh
docker build -t im-overdue:test .
npm run test:container -- im-overdue:test
```

Requires Docker, Node 24+ and OpenSSL on the host. Checks use temporary
containers, volumes and isolated data. Normal CI checks the app, browser and both
architectures; the GitHub AMD64 runner tests ARM64 through QEMU. Maintainers can
find the manual release workflow under
[Publishing container images](development.md#publishing-container-images).

## Next steps

- [Record your first working day](usage.md#record-a-working-day)
- [Run local development checks](development.md#checks)
- [Browse all documentation](README.md)
