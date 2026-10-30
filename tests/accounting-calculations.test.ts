import { describe, expect, it } from 'vitest';
import { accountPeriod, accountSummary } from '../shared/accounting.js';
import { activeWeeks, dayAccounting, dayTotals, periodSummary } from '../shared/calculations.js';
import { vacationAccount } from '../shared/vacations.js';
import { weekReview } from '../shared/week-review.js';
import { instantAtMinute } from '../shared/time.js';
import type { AppState } from '../shared/types.js';

const date = '2026-09-28';
function state(): AppState {
  return { revision: 0, undo: null, settings: { timezone: 'Europe/Berlin' }, dataSources: [], activities: [],
    profiles: [{ id: 'default', effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] }],
    blocks: [], templates: [], recentEntries: [], weeks: [], notes: [], vacations: [], vacationAllowances: [],
    accountOpening: null, accountEntries: [], absences: [], holidayProfiles: [], holidayOverrides: [] };
}
function work(s: AppState, day: string, minutes: number, offset = 480) {
  s.blocks.push({ id: `${day}-${offset}`, title: '', note: '', createdAt: null,
    start: instantAtMinute(day, offset, s.settings.timezone), end: instantAtMinute(day, offset + minutes, s.settings.timezone) });
}

describe('combined absence accounting', () => {
  it('fills only remaining target with sickness after real work', () => {
    const s = state(); work(s, date, 120); s.absences = [{ date, sickness: true, compensation: null }];
    expect(dayAccounting(s, date)).toMatchObject({ actualMinutes: 120, sicknessMinutes: 360, balanceMinutes: 0, uncoveredMinutes: 0 });
    work(s, date, 420, 600);
    expect(dayAccounting(s, date)).toMatchObject({ actualMinutes: 540, sicknessMinutes: 0, balanceMinutes: 60 });
  });
  it('respects the explicit vacation/compensation/sickness split', () => {
    const s = state(); s.vacations = [{ date, fraction: 0.5 }]; s.absences = [{ date, sickness: true, compensation: { mode: 'minutes', value: 120 } }];
    expect(dayAccounting(s, date)).toMatchObject({ vacationMinutes: 240, sicknessMinutes: 120, compensationMinutes: 120, balanceMinutes: -120, uncoveredMinutes: 0 });
    expect(dayTotals(s, date)).toEqual({ actualMinutes: 0, targetMinutes: 480, vacationMinutes: 240, balanceMinutes: -120 });
  });
  it('deducts a compensatory day only once and reports any unallocated shortfall', () => {
    const s = state(); s.absences = [{ date, sickness: false, compensation: { mode: 'fraction', value: 1 } }];
    expect(dayAccounting(s, date)).toMatchObject({ compensationMinutes: 480, balanceMinutes: -480, uncoveredMinutes: 0 });
    s.absences[0].compensation = { mode: 'minutes', value: 120 }; work(s, date, 240);
    expect(dayAccounting(s, date)).toMatchObject({ compensationMinutes: 120, balanceMinutes: -240, uncoveredMinutes: 120 });
    expect(weekReview(s, date, '2026-09-29T18:00:00Z').warnings).toContainEqual(expect.objectContaining({ date, kind: 'missing' }));
  });
  it('caps effective compensation without losing the stored request', () => {
    const s = state(); work(s, date, 420); s.absences = [{ date, sickness: true, compensation: { mode: 'fraction', value: 1 } }];
    expect(dayAccounting(s, date)).toMatchObject({ compensationRequestedMinutes: 480, compensationMinutes: 60, sicknessMinutes: 0, balanceMinutes: -60 });
    expect(s.absences[0].compensation).toEqual({ mode: 'fraction', value: 1 });
  });
  it('suspends other absences on a holiday, preserves them and restores vacation entitlement', () => {
    const s = state(); s.vacations = [{ date, fraction: 1 }]; s.vacationAllowances = [{ year: 2026, entitlementDays: 30, carryoverDays: 0 }];
    s.absences = [{ date, sickness: true, compensation: { mode: 'fraction', value: 1 } }];
    s.holidayOverrides = [{ date, name: 'Local holiday' }]; work(s, date, 90);
    expect(dayAccounting(s, date)).toMatchObject({ holidayMinutes: 480, vacationMinutes: 0, vacationFraction: 0, sicknessMinutes: 0, compensationMinutes: 0, balanceMinutes: 90 });
    expect(vacationAccount(s, 2026, date)).toMatchObject({ takenDays: 0, remainingDays: 30 });
    s.holidayOverrides = [];
    expect(vacationAccount(s, 2026, date)).toMatchObject({ takenDays: 1, remainingDays: 29 });
    expect(s.absences).toHaveLength(1);
  });
  it('does not activate untouched weeks for holidays or future absences', () => {
    const s = state(); s.holidayProfiles = [{ id: 'h', effectiveFrom: '2026-01-01', region: 'BE', ruleVersion: 1 }];
    s.holidayOverrides = [{ date, name: 'Holiday' }];
    s.absences = [{ date: '2026-10-05', sickness: true, compensation: null }];
    expect(activeWeeks(s, date).size).toBe(0);
    expect(periodSummary(s, '2026-09-01', '2026-10-01', date).confirmed.days).toBe(0);
  });
  it('uses fractional target precision and zero-target days without creating credit', () => {
    const s = state(); s.profiles[0].weeklyMinutes = 2401; s.vacations = [{ date, fraction: 0.5 }];
    s.absences = [{ date, sickness: true, compensation: { mode: 'minutes', value: 120 } }];
    expect(dayAccounting(s, date)).toMatchObject({ targetMinutes: 481, vacationMinutes: 240.5, sicknessMinutes: 120.5, balanceMinutes: -120 });
    s.holidayOverrides = [{ date: '2026-10-03', name: 'Holiday' }];
    expect(dayAccounting(s, '2026-10-03')).toMatchObject({ targetMinutes: 0, holidayMinutes: 0, balanceMinutes: 0 });
  });
});

