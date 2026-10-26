import { translate, type Language } from './i18n.js';
import { timesheetMessages } from './timesheet-messages.js';
import { activeWeeks, dayTotals } from './calculations.js';
import { noteText } from './notes.js';
import { Temporal, datesInRange, dayBounds, localDate, localTimeWithOffset, offsetAt, weekStartFor } from './time.js';
import type { AppState, PeriodPart, PeriodSummary, TimesheetDay, TimesheetOptions, TimesheetSnapshot } from './types.js';

function summaryForDays(days: TimesheetDay[]): PeriodSummary {
  const empty = (): PeriodPart => ({ actualMinutes: 0, vacationMinutes: 0, targetMinutes: 0, balanceMinutes: 0, days: 0, weeks: [] });
  const summary = { confirmed: empty(), provisional: empty() };
  for (const day of days) {
    if (day.status === 'untouched') continue;
    const part = day.status === 'closed' ? summary.confirmed : summary.provisional;
    part.actualMinutes += day.totals.actualMinutes;
    part.vacationMinutes += day.totals.vacationMinutes;
    part.targetMinutes += day.totals.targetMinutes;
    part.balanceMinutes += day.totals.balanceMinutes;
    part.days++;
    const week = weekStartFor(day.date);
    if (!part.weeks.includes(week)) part.weeks.push(week);
  }
  return summary;
}

export function createTimesheetSnapshot(state: AppState, from: string, toExclusive: string, createdAt = Temporal.Now.instant().toString()): TimesheetSnapshot {
  const start = Temporal.PlainDate.from(from);
  const end = Temporal.PlainDate.from(toExclusive);
  const count = start.until(end).days;
  if (start.toString() !== from || end.toString() !== toExclusive || count <= 0 || count > 366) {
    throw new Error('Der Zeitraum muss zwischen einem und 366 Kalendertagen umfassen.');
  }
  const timezone = state.settings.timezone;
  const active = activeWeeks(state, localDate(createdAt, timezone));
  const closed = new Set(state.weeks.filter(week => week.status === 'closed').map(week => week.weekStart));
  const days: TimesheetDay[] = datesInRange(from, toExclusive).map(date => {
    const bounds = dayBounds(date, timezone);
    const lower = Temporal.Instant.from(bounds.start).epochNanoseconds;
    const upper = Temporal.Instant.from(bounds.end).epochNanoseconds;
    const blocks = state.blocks.flatMap(block => {
      const blockStart = Temporal.Instant.from(block.start).epochNanoseconds;
      const blockEnd = Temporal.Instant.from(block.end).epochNanoseconds;
      const a = blockStart > lower ? blockStart : lower;
      const b = blockEnd < upper ? blockEnd : upper;
      return b > a ? [{ start: Temporal.Instant.fromEpochNanoseconds(a).toString(), end: Temporal.Instant.fromEpochNanoseconds(b).toString(),
        title: block.title, note: block.note, minutes: Number(b - a) / 60_000_000_000 }] : [];
    }).sort((a, b) => Temporal.Instant.compare(a.start, b.start));
    const week = weekStartFor(date);
    return { date, status: closed.has(week) ? 'closed' : active.has(week) ? 'open' : 'untouched',
      blocks, totals: dayTotals(state, date), vacationFraction: state.vacations.find(vacation => vacation.date === date)?.fraction ?? 0,
      dayNote: noteText(state.notes, 'day', date), weekNote: noteText(state.notes, 'week', week) };
  });
  return { revision: state.revision, timezone, createdAt, from, to: toExclusive, days, summary: summaryForDays(days) };
}

export function filteredTimesheetDays(snapshot: TimesheetSnapshot, options: Pick<TimesheetOptions, 'closedOnly'>): TimesheetDay[] {
  return snapshot.days.filter(day => !options.closedOnly || day.status === 'closed');
}

export function timesheetSummary(snapshot: TimesheetSnapshot, options: Pick<TimesheetOptions, 'closedOnly'>): PeriodSummary {
  return summaryForDays(filteredTimesheetDays(snapshot, options));
}

/** Quote every text cell, and prevent spreadsheet formula evaluation of user text. */
function csvText(value: string): string {
  const safe = /^[\s\u0000-\u001f\u007f-\u009f]*[=+@-]/u.test(value) ? `'${value}` : value;
  return `"${safe.replace(/\r\n|\r|\n/g, '\r\n').replace(/"/g, '""')}"`;
}

function blockTime(block: TimesheetDay['blocks'][number], date: string, timezone: string): string {
  const boundary = dayBounds(date, timezone).end;
  const atMidnight = Temporal.Instant.compare(block.end, boundary) === 0;
  const end = atMidnight
    ? `24:00 ${offsetAt(Temporal.Instant.from(boundary).subtract({ nanoseconds: 1 }).toString(), timezone)}`
    : localTimeWithOffset(block.end, timezone);
  return `${localTimeWithOffset(block.start, timezone)}–${end}`;
}

export function timesheetCsv(snapshot: TimesheetSnapshot, options: TimesheetOptions, language: Language = 'en'): string {
  const t = (key: keyof typeof timesheetMessages) => translate(timesheetMessages, key, {}, language);
  const header = (['name', 'date', 'status', 'actualMinutes', 'vacationMinutes', 'targetMinutes', 'balanceMinutes', 'workingTimes'] as const).map(t);
  if (options.includeTitles) header.push(t('titles'));
  if (options.includeBlockNotes) header.push(t('blockNotes'));
  if (options.includeDayNotes) header.push(t('dayNote'));
  if (options.includeWeekNotes) header.push(t('weekNote'));
  const rows = [header.map(csvText).join(';')];
  for (const day of filteredTimesheetDays(snapshot, options)) {
    const text = (value: string) => csvText(value);
    const totals = day.totals;
    const row = [text(options.name), text(day.date), text(t(day.status)),
      String(totals.actualMinutes), String(totals.vacationMinutes), String(totals.targetMinutes), day.status === 'untouched' ? '' : String(totals.balanceMinutes),
      text(day.blocks.map(block => blockTime(block, day.date, snapshot.timezone)).join('\n'))];
    if (options.includeTitles) row.push(text(day.blocks.map(block => block.title).join('\n')));
    if (options.includeBlockNotes) row.push(text(day.blocks.map(block => block.note).join('\n')));
    if (options.includeDayNotes) row.push(text(day.dayNote));
    if (options.includeWeekNotes) row.push(text(day.weekNote));
    rows.push(row.join(';'));
  }
  const summary = timesheetSummary(snapshot, options);
  for (const [label, part] of [[t('confirmedTotal'), summary.confirmed], [t('provisionalTotal'), summary.provisional]] as const) {
    const row = [csvText(''), csvText(label), csvText(t('touchedDaysOnly')), String(part.actualMinutes), String(part.vacationMinutes),
      String(part.targetMinutes), String(part.balanceMinutes), csvText('')];
    while (row.length < header.length) row.push(csvText(''));
    rows.push(row.join(';'));
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
