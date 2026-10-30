import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'csv-parse/sync';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accountCsv, accountExportRows, createTimesheetSnapshot, timesheetCsv } from '../shared/timesheet.js';
import { accountPeriod } from '../shared/accounting.js';
import type { AppState, TimesheetOptions } from '../shared/types.js';
import { TimesheetDocument } from '../src/components/TimesheetDocument.js';
import type { Messages, MessageParams } from '../shared/i18n.js';

const renderLanguage = vi.hoisted(() => ({ value: 'en' as 'en' | 'de' }));
vi.mock('../src/i18n.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/i18n.js')>();
  return { ...actual, useMessages: (catalog: Messages) => ({
    ...actual.useMessages(catalog), language: renderLanguage.value,
    locale: actual.languageLocale(renderLanguage.value),
    t: (key: string, params?: MessageParams) => actual.translate(catalog, key, params, renderLanguage.value),
  }) };
});
afterEach(() => { renderLanguage.value = 'en'; });

const now = '2026-10-21T22:30:00Z'; // October 22 in the app time zone.
const options: TimesheetOptions = { includeTitles: true, includeBlockNotes: true, includeDayNotes: true, includeWeekNotes: true, closedOnly: false, name: '=Employee' };
const read = (value: string): string[][] => parse(value, { bom: true, delimiter: ';' });
const numericCells = (row: string): string[] => [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(cell => cell[1]).slice(-4);
const dayRow = (html: string, date: string): string => html.match(new RegExp(`<tr[^>]*data-timesheet-day="${date}"[^>]*>(.*?)</tr>`, 's'))![1];
function state(patch: Partial<AppState> = {}): AppState {
  return { revision: 12, undo: null, settings: { timezone: 'Europe/Berlin' },
    profiles: [{ id: 'profile', effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] }],
    dataSources: [], activities: [], blocks: [], weeks: [{ weekStart: '2026-10-19', status: 'closed' }],
    notes: [], templates: [], recentEntries: [], vacations: [], vacationAllowances: [],
    accountOpening: { date: '2026-10-19', minutes: 600 }, accountEntries: [], absences: [], holidayProfiles: [], holidayOverrides: [], ...patch };
}

