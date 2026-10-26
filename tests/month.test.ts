import { describe, expect, it } from 'vitest';
import { monthOverview } from '../shared/month.js';
import type { Activity, AppState, WorkBlock } from '../shared/types.js';

function makeState(patch: Partial<AppState> = {}): AppState {
  return {
    revision: 0,
    undo: null,
    settings: { timezone: 'Europe/Berlin' },
    profiles: [{ id: 'initial', effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] }],
    dataSources: [],
    activities: [],
    blocks: [],
    templates: [],
    recentEntries: [],
    weeks: [],
    notes: [],
    vacations: [],
    vacationAllowances: [],
    ...patch,
  };
}
function block(id: string, day: string, hours: number): WorkBlock {
  return { id, start: `${day}T06:00:00Z`, end: `${day}T${String(6 + hours).padStart(2, '0')}:00:00Z`, title: '', createdAt: null, note: '' };
}
function point(source: Activity['source'], id: string, start: string): Activity {
  return { source, id, start, end: null, title: id, url: null };
}

describe('monthOverview', () => {
  it.each([
    ['2026-08-12', '2026-08-01', '2026-09-01', 42, '2026-07-27', '2026-09-06', 31],
    ['2027-02-13', '2027-02-01', '2027-03-01', 28, '2027-02-01', '2027-02-28', 28],
    ['2028-02-13', '2028-02-01', '2028-03-01', 35, '2028-01-31', '2028-03-05', 29],
  ])('builds complete Monday-Sunday grids for %s', (anchor, from, to, count, first, last, monthDays) => {
    const overview = monthOverview(makeState(), anchor);
    expect([overview.from, overview.to]).toEqual([from, to]);
    expect(overview.days).toHaveLength(count);
    expect(overview.days[0].date).toBe(first);
    expect(overview.days.at(-1)?.date).toBe(last);
    expect(overview.days.every(d => d.status === 'untouched')).toBe(true);
    expect(overview.days.filter(d => d.inMonth)).toHaveLength(monthDays);
    expect(new Set(overview.days.map(d => d.date)).size).toBe(count);
  });

  it('splits the cross-month overtime oracle by calendar day while keeping the week closed', () => {
    const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];
    const hours = [9, 8, 10, 8, 7, 2];
    const state = makeState({
      blocks: days.map((day, i) => block(String(i), day, hours[i])),
      weeks: [{ weekStart: '2026-09-28', status: 'closed' }],
    });
    const september = monthOverview(state, '2026-09-01');
    const october = monthOverview(state, '2026-10-01');
    expect(september.summary.confirmed.balanceMinutes).toBe(180);
    expect(october.summary.confirmed.balanceMinutes).toBe(60);
    expect(september.actualMinutes).toBe((9 + 8 + 10) * 60);
    expect(october.actualMinutes).toBe((8 + 7 + 2) * 60);
    expect(october.days.find(d => d.date === '2026-10-03')).toMatchObject({ isWeekend: true, status: 'closed', totals: { targetMinutes: 0, actualMinutes: 120 } });
  });

  it('keeps import-only weeks untouched and distinguishes empty open/closed and reopened weeks', () => {
    const activities = [point('slack', 'message', '2026-10-06T09:00:00Z')];
    const imported = monthOverview(makeState({ activities }), '2026-10-01');
    expect(imported.days.find(d => d.date === '2026-10-06')).toMatchObject({ status: 'untouched', activityCount: 1 });
    expect(imported.summary.confirmed.days + imported.summary.provisional.days).toBe(0);
    const open = monthOverview(makeState({ activities, weeks: [{ weekStart: '2026-10-05', status: 'open' }] }), '2026-10-01');
    const reopenedState = makeState({ activities, weeks: [{ weekStart: '2026-10-05', status: 'closed' }] });
    reopenedState.weeks[0].status = 'open';
    const reopened = monthOverview(reopenedState, '2026-10-01');
    expect(reopened.summary.confirmed.days).toBe(0);
    expect(reopened.summary.provisional.balanceMinutes).toBe(-2400);
    expect(open.summary.provisional.balanceMinutes).toBe(-2400);
    const closed = monthOverview(makeState({ activities, weeks: [{ weekStart: '2026-10-05', status: 'closed' }] }), '2026-10-01');
    expect(closed.days.find(d => d.date === '2026-10-06')?.status).toBe('closed');
    expect(closed.summary.confirmed.balanceMinutes).toBe(-2400);
    expect(open.days.find(d => d.date === '2026-10-06')?.status).toBe('open');
  });

  it('applies effective profiles and remainder minutes to their correct weekdays', () => {
    const state = makeState({
      profiles: [
        { id: 'initial', effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] },
        { id: 'later', effectiveFrom: '2026-10-05', weeklyMinutes: 302, workdays: [1, 3, 5] },
      ],
      weeks: [{ weekStart: '2026-09-28', status: 'closed' }, { weekStart: '2026-10-05', status: 'open' }],
    });
    const overview = monthOverview(state, '2026-10-01');
    expect(overview.days.find(d => d.date === '2026-10-01')?.totals.targetMinutes).toBe(480);
    expect(overview.days.find(d => d.date === '2026-10-05')?.totals.targetMinutes).toBe(101);
    expect(overview.days.find(d => d.date === '2026-10-06')?.totals.targetMinutes).toBe(0);
    expect(overview.days.find(d => d.date === '2026-10-07')?.totals.targetMinutes).toBe(101);
    expect(overview.days.find(d => d.date === '2026-10-09')?.totals.targetMinutes).toBe(100);
  });

  it('counts timed evidence by half-open local day, distinct month activity, source order and filters', () => {
    const state = makeState({ activities: [
      { ...point('github', 'spans', '2026-10-31T22:30:00Z'), end: '2026-11-01T00:30:00Z' },
      point('slack', 'midnight', '2026-10-31T23:00:00Z'),
      { ...point('google_calendar', 'ends-at-midnight', '2026-10-31T22:00:00Z'), end: '2026-10-31T23:00:00Z' },
      point('other', 'next-month', '2026-11-30T22:00:00Z'),
    ] });
    const october = monthOverview(state, '2026-10-01');
    expect(october.activityCount).toBe(2);
    expect(october.days.find(d => d.date === '2026-10-31')).toMatchObject({ activityCount: 2, activitySources: ['google_calendar', 'github'] });
    expect(october.days.find(d => d.date === '2026-11-01')).toMatchObject({ activityCount: 2, activitySources: ['slack', 'github'] });
    const november = monthOverview(state, '2026-11-01');
    expect(november.activityCount).toBe(3);
    const githubOnly = monthOverview(state, '2026-11-01', ['github']);
    expect(githubOnly.activityCount).toBe(1);
    expect(githubOnly.days.find(d => d.date === '2026-11-01')?.activitySources).toEqual(['github']);
    expect(githubOnly.summary).toEqual(november.summary);
  });

  it('uses elapsed work time across a 25-hour local day and does not extend point evidence into the next day', () => {
    const state = makeState({
      blocks: [{ id: 'dst', start: '2026-10-24T22:00:00Z', end: '2026-10-25T23:00:00Z', title: '', createdAt: null, note: '' }],
      activities: [point('slack', 'at-end', '2026-10-25T23:00:00Z')],
      weeks: [{ weekStart: '2026-10-19', status: 'open' }],
    });
    const overview = monthOverview(state, '2026-10-01');
    expect(overview.days.find(d => d.date === '2026-10-25')?.totals.actualMinutes).toBe(1500);
    expect(overview.days.find(d => d.date === '2026-10-25')?.activityCount).toBe(0);
    expect(overview.days.find(d => d.date === '2026-10-26')?.activityCount).toBe(1);
  });

  it('handles spring DST and cross-midnight work without assigning the exclusive end to the next day', () => {
    const overview = monthOverview(makeState({
      blocks: [{ id: 'spring', start: '2026-03-28T23:00:00Z', end: '2026-03-29T22:00:00Z', title: '', createdAt: null, note: '' }],
    }), '2026-03-01');
    expect(overview.days.find(d => d.date === '2026-03-29')).toMatchObject({ status: 'open', totals: { actualMinutes: 1380 } });
    expect(overview.days.find(d => d.date === '2026-03-30')).toMatchObject({ status: 'untouched', totals: { actualMinutes: 0 } });
    expect(overview.actualMinutes).toBe(1380);
  });

  it('uses the configured timezone at month boundaries, including dates from the neighbouring year', () => {
    const activities = [point('slack', 'boundary', '2026-10-31T23:30:00Z')];
    const berlin = monthOverview(makeState({ activities }), '2026-11-01');
    const newYork = monthOverview(makeState({ activities, settings: { timezone: 'America/New_York' } }), '2026-11-01');
    expect(berlin.activityCount).toBe(1);
    expect(newYork.activityCount).toBe(0);
    expect(newYork.days.find(d => d.date === '2026-10-31')?.activityCount).toBe(1);
    const january = monthOverview(makeState({
      blocks: [{ id: 'new-year', start: '2026-12-31T22:00:00Z', end: '2027-01-01T00:00:00Z', title: '', createdAt: null, note: '' }],
      weeks: [{ weekStart: '2026-12-28', status: 'closed' }],
    }), '2027-01-01');
    expect(january.days[0].date).toBe('2026-12-28');
    expect(january.actualMinutes).toBe(60);
    expect(january.summary.confirmed.balanceMinutes).toBe(-420);
  });

  it('counts one-nanosecond midnight overlaps and excludes exact midnight ends', () => {
    const activities = [
      { ...point('google_calendar', 'crosses', '2026-10-01T21:30:00Z'), end: '2026-10-01T22:00:00.000000001Z' },
      { ...point('google_calendar', 'exact', '2026-10-01T21:30:00Z'), end: '2026-10-01T22:00:00Z' },
    ];
    const overview = monthOverview(makeState({ activities }), '2026-10-01');
    expect(overview.activityCount).toBe(2);
    expect(overview.days.find(day => day.date === '2026-10-02')).toMatchObject({ activityCount: 1, activitySources: ['google_calendar'] });
  });
});
