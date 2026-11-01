import {
  intersectsRange,
  toActivityInterval,
  toInstantRange,
  type ActivityInterval,
  type InstantRange,
} from '../../shared/activities.js';
import { dayBounds, instantAtMinute, minutesBetween, Temporal } from '../../shared/time.js';
import type { Activity, BlockInput, WorkBlock } from '../../shared/types.js';
import { activityIsVisible } from '../../shared/data-sources.js';

export const HOUR_PX = 56;
export const SNAP = 15;
const NS_PER_MINUTE = 60_000_000_000n;

export type PreparedActivity = { activity: Activity; interval: ActivityInterval };
export type ActivityCluster = {
  top: number;
  bottom: number;
  activities: Activity[];
  points: number;
  intervals: number;
};
export type CalendarDraft = {
  kind: 'create' | 'move' | 'resize-start' | 'resize-end';
  pointerId: number;
  sourceDate: string;
  date: string;
  anchorMinute: number;
  startMinute: number;
  endMinute: number;
  block?: WorkBlock;
  pointerInitialMinute?: number;
  moved: boolean;
};

export function roundSnap(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value / SNAP) * SNAP));
}

export type WorkGap = { start: string; end: string; startMinute: number; endMinute: number };

/** Only bounded gaps between the day's union of actual work intervals are fillable. */
export function workGaps(
  blocks: Pick<WorkBlock, 'start' | 'end'>[],
  date: string,
  zone: string,
): WorkGap[] {
  const range = dayActivityRange(date, zone);
  const intervals = blocks
    .map((block) => toInstantRange(block.start, block.end))
    .filter((interval) => interval.start < range.end && interval.end > range.start)
    .map((interval) => ({
      start: interval.start < range.start ? range.start : interval.start,
      end: interval.end > range.end ? range.end : interval.end,
    }))
    .filter((interval) => interval.start < interval.end)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const gaps: WorkGap[] = [];
  let end: bigint | undefined;
  for (const interval of intervals) {
    if (end !== undefined && interval.start > end) {
      gaps.push({
        start: Temporal.Instant.fromEpochNanoseconds(end).toString(),
        end: Temporal.Instant.fromEpochNanoseconds(interval.start).toString(),
        startMinute: minuteFromStart(end, range),
        endMinute: minuteFromStart(interval.start, range),
      });
    }
    if (end === undefined || interval.end > end) end = interval.end;
  }
  return gaps;
}

export function distributeActivities(
  activities: Activity[],
  enabledSources: string[],
  ranges: InstantRange[],
): PreparedActivity[][] {
  const result: PreparedActivity[][] = ranges.map(() => []);
  for (const activity of activities) {
    if (!activityIsVisible(activity, enabledSources)) continue;
    const prepared = { activity, interval: toActivityInterval(activity) };
    ranges.forEach((range, i) => {
      if (intersectsRange(prepared.interval, range)) result[i].push(prepared);
    });
  }
  return result;
}

export function dayActivityRange(date: string, zone: string): InstantRange {
  const bounds = dayBounds(date, zone);
  return toInstantRange(bounds.start, bounds.end);
}

function minuteFromStart(instant: bigint, range: InstantRange): number {
  return Number(instant - range.start) / Number(NS_PER_MINUTE);
}

/** Layout groups preserve the existing minimum heights and only merge visual overlaps. */
export function activityClusters(
  activities: PreparedActivity[],
  range: InstantRange,
  dayMinutes: number,
): ActivityCluster[] {
  const dayHeight = (dayMinutes * HOUR_PX) / 60;
  const positioned = activities
    .map(({ activity, interval }) => {
      const point = interval.end === null;
      const clippedStart = interval.start < range.start ? range.start : interval.start;
      const minute = point
        ? Math.floor(minuteFromStart(interval.start, range) / SNAP) * SNAP
        : minuteFromStart(clippedStart, range);
      const rawTop = (minute * HOUR_PX) / 60;
      const rawBottom = point
        ? rawTop
        : (minuteFromStart(interval.end! > range.end ? range.end : interval.end!, range) * HOUR_PX) / 60;
      const minimumHeight = point ? 14 : 20;
      const top = Math.max(0, Math.min(rawTop, dayHeight - minimumHeight));
      return {
        activity,
        interval,
        point,
        top,
        bottom: Math.min(dayHeight, Math.max(rawBottom, top + minimumHeight)),
      };
    })
    .sort(
      (a, b) =>
        a.top - b.top ||
        a.bottom - b.bottom ||
        (a.interval.start < b.interval.start ? -1 : a.interval.start > b.interval.start ? 1 : 0),
    );
  const clusters: ActivityCluster[] = [];
  for (const item of positioned) {
    const previous = clusters.at(-1);
    if (previous && item.top < previous.bottom) {
      previous.bottom = Math.max(previous.bottom, item.bottom);
      previous.activities.push(item.activity);
      previous.points += Number(item.point);
      previous.intervals += Number(!item.point);
    } else {
      clusters.push({
        top: item.top,
        bottom: item.bottom,
        activities: [item.activity],
        points: Number(item.point),
        intervals: Number(!item.point),
      });
    }
  }
  return clusters;
}

export function updateCalendarDraft(
  current: CalendarDraft,
  requestedDate: string,
  minute: number,
  dayLength: number,
): CalendarDraft {
  const date = current.kind === 'move' ? requestedDate : current.sourceDate;
  let { startMinute, endMinute } = current;
  if (current.kind === 'create') {
    startMinute = Math.max(0, Math.min(current.anchorMinute, minute));
    endMinute = Math.min(dayLength, Math.max(current.anchorMinute, minute));
    if (startMinute === endMinute) endMinute = Math.min(dayLength, startMinute + SNAP);
  } else if (current.kind === 'resize-start') {
    startMinute = Math.max(0, Math.min(minute, current.endMinute - 1));
  } else if (current.kind === 'resize-end') {
    endMinute = Math.min(dayLength, Math.max(minute, current.startMinute + 1));
  } else {
    const duration = minutesBetween(current.block!.start, current.block!.end);
    if (duration > dayLength) return current;
    startMinute = Math.max(0, Math.min(dayLength - duration, minute - current.anchorMinute));
    endMinute = startMinute + duration;
  }
  const moved =
    current.moved ||
    date !== current.sourceDate ||
    minute !== (current.pointerInitialMinute ?? current.anchorMinute);
  return { ...current, date, startMinute, endMinute, moved };
}

export type DraftOutcome =
  | { kind: 'edit'; block: WorkBlock }
  | { kind: 'new'; date: string }
  | { kind: 'save'; block: WorkBlock | undefined; input: BlockInput }
  | { kind: 'none' };

export function calendarDraftOutcome(draft: CalendarDraft, zone: string): DraftOutcome {
  if (draft.block && !draft.moved) return { kind: 'edit', block: draft.block };
  if (draft.kind === 'create' && !draft.moved) return { kind: 'new', date: draft.date };
  if (draft.startMinute >= draft.endMinute) return { kind: 'none' };
  return {
    kind: 'save',
    block: draft.block,
    input: {
      start: instantAtMinute(draft.date, draft.startMinute, zone),
      end: instantAtMinute(draft.date, draft.endMinute, zone),
      note: draft.block?.note ?? '',
      title: draft.block?.title ?? '',
    },
  };
}
