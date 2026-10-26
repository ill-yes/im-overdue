import { describe, expect, it } from 'vitest';
import { parse } from 'csv-parse/sync';
import { periodSummary } from '../shared/calculations.js';
import { createTimesheetSnapshot, filteredTimesheetDays, timesheetCsv, timesheetSummary } from '../shared/timesheet.js';
import type { AppState, TimesheetOptions, WorkBlock } from '../shared/types.js';

function state(patch: Partial<AppState> = {}): AppState {
  return { revision: 9, undo: null, settings: { timezone: 'Europe/Berlin' },
    profiles: [{ id: 'initial', effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] }],
    dataSources: [], activities: [], blocks: [], weeks: [], notes: [], templates: [], recentEntries: [], vacations: [], vacationAllowances: [], ...patch };
}
const block = (start: string, end: string, title = '', note = ''): WorkBlock => ({ id: start, start, end, title, note, createdAt: null });
const options: TimesheetOptions = { includeTitles: false, includeBlockNotes: false, includeDayNotes: false, includeWeekNotes: false, closedOnly: false, name: '' };
const now = '2026-10-22T10:00:00Z';
const readCsv = (csv: string): Record<string, string>[] => parse(csv, { bom: true, columns: true, delimiter: ';' });

describe('timesheet snapshot', () => {
  it('captures all days and freezes values, splits midnight work and matches the reporting summary', () => {
    const s = state({ blocks: [block('2026-09-30T21:00:00Z', '2026-09-30T23:00:00Z', 'Night', 'Note')],
      vacations: [{ date: '2026-10-02', fraction: 0.5 }], weeks: [{ weekStart: '2026-09-28', status: 'closed' }],
      notes: [{ scope: 'day', date: '2026-10-01', text: 'Daily' }, { scope: 'week', date: '2026-09-28', text: 'Weekly' }] });
    const snapshot = createTimesheetSnapshot(s, '2026-10-01', '2026-10-05', now);
    expect(snapshot).toMatchObject({ revision: 9, timezone: 'Europe/Berlin', createdAt: now, from: '2026-10-01', to: '2026-10-05' });
    expect(snapshot.days).toHaveLength(4);
    expect(snapshot.days[0]).toMatchObject({ status: 'closed', blocks: [{ start: '2026-09-30T22:00:00Z', end: '2026-09-30T23:00:00Z', minutes: 60, title: 'Night', note: 'Note' }], dayNote: 'Daily', weekNote: 'Weekly' });
    expect(snapshot.days[1]).toMatchObject({ vacationFraction: 0.5, totals: { vacationMinutes: 240 } });
    expect(snapshot.summary).toEqual(periodSummary(s, '2026-10-01', '2026-10-05', '2026-10-22'));
    s.blocks[0].title = 'Changed';
    s.notes[0].text = 'Changed';
    s.vacations[0].fraction = 1;
    expect(snapshot.days[0].blocks[0].title).toBe('Night');
    expect(snapshot.days[0].dayNote).toBe('Daily');
    expect(snapshot.days[1].totals.vacationMinutes).toBe(240);
  });

  it('keeps pure future vacations untouched as of snapshot time, with no invented summary deficit', () => {
    const s = state({ vacations: [{ date: '2026-10-30', fraction: 1 }] });
    const snapshot = createTimesheetSnapshot(s, '2026-10-26', '2026-11-02', now);
    expect(snapshot.days.every(day => day.status === 'untouched')).toBe(true);
    expect(snapshot.summary).toEqual(periodSummary(s, snapshot.from, snapshot.to, '2026-10-22'));
    expect(snapshot.summary.provisional.days).toBe(0);
    const friday = readCsv(timesheetCsv(snapshot, options, 'de')).find(row => row.Datum === '2026-10-30');
    expect(friday?.['Saldo (Minuten)']).toBe('');
  });

  it('uses elapsed time on DST days, ordered clipped blocks and offset labels at 24:00', () => {
    const s = state({ blocks: [block('2026-10-25T01:30:00Z', '2026-10-25T23:00:00Z'), block('2026-10-24T22:00:00Z', '2026-10-25T00:30:00Z')] });
    const snapshot = createTimesheetSnapshot(s, '2026-10-25', '2026-10-26', now);
    expect(snapshot.days[0].totals.actualMinutes).toBe(1440);
    const csv = readCsv(timesheetCsv(snapshot, options, 'de'));
    expect(csv[0].Arbeitszeiten).toBe('00:00 +02:00–02:30 +02:00\r\n02:30 +01:00–24:00 +01:00');
  });

  it('accepts a leap year and rejects invalid, reversed and oversized date ranges', () => {
    expect(createTimesheetSnapshot(state(), '2028-01-01', '2029-01-01', now).days).toHaveLength(366);
    for (const [from, to] of [['2026-10-22', '2026-10-22'], ['2026-10-23', '2026-10-22'], ['2026-02-30', '2026-03-02'], ['2026-01-01', '2027-01-03']]) {
      expect(() => createTimesheetSnapshot(state(), from, to, now)).toThrow();
    }
  });
});

