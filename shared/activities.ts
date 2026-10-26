import { Temporal } from './time.js';
import type { Activity } from './types.js';

export type ActivityInterval = { start: bigint; end: bigint | null };
export type InstantRange = { start: bigint; end: bigint };

/** Activity durations and query ranges are half-open; a null end is a point. */
export function toActivityInterval(activity: Pick<Activity, 'start' | 'end'>): ActivityInterval {
  return {
    start: Temporal.Instant.from(activity.start).epochNanoseconds,
    end: activity.end === null ? null : Temporal.Instant.from(activity.end).epochNanoseconds,
  };
}

export function toInstantRange(start: string, end: string): InstantRange {
  return {
    start: Temporal.Instant.from(start).epochNanoseconds,
    end: Temporal.Instant.from(end).epochNanoseconds,
  };
}

export function intersectsRange(interval: ActivityInterval, range: InstantRange): boolean {
  return interval.end === null
    ? interval.start >= range.start && interval.start < range.end
    : interval.start < range.end && interval.end > range.start;
}
