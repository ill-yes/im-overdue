import { describe, expect, it } from 'vitest';
import { activeWeeks, dayTotals, periodSummary, targetForDay, weekTotals } from '../shared/calculations.js';
import { addDays, instantAtMinute } from '../shared/time.js';
import type { AppState } from '../shared/types.js';

function stateWithHours(hours: number[], week = '2026-09-28', status: 'open' | 'closed' = 'closed'): AppState {
  return {
    revision: 0, undo: null, settings: { timezone: 'Europe/Berlin' },
    profiles: [{ id: 'initial', effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] }],
    dataSources: [], activities: [], weeks: [{ weekStart: week, status }], notes: [], templates: [], recentEntries: [], vacations: [], vacationAllowances: [],
    blocks: hours.flatMap((h, index) => h === 0 ? [] : [{
      id: String(index), title: '', createdAt: null, note: '', start: instantAtMinute(addDays(week, index), 480, 'Europe/Berlin'),
      end: instantAtMinute(addDays(week, index), 480 + h * 60, 'Europe/Berlin'),
    }]),
  };
}
describe('time-account calculations', () => {
  it('meets the agreed split-week oracle', () => {
    const s = stateWithHours([9, 8, 10, 8, 7, 2, 0]);
    expect(weekTotals(s, '2026-09-28')).toEqual({ actualMinutes: 2640, vacationMinutes: 0, targetMinutes: 2400, balanceMinutes: 240 });
    expect(periodSummary(s, '2026-09-01', '2026-10-01').confirmed.balanceMinutes).toBe(180);
    expect(periodSummary(s, '2026-10-01', '2026-11-01').confirmed.balanceMinutes).toBe(60);
  });
  it('keeps the entire open week provisional', () => {
    const s = stateWithHours([9, 8, 10, 8, 7, 2, 0], '2026-09-28', 'open');
    const september = periodSummary(s, '2026-09-01', '2026-10-01');
    expect(september.confirmed.days).toBe(0);
    expect(september.confirmed.balanceMinutes).toBe(0);
    expect(september.provisional.balanceMinutes).toBe(180);
  });
  it('removes reopened weeks from confirmed reports until reclosed', () => {
    const s = stateWithHours([9, 8, 10, 8, 7, 3, 0], '2026-09-28', 'open');
    expect(periodSummary(s, '2026-10-01', '2026-11-01').confirmed.days).toBe(0);
    expect(periodSummary(s, '2026-10-01', '2026-11-01').provisional.balanceMinutes).toBe(120);
    s.weeks[0].status = 'closed';
    expect(periodSummary(s, '2026-10-01', '2026-11-01').confirmed.balanceMinutes).toBe(120);
  });
  it('shows no data for untouched periods but -40 h for a deliberately closed empty week', () => {
    const s = stateWithHours([0, 0, 0, 0, 0, 0, 0]);
    expect(weekTotals(s, '2026-09-28').balanceMinutes).toBe(-2400);
    expect(periodSummary(s, '2026-01-01', '2027-01-01').confirmed.balanceMinutes).toBe(-2400);
    expect(periodSummary(s, '2026-08-01', '2026-09-01').confirmed.days).toBe(0);
  });
  it('subtracts negative weeks from positive weeks', () => {
    const first = stateWithHours([9, 9, 9, 9, 9, 0, 0]);
    const second = stateWithHours([8, 8, 8, 8, 5, 0, 0], '2026-10-05');
    first.blocks.push(...second.blocks.map(b => ({ ...b, id: `second-${b.id}` })));
    first.weeks.push(...second.weeks);
    expect(periodSummary(first, '2026-01-01', '2027-01-01').confirmed.balanceMinutes).toBe(120);
  });
  it('preserves historic targets when a new Monday profile starts', () => {
    const s = stateWithHours([7, 6, 6, 6, 6, 0, 0], '2026-10-05');
    s.profiles.push({ id: 'new', effectiveFrom: '2026-10-05', weeklyMinutes: 1800, workdays: [1, 2, 3, 4, 5] });
    expect(targetForDay('2026-09-30', s.profiles)).toBe(480);
    expect(targetForDay('2026-10-05', s.profiles)).toBe(360);
    expect(weekTotals(s, '2026-10-05').balanceMinutes).toBe(60);
  });
  it('supports nonstandard workdays and counts non-workday effort fully positive', () => {
    const s = stateWithHours([2, 5, 5, 5, 5, 6, 3]);
    s.profiles[0] = { id: 'initial', effectiveFrom: null, weeklyMinutes: 1500, workdays: [2, 3, 4, 5, 6] };
    expect(weekTotals(s, '2026-09-28').balanceMinutes).toBe(360);
    expect(periodSummary(s, '2026-09-01', '2026-10-01').confirmed.balanceMinutes).toBe(120);
    expect(periodSummary(s, '2026-10-01', '2026-11-01').confirmed.balanceMinutes).toBe(240);
  });
  it('distributes remainder minutes deterministically without losing time', () => {
    const s = stateWithHours([]);
    s.profiles[0].weeklyMinutes = 2402;
    s.profiles[0].workdays = [5, 3, 1, 4, 2];
    const targets = Array.from({ length: 7 }, (_, i) => targetForDay(addDays('2026-09-28', i), s.profiles));
    expect(targets).toEqual([481, 481, 480, 480, 480, 0, 0]);
    expect(targets.reduce((a, b) => a + b, 0)).toBe(2402);
  });
  it('splits a year/quarter boundary and treats holidays as ordinary workdays', () => {
    const s = stateWithHours([8, 6, 8, 7, 0, 0, 0], '2026-12-28');
    expect(weekTotals(s, '2026-12-28').balanceMinutes).toBe(-660);
    expect(periodSummary(s, '2026-01-01', '2027-01-01').confirmed.balanceMinutes).toBe(-180);
    expect(periodSummary(s, '2027-01-01', '2028-01-01').confirmed.balanceMinutes).toBe(-480);
  });
  it('never counts imported activities as work', () => {
    const s = stateWithHours([]);
    s.activities.push({ source: 'google_calendar', id: 'demo', title: 'Meeting', start: '2026-09-28T06:00:00Z', end: '2026-09-28T14:00:00Z', url: null });
    expect(dayTotals(s, '2026-09-28').actualMinutes).toBe(0);
  });
  it('does not invent an active week beyond an interval ending at Monday midnight', () => {
    const s = stateWithHours([]);
    s.weeks = [];
    s.blocks = [{ id: 'night', start: '2026-10-04T21:00:00Z', end: '2026-10-04T22:00:00Z', title: '', createdAt: null, note: '' }];
    expect([...activeWeeks(s)]).toEqual(['2026-09-28']);
  });
  it('activates the next week for even a nanosecond of work after Monday midnight', () => {
    const s = stateWithHours([]);
    s.weeks = [];
    s.blocks = [{ id: 'nano', start: '2026-10-04T21:59:00Z', end: '2026-10-04T22:00:00.000000001Z', title: '', createdAt: null, note: '' }];
    expect([...activeWeeks(s)]).toEqual(['2026-09-28', '2026-10-05']);
    expect(dayTotals(s, '2026-10-05').actualMinutes).toBe(1 / 60_000_000_000);
  });
});
