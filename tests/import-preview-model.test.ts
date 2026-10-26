import { describe, expect, it } from 'vitest';
import type { Activity, ImportPreview } from '../shared/types.js';
import { periodOf, sourceCountsOf } from '../src/components/import/preview-model';

function row(overrides: Partial<Activity>): ImportPreview['rows'][number] {
  return {
    status: 'new',
    activity: {
      source: 'slack',
      id: 'activity',
      start: '2026-10-25T02:30:00+02:00',
      end: null,
      title: 'Beleg',
      url: null,
      ...overrides,
    },
  };
}

describe('import preview model', () => {
  it('keeps empty previews without a period or sources', () => {
    expect(periodOf([], 'Europe/Berlin')).toBeNull();
    expect(sourceCountsOf([])).toEqual([]);
  });

  it('orders overlapping clock times by instant and opens the first date in the display zone', () => {
    const rows = [
      row({ start: '2026-10-25T02:15:00+01:00', end: '2026-10-25T02:45:00+01:00' }),
      row({ start: '2026-10-25T02:30:00+02:00', end: '2026-10-25T02:50:00+02:00' }),
    ];
    expect(periodOf(rows, 'Europe/Berlin')).toEqual({
      first: '2026-10-25T02:30:00+02:00',
      last: '2026-10-25T02:45:00+01:00',
      openDate: '2026-10-25',
    });
    expect(periodOf(rows, 'America/Los_Angeles')?.openDate).toBe('2026-10-24');
  });

  it('retains nanosecond bounds and includes point activities in the last instant', () => {
    const first = '2026-10-25T00:30:00.000000001Z';
    const last = '2026-10-25T00:30:00.000000003Z';
    const rows = [
      row({ start: '2026-10-25T00:30:00.000000002Z' }),
      row({ start: first, end: '2026-10-25T00:30:00.000000002Z' }),
      row({ start: last }),
    ];
    expect(periodOf(rows, 'UTC')).toEqual({ first, last, openDate: '2026-10-25' });
  });

  it('counts all preview statuses in first-seen source order without changing rows', () => {
    const rows = [
      row({ source: 'github', id: 'first' }),
      { ...row({ source: 'slack', id: 'second' }), status: 'unchanged' as const },
      { ...row({ source: 'github', id: 'third' }), status: 'updated' as const },
      row({ source: 'other', id: 'fourth' }),
    ];
    const before = structuredClone(rows);
    expect(sourceCountsOf(rows)).toEqual([['github', 2], ['slack', 1], ['other', 1]]);
    expect(rows).toEqual(before);
  });
});
