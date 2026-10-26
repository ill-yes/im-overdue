# Using I'm Overdue

[English](usage.md) · [Deutsch](de/usage.md) · [Home](../README.md)

[Documentation](README.md) · [Usage](usage.md) · [Docker and Unraid](docker.md) · [Import format](import-format.md) · [Development](development.md)

Start with your settings and one working day. The sections below then guide
you through evidence, weekly review and exports. Importing activity is optional;
you can record work without it.

**On this page**

- [Language and initial setup](#language-and-initial-setup)
- [Record a working day](#record-a-working-day)
- [Navigate and review evidence](#navigate-and-review-evidence)
- [Named data sources and import history](#named-data-sources-and-import-history)
- [Import activity](#import-activity)
- [Templates and recent entries](#templates-and-recent-entries)
- [Annual leave and entitlement](#annual-leave-and-entitlement)
- [Notes and undo](#notes-and-undo)
- [Close weeks and read balances](#close-weeks-and-read-balances)
- [Export a timesheet](#export-a-timesheet)
- [Keep your data safe](#keep-your-data-safe)

## Language and initial setup

English is the default on first use, regardless of your browser language.
Choose **English / Deutsch** on the login page or in settings. The choice is
stored in this browser, not in the shared database. If browser storage is
unavailable, you can still switch language for the current visit.

Changing language updates labels, dates, numbers and visible messages without
signing you out or discarding an open draft. English uses `en-GB`, German uses
`de-DE`; both keep a 24-hour clock and Monday as the start of the week. Your time
zone, user-written text, imported content and saved calculations do not change.

In settings, check the IANA time zone, weekly hours and working days. A normal
target change starts next Monday. Correcting a past target is a separate action
that asks for confirmation before reopening affected closed weeks.

## Record a working day

1. Select a date in the calendar. **Today** uses the app's time zone.
2. Draw a work block with the left mouse button on the 15-minute grid.
3. Enter an activity title in quick entry and save with Enter, or choose a recent
   entry or template. Choosing an item from quick entry saves the drawn interval.
4. Click a block or use the time-entry button for precise times, notes or work
   crossing midnight. For touch and keyboard input, use this dialog.

Moving a block or dragging its edge saves immediately. Escape cancels an active
gesture. Blocks may not overlap. Breaks are gaps: 08:00–16:00 means eight hours
unless you leave a gap for a break. An entry spans at most seven local calendar
days, including any daylight-saving transition. When crossing midnight, explicitly
change the end date.

An exact gap between two blocks is clickable and opens quick entry without
saving. Tab/Enter and touch work too. The small-gaps menu makes narrow gaps
accessible. A click before the first or after the last block opens detailed time
entry. Evidence and leave never generate work blocks or fillable work gaps.

During a save, that dialog's inputs are disabled. Closing it does not cancel a
request already sent. A newly opened draft remains editable and can be saved once
the earlier request completes. Errors preserve your input; late responses do not
replace a newer draft. Changing language does not resend changes.

## Navigate and review evidence

The main views are calendar, time account and templates. Their existing routes
`#/kalender`, `#/zeitkonto` and `#/vorlagen` also support browser back/forward.
Switching views keeps the calendar date, filters and scroll position, selected
report period and template search. Unsaved template or leave-entitlement edits
need confirmation before being discarded; their own saves temporarily block navigation.

Switch between week and month to inspect daily work, target, balance, week
status and the number of filtered activities. Clicking a month day opens its
week. Adjacent-month days provide context but do not enter that month's totals.
Reloading returns to the week view without focus mode.

The week focus view enlarges the calendar and hides global navigation and
metrics. Calendar actions and undo remain available. Escape first closes a
popover/dialog or cancels a gesture, then leaves focus. Switching to month also
leaves focus.

Use a day heading or the day-review action to see evidence in chronological
order, with source, time and source link. Source filters apply here too; the title
search only filters the day list. Load the next 50 entries when needed. Show an
item in the calendar or open time entry for that date. Cross-midnight events are
marked; an event ending exactly at midnight does not belong to the following day.

## Named data sources and import history

In **Settings → Data sources**, create named sources for Google Calendar, Slack,
GitHub or Other. Several instances of a type are allowed, such as “Slack Work”
and “Slack Club”. The type stays fixed; renaming preserves evidence identity.

Source details separate **Import packages** from **Current evidence**, with search
and 50 items per page. Packages preserve normalized snapshots of submitted
evidence, including unchanged rows; later updates affect the current evidence
only. Raw input files are not retained. A wholly unchanged import creates no
package or revision and preserves Undo.

**Open in calendar** selects the earliest evidence date. Filters reset to all
configured sources on reload and never affect work, balances or week review.
For hidden sources, **Show source and open** reveals only that source; other
hidden sources stay hidden. Ordinary import navigation preserves filters.

Older databases and backups are migrated atomically at normal app startup:
existing evidence receives one default source per former type and remains
**without import history**. Historical packages are not invented.

Deleting a source requires confirmation with evidence and package counts and
removes its evidence and snapshots together. Work, notes, leave and week status
remain. Recovery requires a backup; working-time Undo cannot restore sources.
Packages cannot be deleted separately. Actual source changes and imports clear
the prior Undo; reading, filtering and unchanged saves do not.

## Import activity

Import a file, drag it into the dialog, or paste data. The two input methods
keep separate drafts. Downloads of the synthetic example files are available in
the dialog. The [import-format guide](import-format.md) defines accepted data.

Analyze the file, assign every contained type to a compatible named source, then
check the preview. Mixed files remain supported. **Import here** in source
details skips assignment for a file containing exactly that source's type;
the visible target can still be changed with **Edit assignment**. Leaving an
uncommitted file or text draft asks for confirmation; cancel preserves input and
assignments. Closing does not cancel a commit already started. After import,
**Back to source** opens its current evidence and history.

The preview shows sources, time span, errors and new, changed, unchanged or
duplicate entries. Times use the configured time zone and UTC offset. Changed
entries show the old and new values. All rows are available in pages of 50;
mobile layouts stack the comparison fields.

Review before confirming: invalid data prevents the entire import, and changes
since the preview require a new preview. The result stays open after import.
Open its period to jump to the earliest activity, including after an unchanged
import. Existing source filters remain in place; hidden imported sources are
listed. A file's time span does not prove a complete export. Activities never
start a work week, close a week or add recorded work.

## Templates and recent entries

Templates store an activity title, optional note and duration. A title is required
(up to 160 characters); notes allow up to 2,000 characters. Identical templates
are not duplicated. Creating or editing a template alone does not record work.

Quick selection searches templates, recent entries and separately listed older
entries. It copies the title and note. In a fresh detailed entry it also proposes
a duration; drawn, manually edited and existing intervals remain unchanged.
The explicit duration action applies the template duration from the resolved
start. Resolve an ambiguous local time first. Durations use elapsed time, even
across midnight or a clock change. Choosing an item in detailed selection does
not save the work entry.

Quick entry can pass its draft and entry time zone to detailed editing. Clicking
outside discards an unsaved quick draft. Escape closes selection first, then
quick entry, then focus. Nested detailed-entry views return one level with Back
or Escape; close and backdrop dismiss the entire entry after any necessary
unsaved-template confirmation.

Saving as a template together with work is atomic; saving only as a template
creates no work or edited week. Template edits never alter existing work blocks.
Concurrent changes are shown separately and overwriting requires confirmation.
A template's own save/delete temporarily prevents closing or going back.

Recent entries are the latest 20 distinct title/note/original-duration
combinations successfully created as new work, ordered by entry creation time.
Editing or deleting work does not change that list. Old blocks without a creation
time appear separately by work date; imports do not appear. Templates and recent
entries are included in SQLite backups.

## Annual leave and entitlement

Choose one day or a range of up to 366 calendar days, with full or half days.
Review individual days before saving: days with no target are skipped, and you
must deselect public holidays yourself. Existing leave can be removed for a range.

Leave is credit, not a work block:

**Daily balance = work + leave credit − target.**

A full leave day credits that day's target; a half day credits half, including
seconds if needed. Work on leave adds to that credit and is shown before
saving. Leave remains on its local date after time-zone changes. A changed
target profile also changes the credit. With a zero target, leave uses no
entitlement and gives no credit, but stays visible and removable.

Changes reopen affected closed weeks after confirmation and can be undone as
one action, restoring previous fractions and week status. Future weeks containing
only leave do not acquire a provisional deficit before they begin.

In **Time account → Leave account**, set each year's annual-leave entitlement and carryover
in whole or half days. Leave through today is taken; later leave is planned.
Both reduce the remaining amount. Without an entitlement, the remainder is
unknown. Negative remainders are allowed. There is no automatic carryover,
expiry, prorating, holiday or sickness treatment. Saving a changed entitlement
clears undo; unchanged values do not. Unsaved edits need confirmation when
changing year/view or closing.

## Notes and undo

Daily and weekly notes are separate from work-block notes, with up to 5,000
characters each. Clear and save to remove a note. They keep their local date
(or Monday for a week) after time-zone changes and do not affect hours or week
status. Notes can be added to closed and untouched weeks. Unsaved drafts need
confirmation; saves and stale-revision checks preserve input on error.

Undo restores exactly the latest successful work or leave change, including
all daily segments, IDs, title, notes, week status and, if created together, a
new template and recent-entry changes. It survives reload and app restart.
A new work/leave change replaces it. Other successful changes—imports,
closing weeks, settings, notes or separate template/entitlement changes—clear it.
Unchanged saves, failed requests, previews, navigation and downloads do not.
Revision checks prevent stale undo from overwriting another tab's work. There is
one undo step and no redo. **Ctrl/Cmd+Z** works outside dialogs, gestures and text inputs.

## Close weeks and read balances

Before closing a week, review past target days without work or full leave
credit, evidence outside work and days exceeding 12 actual working hours. The
review uses all sources, regardless of calendar filters. It provides guidance,
not automatic tracking or a legal assessment. Acknowledge warnings and, when
closing the current week early, its full target. The server rechecks the data and
warnings: a changed revision or new time-dependent warning requires fresh confirmation.

Closed weeks contribute confirmed balances. Started, open weeks remain
provisional; all their days are provisional until closure. Untouched weeks mean
missing data, not a zero balance. Deliberately closing an empty standard week
produces −40 hours. Months, quarters and years split boundary weeks by local day
and show confirmed and provisional results separately, with open weeks linked
back to the calendar.

The initial target applies to the entire history; later profiles begin on a
Monday. The default is 40 hours across Monday–Friday. Uneven minutes go to the
first working days. Work on a day with no target is positive credit. Negative
balances reduce positive ones. For example, 28 September–4 October 2026 with
work `9/8/10/8/7/2/0` hours and a 40-hour target gives +4 hours for the week,
+3 in September and +1 in October.

Times are stored as UTC instants; local days follow the configured time zone.
Actual elapsed time counts. Clock-change days can have 23 or 25 hours; repeated
local times must be explicitly resolved. Changing closed work reopens all affected
weeks atomically. Holidays, sickness and statutory breaks are not calculated
automatically. Closing a week is your personal confirmation, not employer approval.

## Export a timesheet

Open the timesheet from the selected time-account period, a week, or a custom
range of up to 366 days. Titles are included by default; work, day and week notes
are opt-in. An optional name applies only to this export. Only closed weeks are
included by default. The preview counts included and excluded days; with no days,
CSV and printing are disabled until you change the range or filter.

Preview, CSV and print share one frozen data snapshot, including revision and
time zone. Change the period or reopen the dialog to load new data. Language
follows the app selection without changing the underlying snapshot. Each day
lists work intervals with titles, work, leave, target and balance. Without the
closure filter, open days are provisional and untouched days unrecorded; the
latter have no confirmed balance. Confirmed/provisional totals stay separate.

Print opens the browser's A4 portrait dialog with 12 mm margins; use its PDF
option to save a file. A typical month with two short intervals per working day
fits one page at 100%. Long titles and selected notes wrap onto further pages
with repeated table headings. Durations use h:mm, adding seconds when needed;
clock-change times include unambiguous UTC offsets. The report is for information,
not an approval workflow.

CSV uses UTF-8 with BOM and semicolons. Duration values are numeric minutes,
including half minutes where needed. ISO dates, numeric format and column order
remain stable across languages; human-readable labels follow the app. User input
is protected against spreadsheet-formula interpretation. Check notes and the
preview before sharing: exports may contain private information and are generated
locally, without sending data to another service.

## Keep your data safe

Download a consistent SQLite snapshot in settings. It includes work, evidence,
targets, time zone, week status, notes, leave, entitlements, templates, recent
entries and any pending undo, which can include earlier notes. It does not contain
the login password or sessions. Copying only the running main database file is
not a consistent backup because SQLite uses WAL. There is no file encryption or
cloud backup.

For Docker/Unraid, follow [offline restore](docker.md#backup-and-offline-restore).
For local Node operation:

1. Stop the app and every process using the database.
2. Move the entire old data directory, including WAL/SHM files, to a safe different
   location and keep it.
3. Create a fresh directory and put the downloaded snapshot there as
   `im-overdue.sqlite`. Do not add the old WAL/SHM files.
4. Restart and check time zone, targets, a working week and its balance. Adapt the
   path if you set `IM_OVERDUE_DB`.

The default local database is `data/im-overdue.sqlite`. Never run two processes
against the same database. Existing databases gain the necessary empty tables
on startup without inventing creation times for old entries. Keep a backup before
updates and retain the original until the restored app has been checked.

## Next steps

- [Prepare an optional activity import](import-format.md)
- [Run with Docker or Unraid](docker.md)
- [Browse all documentation](README.md)