describe('accounting exports', () => {
  it.each(['en', 'de'] as const)('prints effective credits and reconciled totals without crediting compensation in %s', language => {
    renderLanguage.value = language;
    const source = state({
      holidayOverrides: [{ date: '2026-10-19', name: 'Regional holiday' }],
      vacations: [{ date: '2026-10-19', fraction: 1 }, { date: '2026-10-20', fraction: 1 }],
      absences: [{ date: '2026-10-21', sickness: true, compensation: { mode: 'fraction', value: 0.5 } }],
    });
    const snapshot = createTimesheetSnapshot(source, '2026-10-19', '2026-10-22', now);
    const csv = timesheetCsv(snapshot, options, language);
    // Editing the live source cannot change the document's captured credit values.
    source.vacations = [];
    source.absences = [];
    source.holidayOverrides = [];
    const html = renderToStaticMarkup(createElement(TimesheetDocument, { snapshot, options }));
    expect(html).toContain(`<th scope="col">${language === 'en' ? 'Credits' : 'Gutschriften'}</th>`);
    expect(numericCells(dayRow(html, '2026-10-19'))).toEqual(['0:00', '8:00', '8:00', '0:00']);
    expect(numericCells(dayRow(html, '2026-10-20'))).toEqual(['0:00', '8:00', '8:00', '0:00']);
    expect(numericCells(dayRow(html, '2026-10-21'))).toEqual(['0:00', '4:00', '8:00', '−4:00']);
    expect(numericCells(html.match(/<tfoot>(.*?)<\/tfoot>/s)![1])).toEqual(['0:00', '20:00', '24:00', '−4:00']);
    expect(html).toContain(language === 'en'
      ? 'Credits: leave 8:00 · sickness 4:00 · public holidays 8:00'
      : 'Gutschriften: Urlaub 8:00 · Krankheit 4:00 · Feiertage 8:00');
    expect(html).toContain(language === 'en' ? 'Time off in lieu reduces the balance.' : 'Freizeitausgleich mindert den Saldo.');
    expect(dayRow(html, '2026-10-21')).toContain(language === 'en' ? 'Time off in lieu' : 'Freizeitausgleich');
    expect(timesheetCsv(snapshot, options, language)).toBe(csv);
    expect(read(csv)[0][4]).toBe(language === 'en' ? 'Leave (minutes)' : 'Urlaub (Minuten)');
    expect(read(csv)[1].slice(3, 7)).toEqual(['0', '0', '480', '0']);
  });

  it('separates closed and provisional credit totals and filters the printed breakdown', () => {
    const snapshot = createTimesheetSnapshot(state({
      holidayOverrides: [{ date: '2026-10-19', name: 'Regional holiday' }],
      weeks: [{ weekStart: '2026-10-19', status: 'closed' }, { weekStart: '2026-10-26', status: 'open' }],
      absences: [{ date: '2026-10-26', sickness: true, compensation: null }],
    }), '2026-10-19', '2026-10-27', now);
    const html = renderToStaticMarkup(createElement(TimesheetDocument, { snapshot, options }));
    const totals = [...html.match(/<tfoot>(.*?)<\/tfoot>/s)![1].matchAll(/<tr>(.*?)<\/tr>/gs)];
    expect(totals.map(row => numericCells(row[1])[1])).toEqual(['8:00', '8:00']);
    expect(totals[0][1]).toContain('sickness 0:00 · public holidays 8:00');
    expect(totals[1][1]).toContain('sickness 8:00 · public holidays 0:00');
    const closed = renderToStaticMarkup(createElement(TimesheetDocument, { snapshot, options: { ...options, closedOnly: true } }));
    expect(closed).not.toContain('data-timesheet-day="2026-10-26"');
    expect(closed).not.toContain('sickness 8:00');
    expect(numericCells(closed.match(/<tfoot>(.*?)<\/tfoot>/s)![1])[1]).toBe('8:00');
  });

  it('falls back to captured vacation totals in legacy snapshots without accounting details', () => {
    const snapshot = createTimesheetSnapshot(state({ vacations: [{ date: '2026-10-19', fraction: 0.5 }] }), '2026-10-19', '2026-10-20', now);
    delete snapshot.account;
    delete snapshot.days[0].accounting;
    const html = renderToStaticMarkup(createElement(TimesheetDocument, { snapshot, options }));
    expect(numericCells(dayRow(html, '2026-10-19'))).toEqual(['0:00', '4:00', '8:00', '−4:00']);
    expect(numericCells(html.match(/<tfoot>(.*?)<\/tfoot>/s)![1])).toEqual(['0:00', '4:00', '8:00', '−4:00']);
    expect(html).toContain('Credits: leave 4:00 · sickness 0:00 · public holidays 0:00');
  });

  it('keeps balances unknown in an entirely future period and dates a current ending at the actual as-of day', () => {
    const source = state({ weeks: [] });
    const future = createTimesheetSnapshot(source, '2026-11-01', '2026-12-01', now);
    expect(future.account).toMatchObject({ startMinutes: null, endMinutes: null, movements: [] });
    expect(accountExportRows(future).find(row => row.kind === 'endBalance')?.minutes).toBeNull();
    const futureDocument = renderToStaticMarkup(createElement(TimesheetDocument, { snapshot: future, options: { ...options, includeAccount: true } }));
    expect(futureDocument).toContain('This period has not started yet.');
    expect(futureDocument).not.toContain('No opening balance is effective yet.');
    const current = createTimesheetSnapshot(source, '2026-10-01', '2026-11-01', now);
    expect(accountExportRows(current).find(row => row.kind === 'endBalance')).toMatchObject({ date: '2026-10-22', minutes: 600 });
    expect(accountExportRows(current).filter(row => row.status === 'closed').every(row => row.date <= '2026-10-22')).toBe(true);
  });
  it('captures accounting and the account period at the same revision and local as-of date without aliases', () => {
    const source = state({ accountEntries: [{ id: 'correction', date: '2026-10-20', kind: 'correction', minutes: 30, reason: 'Original' }],
      holidayOverrides: [{ date: '2026-10-19', name: 'Local holiday' }] });
    const snapshot = createTimesheetSnapshot(source, '2026-10-19', '2026-10-27', now);
    expect(snapshot.account).toEqual(accountPeriod(source, snapshot.from, snapshot.to, '2026-10-22'));
    expect(snapshot.revision).toBe(12);
    expect(snapshot.days[0].accounting).toMatchObject({ holidayMinutes: 480, holiday: { name: 'Local holiday' } });
    source.accountOpening!.minutes = 2000;
    source.accountEntries![0].reason = 'Changed';
    source.holidayOverrides![0].name = 'Changed';
    expect(snapshot.account!.opening!.minutes).toBe(600);
    expect(snapshot.account!.movements.find(row => row.kind === 'correction')!.reason).toBe('Original');
    expect(snapshot.days[0].accounting!.holiday!.name).toBe('Local holiday');
  });

  it('appends absence columns after every original optional column, with exact filtered totals', () => {
    const snapshot = createTimesheetSnapshot(state({
      holidayOverrides: [{ date: '2026-10-19', name: '=Holiday' }],
      absences: [{ date: '2026-10-20', sickness: true, compensation: { mode: 'fraction', value: 0.5 } }],
    }), '2026-10-19', '2026-10-21', now);
    const en = read(timesheetCsv(snapshot, options));
    const de = read(timesheetCsv(snapshot, options, 'de'));
    expect(en[0].slice(0, 12)).toEqual(['Name', 'Date', 'Status', 'Work (minutes)', 'Leave (minutes)', 'Target (minutes)', 'Balance (minutes)', 'Working times', 'Titles', 'Block notes', 'Day note', 'Week note']);
    expect(en[0].slice(12)).toEqual(['Holiday (minutes)', 'Sickness (minutes)', 'Time off in lieu (minutes)', 'Uncovered (minutes)']);
    expect(en[1].slice(12)).toEqual(['480', '0', '0', '0']);
    expect(en[2].slice(12)).toEqual(['0', '240', '240', '0']);
    expect(en[3].slice(12)).toEqual(['480', '240', '240', '0']);
    expect(en[1][0]).toBe("'=Employee");
    expect(en[1].slice(3)).toEqual(de[1].slice(3));
    expect(de[0].slice(12)).toEqual(['Feiertag (Minuten)', 'Krankheit (Minuten)', 'Freizeitausgleich (Minuten)', 'Ungedeckt (Minuten)']);
    expect(read(timesheetCsv(snapshot, { ...options, includeTitles: false, includeBlockNotes: false, includeDayNotes: false, includeWeekNotes: false }))[0]).toHaveLength(12);
  });

  it('separates confirmed, provisional and future movements and preserves CSV formula safety', () => {
    const snapshot = createTimesheetSnapshot(state({
      accountEntries: [
        { id: 'past', date: '2026-10-20', kind: 'payout', minutes: -60, reason: '\t=SUM(1;2)\n"Pay"' },
        { id: 'future', date: '2026-10-26', kind: 'correction', minutes: 90, reason: 'Future' },
      ], absences: [{ date: '2026-10-26', sickness: false, compensation: { mode: 'minutes', value: 120 } }],
    }), '2026-10-19', '2026-10-28', now);
    const rows = accountExportRows(snapshot);
    expect(rows.find(row => row.kind === 'payout')).toMatchObject({ status: 'closed', minutes: -60 });
    expect(rows.find(row => row.kind === 'correction')).toMatchObject({ status: 'planned', minutes: 90 });
    expect(rows.find(row => row.kind === 'plannedCompensation')).toMatchObject({ status: 'planned', minutes: 120 });
    expect(rows.find(row => row.kind === 'plannedEntries')).toMatchObject({ status: 'planned', minutes: 90 });
    const en = read(accountCsv(snapshot));
    const de = read(accountCsv(snapshot, 'de'));
    expect(en[0]).toEqual(['Date', 'Entry type', 'Status', 'Time account (minutes)', 'Reason', 'As of']);
    const payout = en.find(row => row[1] === 'Payout')!;
    expect(payout[3]).toBe('-60');
    expect(payout[4]).toBe("'\t=SUM(1;2)\r\n\"Pay\"");
    expect(en.find(row => row[1] === 'Correction')![2]).toBe('Planned');
    expect(de.find(row => row[1] === 'Korrektur')![2]).toBe('Geplant');
    expect(en.every(row => row.length === 6)).toBe(true);
    expect(accountCsv(snapshot)).not.toContain('Work (minutes)');
    const confirmed = rows.filter(row => row.status === 'closed' && !['startBalance', 'endBalance'].includes(row.kind)).reduce((sum, row) => sum + row.minutes!, 0);
    expect(snapshot.account!.endMinutes).toBe(snapshot.account!.startMinutes! + confirmed);
  });

  it('uses the selected historical range, excludes other entries and retains explicit zero and unknown balances', () => {
    const snapshot = createTimesheetSnapshot(state({ accountOpening: { date: '2026-10-01', minutes: 0 }, weeks: [],
      accountEntries: [{ id: 'before', date: '2026-10-02', kind: 'correction', minutes: 100, reason: 'Earlier' },
        { id: 'inside', date: '2026-10-06', kind: 'payout', minutes: -100, reason: 'Inside' },
        { id: 'after', date: '2026-10-15', kind: 'correction', minutes: 900, reason: 'Later' }],
    }), '2026-10-05', '2026-10-12', now);
    expect(snapshot.account).toMatchObject({ startMinutes: 100, endMinutes: 0, asOf: '2026-10-11' });
    expect(accountCsv(snapshot)).not.toContain('Earlier');
    expect(accountCsv(snapshot)).not.toContain('Later');
    expect(read(accountCsv(snapshot)).find(row => row[1] === 'Confirmed ending balance')![3]).toBe('0');
    const missing = createTimesheetSnapshot(state({ accountOpening: null }), '2026-10-19', '2026-10-20', now);
    expect(read(accountCsv(missing))[1][3]).toBe('');
    expect(accountExportRows(missing)[0].minutes).toBeNull();
  });

  it('prints effective absence details and an opt-in account section, including planned and no-opening states', () => {
    const snapshot = createTimesheetSnapshot(state({ holidayOverrides: [{ date: '2026-10-19', name: 'Regional holiday' }],
      absences: [{ date: '2026-10-26', sickness: false, compensation: { mode: 'fraction', value: 0.5 } }],
    }), '2026-10-19', '2026-10-27', now);
    const normal = renderToStaticMarkup(createElement(TimesheetDocument, { snapshot, options }));
    expect(normal).toContain('Regional holiday');
    expect(normal).toContain('Planned absence');
    expect(normal).not.toContain('timesheet-account-table');
    const included = renderToStaticMarkup(createElement(TimesheetDocument, { snapshot, options: { ...options, includeAccount: true } }));
    expect(included).toContain('timesheet-account-table');
    expect(included).toContain('Confirmed ending balance');
    expect(included).toContain('Planned time off in lieu');
    const missing = createTimesheetSnapshot(state({ accountOpening: null }), '2026-10-19', '2026-10-20', now);
    expect(renderToStaticMarkup(createElement(TimesheetDocument, { snapshot: missing, options: { ...options, includeAccount: true } }))).toContain('No opening balance is effective yet');
  });

  it('keeps future openings planned and excludes open-day absence totals under the closed-only filter', () => {
    const snapshot = createTimesheetSnapshot(state({
      accountOpening: { date: '2026-10-26', minutes: 0 },
      weeks: [{ weekStart: '2026-10-19', status: 'open' }],
      absences: [{ date: '2026-10-20', sickness: true, compensation: null }],
    }), '2026-10-19', '2026-10-28', now);
    expect(accountExportRows(snapshot).find(row => row.kind === 'opening')).toMatchObject({ status: 'planned', minutes: 0 });
    expect(snapshot.account!.endMinutes).toBeNull();
    const filtered = read(timesheetCsv(snapshot, { ...options, closedOnly: true }));
    expect(filtered).toHaveLength(3);
    expect(filtered[1].slice(-4)).toEqual(['0', '0', '0', '0']);
    expect(filtered[2].slice(-4)).toEqual(['0', '0', '0', '0']);
  });
});
