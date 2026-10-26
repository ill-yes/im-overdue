import { describe, expect, it } from 'vitest';
import { activeWeeks, dayTotals, periodSummary, weekTotals } from '../shared/calculations.js';
import { vacationAccount, vacationForDay } from '../shared/vacations.js';
import type { AppState } from '../shared/types.js';

function state(patch: Partial<AppState> = {}): AppState {
  return { revision: 3, undo: null, settings: { timezone: 'Europe/Berlin' },
    profiles: [{ id: 'initial', effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] }],
    dataSources: [], activities: [], blocks: [], weeks: [], notes: [], templates: [], recentEntries: [], vacations: [], vacationAllowances: [], ...patch };
}

describe('vacation accounting', () => {
  it('credits full and half vacation without changing actual work, including fractional target minutes', () => {
    const s = state({ vacations: [{ date: '2026-10-19', fraction: 1 }, { date: '2026-10-20', fraction: 0.5 }] });
    s.profiles[0].weeklyMinutes = 2401;
    expect(dayTotals(s, '2026-10-19')).toEqual({ actualMinutes: 0, vacationMinutes: 481, targetMinutes: 481, balanceMinutes: 0 });
    s.vacations[0].fraction = 0.5;
    expect(dayTotals(s, '2026-10-19').vacationMinutes).toBe(240.5);
    expect(weekTotals(s, '2026-10-19').vacationMinutes).toBe(480.5);
    expect(vacationForDay(s.vacations, '2026-10-19')?.fraction).toBe(0.5);
    expect(vacationForDay(s.vacations, '2026-10-21')).toBeUndefined();
  });

  it('preserves historic profiles and gives no credit or consumption when a profile makes a day ineligible', () => {
    const s = state({ vacations: [{ date: '2026-10-12', fraction: 1 }, { date: '2026-10-19', fraction: 1 }, { date: '2026-10-20', fraction: 0.5 }] });
    s.profiles.push({ id: 'later', effectiveFrom: '2026-10-19', weeklyMinutes: 1200, workdays: [2, 4] });
    expect(dayTotals(s, '2026-10-12').vacationMinutes).toBe(480);
    expect(dayTotals(s, '2026-10-19').vacationMinutes).toBe(0);
    expect(dayTotals(s, '2026-10-20').vacationMinutes).toBe(300);
    expect(vacationAccount(s, 2026, '2026-10-22')).toMatchObject({ takenDays: 1.5, plannedDays: 0, remainingDays: null });
    expect(s.vacations).toHaveLength(3);
    const ineligibleOnly = state({ vacations: [{ date: '2026-10-19', fraction: 1 }], profiles: s.profiles });
    expect([...activeWeeks(ineligibleOnly, '2026-10-22')]).toEqual(['2026-10-19']);
    expect(vacationAccount(ineligibleOnly, 2026, '2026-10-22').takenDays).toBe(0);
  });

  it('separates local-year taken and planned days and allows negative remaining entitlement', () => {
    const s = state({ vacations: [{ date: '2026-10-19', fraction: 1 }, { date: '2026-10-22', fraction: 0.5 }, { date: '2026-12-31', fraction: 1 }, { date: '2027-01-01', fraction: 1 }],
      vacationAllowances: [{ year: 2026, entitlementDays: 1, carryoverDays: 0.5 }] });
    expect(vacationAccount(s, 2026, '2026-10-22')).toEqual({ year: 2026, allowance: s.vacationAllowances[0], takenDays: 1.5, plannedDays: 1, remainingDays: -1 });
    expect(vacationAccount(s, 2027, '2026-10-22')).toMatchObject({ takenDays: 0, plannedDays: 1, remainingDays: null });
  });

  it('activates elapsed vacation weeks but keeps pure future weeks untouched until reached', () => {
    const s = state({ vacations: [{ date: '2026-10-19', fraction: 1 }, { date: '2026-10-30', fraction: 1 }] });
    expect([...activeWeeks(s, '2026-10-22')]).toEqual(['2026-10-19']);
    expect(periodSummary(s, '2026-10-26', '2026-11-02', '2026-10-22').provisional.days).toBe(0);
    expect(periodSummary(s, '2026-10-26', '2026-11-02', '2026-10-26').provisional).toMatchObject({ days: 7, vacationMinutes: 480, balanceMinutes: -1920 });
    s.weeks.push({ weekStart: '2026-10-26', status: 'closed' });
    expect(periodSummary(s, '2026-10-26', '2026-11-02', '2026-10-22').confirmed.vacationMinutes).toBe(480);
  });

  it('splits vacation credits across month and year boundaries consistently', () => {
    const s = state({ vacations: [{ date: '2026-12-31', fraction: 1 }, { date: '2027-01-01', fraction: 0.5 }], weeks: [{ weekStart: '2026-12-28', status: 'closed' }] });
    expect(periodSummary(s, '2026-12-01', '2027-01-01', '2027-01-02').confirmed.vacationMinutes).toBe(480);
    expect(periodSummary(s, '2027-01-01', '2027-02-01', '2027-01-02').confirmed.vacationMinutes).toBe(240);
  });
});
