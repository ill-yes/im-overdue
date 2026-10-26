import { describe, expect, it } from 'vitest';
import { dayReviewData, filterDayReview, pageDayReview, reviewRowTime } from '../shared/day-review.js';
import type { Activity, AppState } from '../shared/types.js';

function state(activities: Activity[], patch: Partial<AppState> = {}): AppState {
  return {
    revision: 0,
    undo: null,
    settings: { timezone: 'Europe/Berlin' },
    profiles: [{ id: 'initial', effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] }],
    dataSources: [],
    activities,
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
function point(id: string, source: Activity['source'], start: string, title = id): Activity {
  return { id, source, start, end: null, title, url: null };
}

describe('day review model', () => {
  it('sorts by clipped instants, preserves stable order, filters sources and applies half-open day edges', () => {
    const data = dayReviewData(state([
      point('later', 'github', '2026-10-01T08:00:00Z'),
      point('next-day', 'slack', '2026-10-01T22:00:00Z'),
      { ...point('spanning', 'google_calendar', '2026-09-30T21:00:00Z'), end: '2026-10-01T07:00:00Z' },
      point('same-time', 'slack', '2026-10-01T08:00:00Z'),
      { ...point('ends-at-start', 'other', '2026-09-30T18:00:00Z'), end: '2026-09-30T22:00:00Z' },
    ]), '2026-10-01', ['google_calendar', 'slack', 'github', 'other']);
    expect(data.rows.map(row => row.activity.id)).toEqual(['spanning', 'later', 'same-time']);
    expect(data.rows[0]).toMatchObject({ startsBeforeDay: true, clippedStart: '2026-09-30T22:00:00Z' });
    expect(data.status).toBe('untouched');
    expect(dayReviewData(state([point('a', 'slack', '2026-10-01T08:00:00Z')]), '2026-10-01', ['github'])).toMatchObject({ totalActivityCount: 1, rows: [] });
  });

  it('labels repeated DST wall times with their distinct offsets and clips midnight end to 24:00', () => {
    const data = dayReviewData(state([
      point('summer', 'slack', '2026-10-25T00:30:00Z'),
      point('winter', 'slack', '2026-10-25T01:30:00Z'),
      { ...point('overnight', 'google_calendar', '2026-10-25T21:00:00Z'), end: '2026-10-26T02:00:00Z' },
    ]), '2026-10-25', ['slack', 'google_calendar']);
    expect(data.rows.map(row => reviewRowTime(row, data.date, data.timezone))).toEqual([
      '02:30 +02:00', '02:30 +01:00', '22:00 +01:00–24:00 +01:00',
    ]);
    expect(data.rows[2].endsAfterDay).toBe(true);
  });

  it('keeps nanosecond chronology and clipped flags across midnight', () => {
    const activities = [
      point('later', 'slack', '2026-10-01T22:00:00.000000002Z'),
      point('earlier', 'slack', '2026-10-01T22:00:00.000000001Z'),
      { ...point('crosses', 'google_calendar', '2026-10-01T21:30:00Z'), end: '2026-10-01T22:00:00.000000001Z' },
      { ...point('exact', 'google_calendar', '2026-10-01T21:30:00Z'), end: '2026-10-01T22:00:00Z' },
    ];
    const data = dayReviewData(state(activities), '2026-10-02', ['slack', 'google_calendar']);
    expect(data.totalActivityCount).toBe(3);
    expect(data.rows.map(row => row.activity.id)).toEqual(['crosses', 'earlier', 'later']);
    expect(data.rows[0]).toMatchObject({ startsBeforeDay: true, endsAfterDay: false, clippedStart: '2026-10-01T22:00:00Z', clippedEnd: '2026-10-01T22:00:00.000000001Z' });
    expect(dayReviewData(state(activities), '2026-10-02', ['slack']).rows.map(row => row.activity.id)).toEqual(['earlier', 'later']);
  });

  it('keeps search panel scoped and slices result pages in batches', () => {
    const activities = Array.from({ length: 101 }, (_, i) => point(String(i), 'github', `2026-10-01T10:${String(i % 60).padStart(2, '0')}:00Z`, i % 2 ? 'Commit' : 'Review'));
    const rows = dayReviewData(state(activities), '2026-10-01', ['github']).rows;
    const matches = filterDayReview(rows, ' REVIEW ');
    expect(matches).toHaveLength(51);
    expect(pageDayReview(matches, 50)).toMatchObject({ remaining: 1, rows: expect.arrayContaining([expect.objectContaining({ activity: expect.objectContaining({ title: 'Review' }) })]) });
    expect(pageDayReview(matches, 100).remaining).toBe(0);
  });

  it('shows weekly status and daily totals without counting evidence as work', () => {
    const activities = [point('evidence', 'slack', '2026-10-01T08:00:00Z')];
    const imported = dayReviewData(state(activities), '2026-10-01', ['slack']);
    expect(imported.status).toBe('untouched');
    expect(imported.totals.actualMinutes).toBe(0);
    const closed = dayReviewData(state(activities, { weeks: [{ weekStart: '2026-09-28', status: 'closed' }] }), '2026-10-01', ['slack']);
    expect(closed.status).toBe('closed');
    expect(closed.totals.targetMinutes).toBe(480);
  });
});
