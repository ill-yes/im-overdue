import { toInstantRange } from '../../shared/activities.js';
import { dayTotals } from '../../shared/calculations.js';
import {
  clipToDay,
  dayBounds,
  instantAtMinute,
  localTime,
  minuteInDay,
  offsetAt,
  Temporal,
} from '../../shared/time.js';
import type { AppState } from '../../shared/types.js';
import { activityClusters, distributeActivities, HOUR_PX, workGaps } from './calendar-model.js';

/** Prepare the visible week in elapsed minutes, including 23- and 25-hour days. */
export function calendarWeekDays(dates: string[], state: AppState, enabledSources: string[]) {
  const zone = state.settings.timezone;
  const bounds = dates.map((date) => dayBounds(date, zone));
  const epochBounds = bounds.map((bound) => toInstantRange(bound.start, bound.end));
  const activitiesByDay = distributeActivities(state.activities, enabledSources, epochBounds);
  const positionedBlocks = state.blocks.map((block) => ({
    block,
    start: Temporal.Instant.from(block.start).epochNanoseconds,
    end: Temporal.Instant.from(block.end).epochNanoseconds,
  }));
  return dates.map((date, i) => {
    const dayBoundsValue = bounds[i];
    const evidence = activityClusters(activitiesByDay[i], epochBounds[i], dayBoundsValue.minutes);
    const blocks = positionedBlocks
      .filter((item) => item.start < epochBounds[i].end && item.end > epochBounds[i].start)
      .map(({ block }) => ({ block, clip: clipToDay(block.start, block.end, date, zone) }))
      .filter((item) => item.clip !== null);
    const hours = Array.from({ length: Math.ceil(dayBoundsValue.minutes / 60) }, (_, hour) => {
      const instant = instantAtMinute(date, hour * 60, zone);
      return { hour, label: localTime(instant, zone).slice(0, 5), offset: offsetAt(instant, zone) };
    });
    const gaps = workGaps(state.blocks, date, zone).map((gap) => {
      // Account for short cards' visible footprint without covering their controls.
      const top = Math.max((gap.startMinute * HOUR_PX) / 60, ...blocks
        .filter(({ clip }) => minuteInDay(clip!.end, date, zone) <= gap.startMinute)
        .map(({ clip }) => (minuteInDay(clip!.start, date, zone) * HOUR_PX) / 60 + Math.max(18, (clip!.minutes * HOUR_PX) / 60)));
      return { ...gap, top, height: Math.max(0, (gap.endMinute * HOUR_PX) / 60 - top) };
    });
    return {
      date,
      bounds: dayBoundsValue,
      total: dayTotals(state, date),
      evidence,
      blocks,
      hours,
      gaps,
      vacation: state.vacations.find((item) => item.date === date),
    };
  });
}

export type CalendarDay = ReturnType<typeof calendarWeekDays>[number];
