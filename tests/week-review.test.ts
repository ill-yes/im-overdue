import { describe, expect, it } from 'vitest';
import { weekReview } from '../shared/week-review.js';
import type { Activity, AppState, WorkBlock } from '../shared/types.js';

function state(patch: Partial<AppState> = {}): AppState {
  return { revision: 7, undo: null, settings: { timezone: 'Europe/Berlin' },
    profiles: [{ id: 'initial', effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] }],
    dataSources: [], activities: [], blocks: [], weeks: [], notes: [], templates: [], recentEntries: [], vacations: [], vacationAllowances: [], ...patch };
}
const block = (start: string, end: string): WorkBlock => ({ id: start, start, end, title: '', note: '', createdAt: null });
const activity = (start: string, end: string | null = null): Activity => ({ id: start, start, end, source: 'other', title: '', url: null });
const now = '2026-10-22T10:00:00Z';

describe('week review', () => {
  it('warns on elapsed missing workdays, skips fully credited vacation, retains half-day warnings and current-week confirmation', () => {
    const s = state({ vacations: [{ date: '2026-10-19', fraction: 1 }, { date: '2026-10-20', fraction: 0.5 }] });
    const review = weekReview(s, '2026-10-19', now);
    expect(review).toMatchObject({ weekStart: '2026-10-19', revision: 7, today: '2026-10-22', requiresCurrentConfirmation: true });
    expect(review.warnings.map(warning => [warning.date, warning.kind])).toEqual([['2026-10-20', 'missing'], ['2026-10-21', 'missing']]);
    expect(weekReview(s, '2026-10-26', now).warnings).toEqual([]);
    expect(weekReview(s, '2026-10-12', now).requiresCurrentConfirmation).toBe(false);
  });

  it('warns once per evidence with any uncovered portion, covers adjacent intervals and does not infer pause gaps', () => {
    const s = state({ blocks: [block('2026-10-19T07:00:00Z', '2026-10-19T08:00:00Z'), block('2026-10-19T08:00:00Z', '2026-10-19T09:00:00Z'), block('2026-10-19T10:00:00Z', '2026-10-19T11:00:00Z')],
      activities: [activity('2026-10-19T07:30:00Z', '2026-10-19T08:30:00Z'), activity('2026-10-19T08:30:00Z', '2026-10-19T09:30:00Z'), activity('2026-10-19T09:00:00Z'), activity('2026-10-19T10:00:00Z')] });
    expect(weekReview(s, '2026-10-19', now).warnings.filter(warning => warning.kind === 'evidence')).toEqual([
      expect.objectContaining({ date: '2026-10-19', count: 2 }),
    ]);
    s.activities = [];
    expect(weekReview(s, '2026-10-19', now).warnings.filter(warning => warning.date === '2026-10-19')).toEqual([]);
  });

  it('reviews only elapsed activity portions today and keeps future evidence out', () => {
    const s = state({ blocks: [block('2026-10-22T08:00:00Z', now)], activities: [activity('2026-10-22T08:00:00Z', '2026-10-22T15:00:00Z'), activity(now), activity('2026-10-23T06:00:00Z')] });
    expect(weekReview(s, '2026-10-19', now).warnings.filter(warning => warning.kind === 'evidence')).toEqual([]);
    s.activities.push(activity('2026-10-22T07:00:00Z', '2026-10-22T15:00:00Z'));
    expect(weekReview(s, '2026-10-19', now).warnings.filter(warning => warning.kind === 'evidence')).toMatchObject([{ date: '2026-10-22', count: 1 }]);
  });

  it('uses nanosecond half-open coverage and local day boundaries for evidence', () => {
    const s = state({ blocks: [block('2026-10-19T07:00:00Z', '2026-10-19T08:00:00Z')], activities: [activity('2026-10-19T07:59:59.999999999Z'), activity('2026-10-19T08:00:00Z'), activity('2026-10-19T07:30:00Z', '2026-10-19T08:00:00.000000001Z'), activity('2026-10-18T21:00:00Z', '2026-10-18T22:00:00Z')] });
    expect(weekReview(s, '2026-10-19', now).warnings.filter(warning => warning.kind === 'evidence')).toMatchObject([{ date: '2026-10-19', count: 2 }]);
  });

  it('flags more than twelve actual hours but not vacation credit and respects local today', () => {
    const s = state({ blocks: [block('2026-10-19T04:00:00Z', '2026-10-19T17:00:00Z'), block('2026-10-20T04:00:00Z', '2026-10-20T16:00:00Z')], vacations: [{ date: '2026-10-20', fraction: 1 }] });
    expect(weekReview(s, '2026-10-19', now).warnings.filter(warning => warning.kind === 'long')).toMatchObject([{ date: '2026-10-19' }]);
    expect(weekReview(state(), '2026-10-19', '2026-10-19T22:01:00Z').warnings.map(warning => warning.date)).toEqual(['2026-10-19']);
  });
});