describe('timesheet csv', () => {
  it('defaults to English labels while preserving all machine values and user text across languages', () => {
    const s = state({ blocks: [block('2026-10-19T07:00:00.000000001Z', '2026-10-19T08:00:30Z', '=User title', 'Untranslated note')],
      weeks: [{ weekStart: '2026-10-19', status: 'closed' }], vacations: [{ date: '2026-10-19', fraction: 0.5 }],
      notes: [{ scope: 'day', date: '2026-10-19', text: 'User day' }, { scope: 'week', date: '2026-10-19', text: 'User week' }] });
    const snapshot = createTimesheetSnapshot(s, '2026-10-19', '2026-10-20', now);
    const selected = { ...options, name: '+User name', includeTitles: true, includeBlockNotes: true, includeDayNotes: true, includeWeekNotes: true };
    const english = timesheetCsv(snapshot, selected);
    const german = timesheetCsv(snapshot, selected, 'de');
    expect(english.startsWith('\uFEFF"Name";"Date";"Status";"Work (minutes)"')).toBe(true);
    const enRows = parse(english, { bom: true, delimiter: ';' }) as string[][];
    const deRows = parse(german, { bom: true, delimiter: ';' }) as string[][];
    expect(enRows[1][1]).toBe('2026-10-19');
    expect(enRows[1][2]).toBe('Confirmed');
    expect(deRows[1][2]).toBe('Bestätigt');
    expect(enRows[1].slice(3)).toEqual(deRows[1].slice(3));
    expect(enRows[1][0]).toBe("'+User name");
    expect(enRows[1][8]).toBe("'=User title");
    expect(enRows[2][1]).toBe('Confirmed total');
    expect(enRows[3][1]).toBe('Provisional total');
    expect(enRows[2].slice(3)).toEqual(deRows[2].slice(3));
    expect(english.replaceAll('\r\n', '')).not.toContain('\n');
  });
  it('keeps one row per day despite multiple blocks and exact numeric totals without counting intervals twice', () => {
    const s = state({ blocks: [block('2026-10-19T07:00:00Z', '2026-10-19T08:00:00Z', 'First'), block('2026-10-19T09:00:00Z', '2026-10-19T11:00:00Z', 'Second')],
      vacations: [{ date: '2026-10-19', fraction: 0.5 }], weeks: [{ weekStart: '2026-10-19', status: 'closed' }] });
    const snapshot = createTimesheetSnapshot(s, '2026-10-19', '2026-10-21', now);
    const csv = timesheetCsv(snapshot, { ...options, includeTitles: true }, 'de');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const rows = readCsv(csv);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ 'Ist (Minuten)': '180', 'Urlaub (Minuten)': '240', 'Soll (Minuten)': '480', 'Saldo (Minuten)': '-60', Titel: 'First\r\nSecond' });
    expect(rows[2]).toMatchObject({ Datum: 'Summe bestätigt', 'Ist (Minuten)': '180', 'Urlaub (Minuten)': '240', 'Soll (Minuten)': '960', 'Saldo (Minuten)': '-540' });
    expect(rows[3]).toMatchObject({ Datum: 'Summe vorläufig', 'Ist (Minuten)': '0' });
    expect(csv).toContain(';180;240;480;-60;');
  });

  it('protects spreadsheet formulas in every user field while leaving computed negative numbers numeric', () => {
    const s = state({ blocks: [block('2026-10-19T07:00:00Z', '2026-10-19T08:00:00Z', ' \t=HYPERLINK("x")', '\u0001+RUN;"quote"\nsecond')],
      notes: [{ scope: 'day', date: '2026-10-19', text: '\n@do' }, { scope: 'week', date: '2026-10-19', text: '-formula' }] });
    const snapshot = createTimesheetSnapshot(s, '2026-10-19', '2026-10-20', now);
    const csv = timesheetCsv(snapshot, { ...options, name: '\t=Name', includeTitles: true, includeBlockNotes: true, includeDayNotes: true, includeWeekNotes: true }, 'de');
    const row = readCsv(csv)[0];
    expect(row.Name).toBe("'\t=Name");
    expect(row.Titel).toBe("' \t=HYPERLINK(\"x\")");
    expect(row.Blocknotizen).toBe("'\u0001+RUN;\"quote\"\r\nsecond");
    expect(row.Tagesnotiz).toBe("'\r\n@do");
    expect(row.Wochennotiz).toBe("'-formula");
    expect(row['Saldo (Minuten)']).toBe('-420');
    expect(csv).toContain(';60;0;480;-420;');
    const omitted = readCsv(timesheetCsv(snapshot, options, 'de'))[0];
    expect(omitted).not.toHaveProperty('Titel');
    expect(omitted).not.toHaveProperty('Blocknotizen');
    expect(omitted).not.toHaveProperty('Tagesnotiz');
    expect(omitted).not.toHaveProperty('Wochennotiz');
  });

  it('filters closed days consistently in preview and totals, leaving provisional contribution zero', () => {
    const s = state({ weeks: [{ weekStart: '2026-10-12', status: 'closed' }, { weekStart: '2026-10-19', status: 'open' }] });
    const snapshot = createTimesheetSnapshot(s, '2026-10-12', '2026-10-27', now);
    const filtered = { ...options, closedOnly: true };
    expect(filteredTimesheetDays(snapshot, filtered)).toHaveLength(7);
    expect(timesheetSummary(snapshot, filtered).provisional.days).toBe(0);
    const rows = readCsv(timesheetCsv(snapshot, filtered, 'de'));
    expect(rows).toHaveLength(9);
    expect(rows.at(-2)).toMatchObject({ Datum: 'Summe bestätigt', 'Saldo (Minuten)': '-2400' });
    expect(rows.at(-1)).toMatchObject({ Datum: 'Summe vorläufig', 'Saldo (Minuten)': '0' });
  });
});
