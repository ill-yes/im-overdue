# Development

[English](development.md) · [Deutsch](de/development.md) · [Home](../README.md)

[Documentation](README.md) · [Usage](usage.md) · [Docker and Unraid](docker.md) · [Import format](import-format.md) · [Development](development.md)

Use this guide to run, configure and check I'm Overdue locally. Architecture
and maintenance notes follow the runnable setup steps.

**On this page**

- [Run locally](#run-locally)
- [Checks](#checks)
- [Localization checks](#localization-checks)
- [Publishing container images](#publishing-container-images)
- [Architecture and maintenance](#architecture-and-maintenance)

## Run locally

Use Node.js 24 or newer and npm. The container pins the Node 24 release line;
`.nvmrc` selects it for nvm and compatible version managers, and npm refuses to
install on older versions.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4317`. One server provides UI and API; no separate frontend
server is needed. The local default is loopback-only without login. To run a
production build:

```sh
npm run build
npm start
```

| Variable | Local behavior |
| --- | --- |
| `PORT` | HTTP port; default `4317` |
| `HOST` | Default `127.0.0.1`; `0.0.0.0` enables network access |
| `IM_OVERDUE_DB` | SQLite path; default `data/im-overdue.sqlite` |
| `IM_OVERDUE_ORIGIN` | Exact HTTP(S) browser origin, required in network mode |
| `IM_OVERDUE_PASSWORD` | Required in network mode; 12–256 characters, at most 1024 UTF-8 bytes |
| `IM_OVERDUE_TRUSTED_PROXIES` | Optional comma-separated proxy IPs/CIDR ranges whose `X-Forwarded-For` identifies the client for the login limit |

Incomplete network configuration fails before the database opens. Forwarded
headers are not trusted, except `X-Forwarded-For` from configured trusted proxies for
the login limit. Follow the [Docker guide](docker.md) for canonical-origin
rules and HTTPS. Never run two app processes against the same database. Keep the
database, its WAL/SHM files, backups, `.env` and generated output out of Git.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run lint` runs ESLint with TypeScript and React hook rules and fails on any
warning. Where an effect deliberately reacts to fewer dependencies, a
`react-hooks/exhaustive-deps` exception states the reason inline.

The browser suite runs against the built app. Tests use temporary isolated
databases, not `data/im-overdue.sqlite`. Browser reports and screenshots go to
ignored `test-results/`. For container checks, install Docker and OpenSSL, then:

```sh
docker build -t im-overdue:test .
npm run test:container -- im-overdue:test
```

CI runs application checks, XML/Compose validation and architecture-specific
container checks. The separate manual Release workflow checks the license,
version and source commit before publishing. See
[Publishing container images](#publishing-container-images).

## Localization checks

Run `npx vitest run tests/i18n.test.ts` for both catalog entries, matching
placeholders, English-first selection and blocked-storage handling. Keep technical
values and user text unchanged when adding translations.

Existing German browser regressions declare their language through
`tests/e2e/language-fixture.ts`. New default-language cases use no stored choice
(`appLanguage: null`); `tests/e2e/i18n.spec.ts` also checks a German browser receiving
the English default, persistence, live switching and export presentation. Run
`npm run build` before `npx playwright test tests/e2e/i18n.spec.ts`, and retain
both languages when changing labels or accessible names.

## Publishing container images

Publishing is manual only. Review the license terms and the
[required notices](../NOTICE) and make sure the intended changes are on `main`.
In GitHub Actions, open **Release → Run workflow**, select **main** and choose
`patch` (default), `minor` or `major`. Other branches and tags are rejected.
Ordinary pushes and pull requests run checks without publishing an image.

The workflow calculates the next version from the highest stable GitHub Release.
If none exists yet, it verifies the existing GHCR image `1.0.0` and uses it as
the baseline. The first `patch` release is then `1.0.1`. The workflow sets the npm
version metadata temporarily in the build checkout. No version edit or commit is
needed on `main`.

App, browser and AMD64/ARM64 container checks and the release build use the same
exact commit SHA. After the checks pass, the workflow creates `vX.Y.Z` at that
commit, publishes and verifies `ghcr.io/ill-yes/im-overdue:X.Y.Z`, then points
`:X.Y` and `:latest` to the same verified image digest before publishing the
GitHub Release.

If publishing stops after a version has been reserved, start a fresh run from
**Release → Run workflow** on **main**. It resumes the reserved version and SHA,
even if `main` has moved. A rerun for a source commit already published verifies
the release and exits without republishing. For recovery, do not rerun jobs from
the old **Publish container (manual)** workflow.

The [GHCR package](https://github.com/ill-yes/im-overdue/pkgs/container/im-overdue)
is public. Package visibility is separate from repository visibility; check the
package settings and verify public access with a Docker client without GHCR
credentials:

```sh
docker pull ghcr.io/ill-yes/im-overdue:X.Y.Z
```

Replace `X.Y.Z` with the published version. Verify that the intended users can
pull the image with the package's configured access permissions.

## Architecture and maintenance

The source/import layer uses `src/components/import/useImportFlow.ts` for input,
assignment, preview and result state, request versions and discard guards. The
four step views only render. `src/components/data-sources/` distinguishes typed
package pages, current evidence and immutable snapshots, keeping search,
pagination and lifecycle guards local. `src/download.ts` downloads approved
blobs; callers retain request, session and deletion guards.

Evidence identity is `(dataSourceId, external id)`; names are editable display
text. Schema upgrades assign legacy evidence atomically without inventing history.
Changed imports create snapshots and commit mixed targets in one revision;
unchanged imports preserve revision, history and Undo. Source, package and import
routes retain authentication, origin and concurrency protections. Language
switches must preserve source names, evidence, snapshots and pending drafts
without replaying writes.

The stack is React, TypeScript and Vite, Express, Node's `node:sqlite` and the
Temporal polyfill. Fonts are served locally; ordinary app use loads no external
fonts, analytics or third-party service APIs.

| Area | Responsibility |
| --- | --- |
| `src/App.tsx`, header and workspace components | Navigation, dialog sessions and mutations |
| `src/calendar/` | Week and month views, plus pure visible-week, marker and gesture models |
| `src/components/import/` | Preview rows, comparisons, summary and pure preview models |
| `server/app.ts` | App assembly: security, authentication, body limits and route registration |
| Route modules in `server/` (`blocks.ts`, `accounting.ts`, …) | One `register…Routes` function per area; writes go through `mutate()` in `state-changes.ts` |
| HTTP/security/validation helpers | Transactions, access checks and input errors |
| `shared/` | Time, calculations, import contracts, review, reuse and export rules |

Keep pointer control, focus and scrolling in calendar components; view models
must not change instants or dialog/gesture lifecycles. Keep import request/version
control in the import dialog. Mutations and undo validate the database revision;
late mutation errors belong to the initiating dialog instance and must not appear
in a newer draft.

The raw import limit is shared by browser and server: 5 MiB and 20,000 rows.
Preview and commit validate the same input; commit rechecks it inside its revision
transaction. Activity membership uses half-open intervals with nanosecond
precision; an event ending at midnight does not enter the following day.

Localization uses typed English/German catalogs without another runtime library.
English is the default, persisted in browser storage as `im-overdue-language`.
Do not infer it from the browser language or store it in SQLite. Translate
human-readable text and message keys, not technical route names, user content,
import fields or calculations. New keys must exist in both languages with matching
placeholders. Keep saved review objects, confirmation keys and undo entries intact.

The API adds `messageKey` and, where needed, `messageParams` for localized feedback.
The legacy German `message` field is generated from the German entry in
`shared/server-messages.ts`, so server code passes only the key and parameters.
Status codes and business codes remain compatible.
Translate visible errors from those identifiers rather than matching German text.
Changing language must not remount drafts, replay mutations or weaken session and
stale-response checks.

Before changing time, concurrency, authentication, permissions or release behavior,
run the relevant regression checks and obtain an independent review. Keep native
Unraid installation and registry access checks separate from local or emulated
test results.

## Next steps

- [Run with Docker or Unraid](docker.md)
- [Read the local import API](import-format.md#local-api)
- [Browse all documentation](README.md)
