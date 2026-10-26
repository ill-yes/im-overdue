import { activeWeeks, dayTotals, periodSummary } from './calculations.js';
import { intersectsRange, toActivityInterval, toInstantRange } from './activities.js';
import { activityDataSourceId, activityIsVisible, activitySourceName } from './data-sources.js';
import { SOURCES, type AppState, type DayTotals, type PeriodSummary, type Source } from './types.js';
import { Temporal, addDays, dayBounds, datesInRange, periodBounds, weekStartFor } from './time.js';

export type MonthDayStatus = 'untouched' | 'open' | 'closed';
export interface MonthDay {
  date: string;
  inMonth: boolean;
  isWeekend: boolean;
  totals: DayTotals;
  status: MonthDayStatus;
  activityCount: number;
  activitySources: Source[];
  activitySourceNames: string[];
}
export interface MonthOverview {
  from: string;
  to: string;
  days: MonthDay[];
  summary: PeriodSummary;
  actualMinutes: number;
  activityCount: number;
}

export function monthOverview(
  state: AppState,
  anchor: string,
  enabledSources: string[] = state.activities.map(activityDataSourceId),
): MonthOverview {
  const { from, to } = periodBounds(anchor, 'month');
  const gridFrom = weekStartFor(from);
  const gridTo = addDays(weekStartFor(addDays(to, -1)), 7);
  const zone = state.settings.timezone;
  const active = activeWeeks(state);
  const closed = new Set(state.weeks.filter((w) => w.status === 'closed').map((w) => w.weekStart));
  const activities = state.activities
    .filter((a) => activityIsVisible(a, enabledSources))
    .map((a) => ({
      source: a.source,
      dataSourceId: activityDataSourceId(a),
      sourceName: activitySourceName(a, state.dataSources),
      interval: toActivityInterval(a),
    }));
  const monthRange = toInstantRange(dayBounds(from, zone).start, dayBounds(to, zone).start);
  const activityCount = activities.reduce(
    (count, a) => count + Number(intersectsRange(a.interval, monthRange)),
    0,
  );
  const days = datesInRange(gridFrom, gridTo).map((date): MonthDay => {
    const dayOfWeek = Temporal.PlainDate.from(date).dayOfWeek;
    const week = weekStartFor(date);
    const bounds = dayBounds(date, zone);
    const dayRange = toInstantRange(bounds.start, bounds.end);
    let count = 0;
    const sources = new Set<Source>();
    const sourceNames = new Map<string, string>();
    for (const activity of activities) {
      if (!intersectsRange(activity.interval, dayRange)) continue;
      count++;
      sources.add(activity.source);
      sourceNames.set(activity.dataSourceId, activity.sourceName);
    }
    return {
      date,
      inMonth: date >= from && date < to,
      isWeekend: dayOfWeek >= 6,
      totals: dayTotals(state, date),
      status: closed.has(week) ? 'closed' : active.has(week) ? 'open' : 'untouched',
      activityCount: count,
      activitySources: SOURCES.filter((source) => sources.has(source)),
      activitySourceNames: [...sourceNames.values()],
    };
  });
  const summary = periodSummary(state, from, to);
  return {
    from,
    to,
    days,
    summary,
    actualMinutes: summary.confirmed.actualMinutes + summary.provisional.actualMinutes,
    activityCount,
  };
}
