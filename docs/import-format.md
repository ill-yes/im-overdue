# Activity import format (version 1)

[English](import-format.md) · [Deutsch](de/import-format.md) · [Home](../README.md)

[Documentation](README.md) · [Usage](usage.md) · [Docker and Unraid](docker.md) · [Import format](import-format.md) · [Development](development.md)

Use this reference to prepare files for import. For the workflow in the app,
see [Usage](usage.md).

Import normalized activities from your own exporters. The app does not read
arbitrary native Slack, GitHub or calendar exports, connect to their APIs or
hold their credentials. Activities are evidence; only manually recorded entries
count as working time. The technical format is the same in both app languages.

**On this page**

- [JSON](#json)
- [CSV](#csv)
- [Preview and update rules](#preview-and-update-rules)
- [Limits and examples](#limits-and-examples)
- [Local API](#local-api)
- [Exporter checklist](#exporter-checklist)

## JSON

Use UTF-8 and an object containing `schemaVersion: 1` and an `activities` array:

```json
{
  "schemaVersion": 1,
  "activities": [
    {
      "source": "slack",
      "id": "workspace-id:channel-id:message-ts",
      "start": "2026-10-01T09:15:00+02:00",
      "end": null,
      "title": "Message sent",
      "url": null
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `source` | `google_calendar`, `slack`, `github` or `other` |
| `id` | Stable ID, unique within the source |
| `start` | ISO-8601 timestamp **with an offset or Z**, never just a local date/time |
| `end` | Optional/null; if present, strictly later than `start` |
| `title` | Non-empty display text, not HTML |
| `url` | Optional/null; absolute HTTP/HTTPS URL only |

Include the origin in IDs: Slack workspace + channel + message ID, GitHub
repository + activity type + ID, or Google calendar ID + event ID. Recurring
events need a separate stable ID for each occurrence.

Timestamps are normalized to UTC and displayed in the configured IANA time zone.
Cross-midnight events appear on the affected days. Your exporter decides whether
an all-day event makes sense as time-bounded evidence; it never becomes work automatically.

## CSV

Use UTF-8, a comma separator and this header:

```csv
source,id,start,end,title,url
slack,workspace:channel:001,2026-10-01T09:15:00+02:00,,Message sent,
google_calendar,calendar:meeting:001,2026-10-01T10:00:00+02:00,2026-10-01T11:00:00+02:00,"Team, sync",
```

Empty optional fields mean `null`. Quote values containing commas, line breaks
or quotes using normal CSV rules; double a quote within a quoted field. CSV
implicitly uses schema version 1. This comma-separated import format differs
from the semicolon-separated [timesheet export](usage.md#export-a-timesheet).

## Preview and update rules

1. Select a file or paste data, analyze the contained source types and assign
   each type to an existing named data source. Then check the preview.
2. Saving is atomic and requires explicit confirmation.
3. For an existing `(dataSourceId, id)`, identical values stay unchanged;
   different values update the entry. Activities absent from the file are retained.
4. Identical duplicates within a file are combined. Conflicting duplicates block
   the entire import.
5. Invalid rows block the entire import: there is no silent partial import.
   A database change after preview requires a fresh preview.

The file's `source` remains the technical type, not the editable source name.
A mixed file assigns each type to exactly one compatible source. Separate Slack
sources may contain the same external IDs. Names never act as keys, and ID
prefixes do not determine assignments.

A mixed import commits all changed sources in one revision. Only sources with
new or updated evidence receive a package. Its immutable snapshot contains all
deduplicated submitted evidence for that source, including unchanged rows.
A wholly unchanged import creates no package, performs no write, advances no
revision and preserves Undo.

## Limits and examples

Limits are **5 MiB of raw input** and **20,000 rows per import**. Split large
histories into several files and import them one after another.

[examples/activities.json](../examples/activities.json) and
[examples/activities.csv](../examples/activities.csv) contain the same 13
**synthetic** activities for 28 September–4 October 2026. Importing both in
sequence creates no duplicate evidence. The app never loads them automatically.

## Local API

The file format and `schemaVersion: 1` are unchanged. The HTTP envelope for
`POST /api/import/analyze`, `/api/import/preview` and `/api/import/commit` is:

```json
{
  "format": "json",
  "text": "{\"schemaVersion\":1,\"activities\":[]}",
  "assignments": { "slack": "ID-of-existing-Slack-source" },
  "fileName": "slack-export.json"
}
```

Analyze needs only `format` and `text` and never writes. Preview returns the
`revision` that commit must submit as `expectedRevision`. Explicit assignments
must map every contained type to an existing source of that type. The optional
file name defaults to the localized pasted-data label.

Legacy calls without assignments use a unique existing source or a default
source for each type; multiple matching sources require explicit assignment.
Preview never creates sources. Any required default sources are created only
by a successful commit.

Create sources through `POST /api/data-sources` with `type`, `name` and
`expectedRevision`. `PUT /api/data-sources/:id` only renames;
`DELETE /api/data-sources/:id` removes the source, its evidence and packages.
Both also require `expectedRevision`. AppState includes `dataSources` with
counts and period metadata; activities additionally carry `dataSourceId`.

`GET /api/data-sources/:id/activities`, `/api/data-sources/:id/packages` and
`GET /api/import-packages/:id` return 50-item pages. `page` starts at zero;
`q` searches evidence by title/ID/URL or packages by filename. Existing
host/origin and session rules apply. Package contents are not in AppState.

## Exporter checklist

- Export only the desired user's actions, such as sent rather than received
  messages. The app does not verify service-user identities.
- Omit tokens, credentials and unnecessary full message contents.
- Evidence preserves second-precision timestamps. Manual time entry and balances
  do not infer continuous work between evidence points.
- Never convert the time between two activities into work automatically.

## Next steps

- [Import activity in the app](usage.md#import-activity)
- [Run and check the app locally](development.md)
- [Browse all documentation](README.md)
