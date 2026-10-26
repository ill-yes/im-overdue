import { describe, expect, it } from 'vitest';
import {
  activityClusters,
  calendarDraftOutcome,
  dayActivityRange,
  distributeActivities,
  HOUR_PX,
  roundSnap,
  updateCalendarDraft,
  workGaps,
  type CalendarDraft,
} from '../src/calendar-model.js';
import type { Activity, WorkBlock } from '../shared/types.js';

const activity = (id: string, start: string, end: string | null = null): Activity => ({
  id,
  start,
  end,
  source: 'slack',
  title: id,
  url: null,
});
const block = (start: string, end: string): WorkBlock => ({ id: 'block', start, end, title: '', createdAt: null, note: '' });
const draft = (kind: CalendarDraft['kind'], workBlock?: WorkBlock): CalendarDraft => ({
  kind,
  pointerId: 1,
  sourceDate: '2026-10-25',
  date: '2026-10-25',
  anchorMinute: 30,
  startMinute: 60,
  endMinute: 120,
  pointerInitialMinute: 90,
  moved: false,
  block: workBlock,
});

describe('calendar model', () => {
  it('finds only bounded gaps from the sorted union of real work, preserving seconds', () => {
    expect(workGaps([], '2026-10-22', 'Europe/Berlin')).toEqual([]);
    const blocks = [
      block('2026-10-22T09:01:05Z', '2026-10-22T10:00:00Z'),
      block('2026-10-22T06:00:00Z', '2026-10-22T07:00:00Z'),
      block('2026-10-22T06:30:00Z', '2026-10-22T08:00:17Z'),
      block('2026-10-22T07:15:00Z', '2026-10-22T07:30:00Z'),
      block('2026-10-22T10:00:00Z', '2026-10-22T11:00:00Z'),
    ];
    expect(workGaps(blocks, '2026-10-22', 'Europe/Berlin')).toEqual([{
      start: '2026-10-22T08:00:17Z', end: '2026-10-22T09:01:05Z',
      startMinute: 600 + 17 / 60, endMinute: 661 + 5 / 60,
    }]);
    expect(workGaps(blocks.slice(0, 1), '2026-10-22', 'Europe/Berlin')).toEqual([]);
  });

  it('clips overnight work to the local day and never offers leading or trailing space', () => {
    expect(workGaps([
      block('2026-10-21T21:00:00Z', '2026-10-22T00:00:00Z'),
      block('2026-10-22T01:00:00Z', '2026-10-23T01:00:00Z'),
      block('2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z'),
    ], '2026-10-22', 'Europe/Berlin')).toEqual([{
      start: '2026-10-22T00:00:00Z', end: '2026-10-22T01:00:00Z',
      startMinute: 120, endMinute: 180,
    }]);
  });

  it('keeps repeated DST wall times distinct and does not round nanosecond endpoints', () => {
    const gaps = workGaps([
      block('2026-10-25T00:00:00Z', '2026-10-25T00:30:00.000000001Z'),
      block('2026-10-25T01:30:00.000000002Z', '2026-10-25T02:00:00Z'),
    ], '2026-10-25', 'Europe/Berlin');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      start: '2026-10-25T00:30:00.000000001Z', end: '2026-10-25T01:30:00.000000002Z',
    });
    expect(gaps[0].startMinute).toBeCloseTo(150);
    expect(gaps[0].endMinute).toBeCloseTo(210);
    const spring = workGaps([
      block('2026-03-29T00:00:00Z', '2026-03-29T00:30:00Z'),
      block('2026-03-29T01:30:00Z', '2026-03-29T02:00:00Z'),
    ], '2026-03-29', 'Europe/Berlin');
    expect(spring[0]).toMatchObject({ startMinute: 90, endMinute: 150 });
  });

  it('distributes precision-safe evidence only to intersected days with source filtering', () => {
    const dates = ['2026-10-01', '2026-10-02'];
    const ranges = dates.map((date) => dayActivityRange(date, 'Europe/Berlin'));
    const visible = distributeActivities(
      [
        activity('crosses', '2026-10-01T21:30:00Z', '2026-10-01T22:00:00.000000001Z'),
        activity('exact', '2026-10-01T21:30:00Z', '2026-10-01T22:00:00Z'),
        { ...activity('hidden', '2026-10-01T22:00:00Z'), source: 'github' },
      ],
      ['slack'],
      ranges,
    );
    expect(visible.map((day) => day.map((item) => item.activity.id))).toEqual([
      ['crosses', 'exact'],
      ['crosses'],
    ]);
  });

  it('groups overlapping minimum-height markers and keeps separated markers apart', () => {
    const range = dayActivityRange('2026-10-25', 'Europe/Berlin');
    const prepared = distributeActivities(
      [
        activity('short', '2026-10-25T00:00:00Z', '2026-10-25T00:01:00Z'),
        activity('same', '2026-10-25T00:00:00.000000001Z'),
        activity('later', '2026-10-25T00:30:00Z'),
      ],
      ['slack'],
      [range],
    )[0];
    const clusters = activityClusters(prepared, range, 1500);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ points: 1, intervals: 1 });
    expect(clusters[0].bottom - clusters[0].top).toBeGreaterThanOrEqual(20);
    expect(clusters[1].top).toBe(HOUR_PX * 2.5);
  });

  it('preserves snapping and 23/25-hour move and resize edges', () => {
    expect([roundSnap(7, 1380), roundSnap(8, 1380), roundSnap(1499, 1500)]).toEqual([0, 15, 1500]);
    const start = updateCalendarDraft(draft('resize-start'), '2026-10-26', 150, 1500);
    expect(start).toMatchObject({ date: '2026-10-25', startMinute: 119, endMinute: 120, moved: true });
    const end = updateCalendarDraft(draft('resize-end'), '2026-10-26', 0, 1500);
    expect(end).toMatchObject({ endMinute: 61, moved: true });
    const moving = draft('move', block('2026-10-25T00:00:00Z', '2026-10-25T01:00:00Z'));
    expect(updateCalendarDraft(moving, '2026-10-26', 1500, 1440)).toMatchObject({
      date: '2026-10-26',
      startMinute: 1380,
      endMinute: 1440,
    });
    const tooLong = draft('move', block('2026-03-28T23:00:00Z', '2026-03-29T23:00:00Z'));
    expect(updateCalendarDraft(tooLong, '2026-03-30', 100, 1380)).toBe(tooLong);
  });

  it('opens forms on clicks and resolves drag endpoints across DST days', () => {
    const existing = block('2026-10-25T00:00:00Z', '2026-10-25T01:00:00Z');
    expect(calendarDraftOutcome(draft('create'), 'Europe/Berlin')).toEqual({
      kind: 'new',
      date: '2026-10-25',
    });
    expect(calendarDraftOutcome(draft('move', existing), 'Europe/Berlin')).toEqual({
      kind: 'edit',
      block: existing,
    });
    expect(
      calendarDraftOutcome(
        { ...draft('move', existing), moved: true, startMinute: 0, endMinute: 60 },
        'Europe/Berlin',
      ),
    ).toEqual({
      kind: 'save',
      block: existing,
      input: { start: '2026-10-24T22:00:00Z', end: '2026-10-24T23:00:00Z', title: '', note: '' },
    });
    expect(
      calendarDraftOutcome(
        { ...draft('create'), moved: true, date: '2026-03-29', startMinute: 120, endMinute: 180 },
        'Europe/Berlin',
      ),
    ).toMatchObject({
      kind: 'save',
      input: { start: '2026-03-29T01:00:00Z', end: '2026-03-29T02:00:00Z' },
    });
  });

  it('retains the activity title and note when moving or resizing existing work', () => {
    const existing = { ...block('2026-10-25T00:00:00Z', '2026-10-25T01:00:00Z'), title: 'Projektarbeit', note: 'Review' };
    for (const kind of ['move', 'resize-start', 'resize-end'] as const) {
      expect(calendarDraftOutcome({ ...draft(kind, existing), moved: true }, 'Europe/Berlin')).toMatchObject({
        kind: 'save', input: { title: 'Projektarbeit', note: 'Review' },
      });
    }
  });
});
