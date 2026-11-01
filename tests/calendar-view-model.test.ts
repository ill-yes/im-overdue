import { describe, expect, it } from 'vitest';
import type { AppState, WorkBlock } from '../shared/types.js';
import { HOUR_PX } from '../src/calendar/calendar-model.js';
import { calendarWeekDays } from '../src/calendar/week-view-model.js';

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    revision: 0,
    undo: null,
    settings: { timezone: 'Europe/Berlin' },
    profiles: [{ id: 'profile', effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] }],
    dataSources: [],
    activities: [],
    blocks: [],
    templates: [],
    recentEntries: [],
    weeks: [],
    notes: [],
    vacations: [],
    vacationAllowances: [],
    ...overrides,
  };
}

function block(id: string, start: string, end: string): WorkBlock {
  return { id, start, end, title: '', note: '', createdAt: null };
}

describe('calendar week view model', () => {
  it('keeps repeated autumn hours distinct and skips nonexistent spring hours', () => {
    const [autumn, spring] = calendarWeekDays(['2026-10-25', '2026-03-29'], state(), []);
    expect(autumn.bounds.minutes).toBe(1500);
    expect(autumn.hours).toHaveLength(25);
    expect(autumn.hours.filter(({ label }) => label === '02:00')).toEqual([
      { hour: 2, label: '02:00', offset: '+02:00' },
      { hour: 3, label: '02:00', offset: '+01:00' },
    ]);
    expect(spring.bounds.minutes).toBe(1380);
    expect(spring.hours).toHaveLength(23);
    expect(spring.hours[2]).toEqual({ hour: 2, label: '03:00', offset: '+02:00' });
    expect(spring.hours.some(({ label }) => label === '02:00')).toBe(false);
  });

  it('preserves block order, half-open midnight clipping and vacation totals', () => {
    const blocks = [
      block('later', '2026-10-22T10:00:00Z', '2026-10-22T11:00:00Z'),
      block('crossing', '2026-10-21T21:30:00Z', '2026-10-21T23:00:00Z'),
      block('ends-at-midnight', '2026-10-21T21:00:00Z', '2026-10-21T22:00:00Z'),
      block('nano-overlap', '2026-10-22T21:59:00Z', '2026-10-22T22:00:00.000000001Z'),
    ];
    const vacation = { date: '2026-10-22', fraction: 0.5 as const };
    const [day, nextDay] = calendarWeekDays(['2026-10-22', '2026-10-23'], state({ blocks, vacations: [vacation] }), []);
    expect(day.blocks.map(({ block }) => block.id)).toEqual(['later', 'crossing', 'nano-overlap']);
    expect(day.blocks[1].clip).toMatchObject({ start: '2026-10-21T22:00:00Z', minutes: 60 });
    expect(nextDay.blocks.map(({ block }) => block.id)).toEqual(['nano-overlap']);
    expect(nextDay.blocks[0].clip?.end).toBe('2026-10-22T22:00:00.000000001Z');
    expect(day.total).toMatchObject({ actualMinutes: 121, targetMinutes: 480, vacationMinutes: 240 });
    expect(day.vacation).toBe(vacation);
  });

  it('distributes source-filtered evidence across midnight without changing activity identity', () => {
    const visible = {
      source: 'slack' as const,
      id: 'crossing',
      start: '2026-10-22T21:30:00Z',
      end: '2026-10-22T22:30:00Z',
      title: 'Meeting',
      url: null,
    };
    const hidden = { ...visible, id: 'hidden', source: 'github' as const };
    const days = calendarWeekDays(['2026-10-22', '2026-10-23'], state({ activities: [hidden, visible] }), ['slack']);
    for (const day of days) {
      expect(day.evidence).toHaveLength(1);
      expect(day.evidence[0].activities).toEqual([visible]);
      expect(day.evidence[0].activities[0]).toBe(visible);
    }
    expect(days[0].evidence[0].top).toBe(23.5 * HOUR_PX);
    expect(days[1].evidence[0].top).toBe(0);
  });

  it('keeps short-card controls clear and retains zero-height gaps for the disclosure', () => {
    const [day] = calendarWeekDays(['2026-10-22'], state({
      settings: { timezone: 'UTC' },
      blocks: [
        block('short', '2026-10-22T08:00:00Z', '2026-10-22T08:01:00Z'),
        block('next', '2026-10-22T08:10:00Z', '2026-10-22T09:00:00Z'),
        block('last', '2026-10-22T10:00:00Z', '2026-10-22T11:00:00Z'),
      ],
    }), []);
    expect(day.gaps).toHaveLength(2);
    expect(day.gaps[0]).toMatchObject({ startMinute: 481, endMinute: 490, top: 8 * HOUR_PX + 18, height: 0 });
    expect(day.gaps[1]).toMatchObject({ startMinute: 540, endMinute: 600, top: 9 * HOUR_PX, height: HOUR_PX });
  });
});