describe('dated hours account', () => {
  it('has no implicit opening and keeps period reports independent of the account', () => {
    const s = state(); work(s, date, 540); s.weeks = [{ weekStart: date, status: 'closed' }];
    expect(accountSummary(s, '2026-10-04').confirmedMinutes).toBeNull();
    expect(periodSummary(s, date, '2026-10-05').confirmed.balanceMinutes).toBe(-1860);
  });
  it('reconciles +18 opening, +4 closed work and -8 payout as +14 hours', () => {
    const s = state(); s.accountOpening = { date, minutes: 1080 }; s.weeks = [{ weekStart: date, status: 'closed' }];
    for (const day of ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']) work(s, day, 480);
    work(s, '2026-10-02', 720);
    s.accountEntries = [{ id: 'pay', date: '2026-10-02', kind: 'payout', minutes: -480, reason: 'Paid out' }];
    expect(accountSummary(s, '2026-10-04')).toMatchObject({ confirmedMinutes: 840, closedMinutes: 240, entryMinutes: -480, provisionalMinutes: 0 });
    expect(periodSummary(s, date, '2026-10-05').confirmed.balanceMinutes).toBe(240);
  });
  it('applies a midweek cutoff inclusively, keeps excluded entries, and separates open work', () => {
    const s = state(); s.accountOpening = { date: '2026-09-30', minutes: 60 }; s.weeks = [{ weekStart: date, status: 'closed' }, { weekStart: '2026-10-05', status: 'open' }];
    work(s, date, 600); work(s, '2026-09-30', 540); work(s, '2026-10-01', 480); work(s, '2026-10-02', 480); work(s, '2026-10-05', 420);
    s.accountEntries = [{ id: 'old', date, kind: 'correction', minutes: 999, reason: 'excluded' }, { id: 'today', date: '2026-10-05', kind: 'correction', minutes: -30, reason: 'accepted' }];
    expect(accountSummary(s, '2026-10-05')).toMatchObject({ confirmedMinutes: 90, closedMinutes: 60, entryMinutes: -30, provisionalMinutes: -60, excludedEntries: [s.accountEntries[0]] });
  });
  it('keeps future compensation and entries separate without double subtraction', () => {
    const s = state(); s.accountOpening = { date, minutes: 600 };
    s.accountEntries = [{ id: 'future', date: '2026-10-06', kind: 'payout', minutes: -120, reason: 'planned' }];
    s.absences = [{ date: '2026-10-05', sickness: false, compensation: { mode: 'fraction', value: 1 } }];
    expect(accountSummary(s, '2026-10-04')).toMatchObject({ confirmedMinutes: 600, provisionalMinutes: 0, plannedCompensationMinutes: 480, plannedEntryMinutes: -120 });
    expect(accountSummary(s, '2026-10-05')).toMatchObject({ confirmedMinutes: 600, provisionalMinutes: -480, plannedCompensationMinutes: 0 });
    s.weeks = [{ weekStart: '2026-10-05', status: 'closed' }];
    expect(accountSummary(s, '2026-10-05')).toMatchObject({ confirmedMinutes: 120, provisionalMinutes: 0 });
  });
  it('builds a historical account period whose movements reconcile start and end', () => {
    const s = state(); s.accountOpening = { date, minutes: 600 }; s.weeks = [{ weekStart: date, status: 'closed' }];
    for (const day of ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']) work(s, day, 480);
    s.accountEntries = [{ id: 'p', date: '2026-10-01', kind: 'payout', minutes: -120, reason: 'October payout' }];
    const month = accountPeriod(s, '2026-10-01', '2026-11-01', '2026-12-01');
    expect(month).toMatchObject({ startMinutes: 600, endMinutes: 480, asOf: '2026-10-31' });
    expect(month.startMinutes! + month.movements.reduce((sum, row) => sum + row.minutes, 0)).toBe(month.endMinutes);
  });
  it('does not activate a future opening or manufacture work for a ledger entry', () => {
    const s = state(); s.accountOpening = { date: '2026-11-01', minutes: -60 };
    s.accountEntries = [{ id: 'p', date: '2026-11-03', kind: 'correction', minutes: 120, reason: 'future' }];
    expect(accountSummary(s, date)).toMatchObject({ confirmedMinutes: null, plannedEntryMinutes: 120 });
    expect(accountSummary(s, '2026-11-03')).toMatchObject({ confirmedMinutes: 60, closedMinutes: 0 });
    expect(activeWeeks(s, '2026-11-03').size).toBe(0);
  });
});
