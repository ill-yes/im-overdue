import { dayAccounting } from './calculations.js';
import { intersectsRange, toActivityInterval, toInstantRange } from './activities.js';
import { Temporal, addDays, datesInRange, dayBounds, localDate, weekStartFor } from './time.js';
import type { AppState, WeekReview } from './types.js';

/** Bind a confirmation to the warnings actually shown, including clock-only changes. */
export function weekReviewKey(review: WeekReview): string {
  return JSON.stringify([review.weekStart, review.revision, review.today, review.warnings, review.requiresCurrentConfirmation]);
}

/** Review evidence against the union of work intervals, preserving nanosecond edges. */
export function weekReview(state: AppState, weekStart: string, now = Temporal.Now.instant().toString()): WeekReview {
  if (weekStartFor(weekStart) !== weekStart) throw new Error('Die Woche muss an einem Montag beginnen.');
  const currentDate = localDate(now, state.settings.timezone);
  const nowNs = Temporal.Instant.from(now).epochNanoseconds;
  const warnings: WeekReview['warnings'] = [];
  const blocks = state.blocks.map(block => toInstantRange(block.start, block.end)).sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  for (const date of datesInRange(weekStart, addDays(weekStart, 7))) {
    if (date > currentDate) continue;
    const totals = dayAccounting(state, date);
    if (date < currentDate && totals.uncoveredMinutes > 0 && (totals.actualMinutes === 0 || Boolean(state.absences?.find(value => value.date === date)))) {
      warnings.push({ date, kind: 'missing', message: 'Soll-Arbeitstag ohne erfasste Arbeitszeit.' });
    }
    if (totals.actualMinutes > 720) warnings.push({ date, kind: 'long', message: 'Mehr als zwölf Stunden Arbeitszeit erfasst.' });
    const bounds = dayBounds(date, state.settings.timezone);
    const fullDay = toInstantRange(bounds.start, bounds.end);
    const range = { start: fullDay.start, end: fullDay.end < nowNs ? fullDay.end : nowNs };
    if (range.end <= range.start) continue;
    let count = 0;
    for (const activity of state.activities) {
      const interval = toActivityInterval(activity);
      if (!intersectsRange(interval, range)) continue;
      if (interval.end === null) {
        if (!blocks.some(block => interval.start >= block.start && interval.start < block.end)) count++;
        continue;
      }
      let cursor = interval.start > range.start ? interval.start : range.start;
      const end = interval.end < range.end ? interval.end : range.end;
      for (const block of blocks) {
        if (block.end <= cursor) continue;
        if (block.start > cursor || cursor >= end) break;
        if (block.end > cursor) cursor = block.end;
      }
      if (cursor < end) count++;
    }
    if (count) warnings.push({ date, kind: 'evidence', count, message: `${count} Hinweis${count === 1 ? '' : 'e'} außerhalb erfasster Arbeitszeit.` });
  }
  return { weekStart, revision: state.revision, today: currentDate, warnings, requiresCurrentConfirmation: weekStart === weekStartFor(currentDate) };
}
