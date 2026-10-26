import { activeWeeks, dayTotals } from './calculations.js';
import { intersectsRange, toActivityInterval, toInstantRange } from './activities.js';
import { dayBounds, localTimeWithOffset, offsetAt, shiftInstant, weekStartFor } from './time.js';
import type { Activity, AppState, DayTotals } from './types.js';
import { activityIsVisible } from './data-sources.js';

export interface DayReviewRow {
  activity: Activity;
  clippedStart: string;
  clippedEnd: string | null;
  startsBeforeDay: boolean;
  endsAfterDay: boolean;
}

export interface DayReviewData {
  date: string;
  timezone: string;
  totals: DayTotals;
  status: 'untouched' | 'open' | 'closed';
  totalActivityCount: number;
  rows: DayReviewRow[];
}

/** Intervals touch [dayStart, dayEnd); a point belongs to exactly one local day. */
export function dayReviewData(state: AppState, date: string, enabledSources: string[]): DayReviewData {
  const zone = state.settings.timezone;
  const bounds = dayBounds(date, zone);
  const range = toInstantRange(bounds.start, bounds.end);
  let totalActivityCount = 0;
  const rows = state.activities
    .flatMap((activity, index) => {
      const interval = toActivityInterval(activity);
      if (!intersectsRange(interval, range)) return [];
      totalActivityCount++;
      if (!activityIsVisible(activity, enabledSources)) return [];
      const startsBeforeDay = interval.start < range.start;
      const endsAfterDay = interval.end !== null && interval.end > range.end;
      const clippedStart = startsBeforeDay ? bounds.start : activity.start;
      const clippedEnd = interval.end === null ? null : endsAfterDay ? bounds.end : activity.end;
      return [
        {
          activity,
          clippedStart,
          clippedEnd,
          startsBeforeDay,
          endsAfterDay,
          index,
          sortStart: startsBeforeDay ? range.start : interval.start,
        },
      ];
    })
    .sort((a, b) => (a.sortStart < b.sortStart ? -1 : a.sortStart > b.sortStart ? 1 : a.index - b.index));
  const week = weekStartFor(date);
  const closed = state.weeks.some((record) => record.weekStart === week && record.status === 'closed');
  const status = closed ? 'closed' : activeWeeks(state).has(week) ? 'open' : 'untouched';
  return {
    date,
    timezone: zone,
    totals: dayTotals(state, date),
    status,
    totalActivityCount,
    rows: rows.map(({ index: _index, sortStart: _sortStart, ...row }) => row),
  };
}

export function filterDayReview(rows: DayReviewRow[], query: string): DayReviewRow[] {
  const needle = query.trim().toLocaleLowerCase('de-DE');
  return needle ? rows.filter((row) => row.activity.title.toLocaleLowerCase('de-DE').includes(needle)) : rows;
}

export function pageDayReview(
  rows: DayReviewRow[],
  visible: number,
): { rows: DayReviewRow[]; remaining: number } {
  const count = Math.max(0, Math.floor(visible));
  return { rows: rows.slice(0, count), remaining: Math.max(0, rows.length - count) };
}

/** The end at local midnight is exclusive; show it as 24:00 of the reviewed day. */
export function reviewRowTime(row: DayReviewRow, date: string, zone: string): string {
  const start = localTimeWithOffset(row.clippedStart, zone);
  if (!row.clippedEnd) return start;
  const boundary = dayBounds(date, zone).end;
  const end =
    row.clippedEnd === boundary
      ? `24:00 ${offsetAt(shiftInstant(boundary, -1), zone)}`
      : localTimeWithOffset(row.clippedEnd, zone);
  return `${start}–${end}`;
}
