import type { AppState, DayAccounting, DayTotals, PeriodPart, PeriodSummary, WorkProfile } from './types.js';
import { Temporal, addDays, dayBounds, datesInRange, localDate, today, weekStartFor } from './time.js';
import { holidayForDate } from './holidays.js';

export function profileFor(date: string, profiles: WorkProfile[]): WorkProfile {
  const selected = [...profiles].filter(p => p.effectiveFrom === null || p.effectiveFrom <= weekStartFor(date))
    .sort((a, b) => (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''))[0];
  if (!selected) throw new Error('Kein Sollprofil vorhanden.');
  return selected;
}
export function targetForDay(date: string, profiles: WorkProfile[]): number {
  const p = profileFor(date, profiles);
  const days = [...p.workdays].sort((a, b) => a - b);
  const index = days.indexOf(Temporal.PlainDate.from(date).dayOfWeek);
  if (index < 0) return 0;
  return Math.floor(p.weeklyMinutes / days.length) + (index < p.weeklyMinutes % days.length ? 1 : 0);
}
export function dayAccounting(state: AppState, date: string): DayAccounting {
  const bounds = dayBounds(date, state.settings.timezone);
  const start = Temporal.Instant.from(bounds.start).epochNanoseconds;
  const end = Temporal.Instant.from(bounds.end).epochNanoseconds;
  const actualMinutes = state.blocks.reduce((total, b) => {
    const a = Temporal.Instant.from(b.start).epochNanoseconds;
    const z = Temporal.Instant.from(b.end).epochNanoseconds;
    const overlap = (z < end ? z : end) - (a > start ? a : start);
    return total + (overlap > 0n ? Number(overlap) / 60_000_000_000 : 0);
  }, 0);
  const targetMinutes = targetForDay(date, state.profiles);
  const holiday = holidayForDate(state, date);
  const absence = state.absences?.find(value => value.date === date);
  const requestedVacation = state.vacations.find(v => v.date === date)?.fraction ?? 0;
  const vacationFraction = holiday ? 0 : requestedVacation;
  const vacationMinutes = vacationFraction * targetMinutes;
  const holidayMinutes = holiday ? targetMinutes : 0;
  const compensationRequestedMinutes = absence?.compensation
    ? absence.compensation.mode === 'fraction' ? absence.compensation.value * targetMinutes : absence.compensation.value
    : 0;
  const compensationMinutes = holiday ? 0 : Math.min(compensationRequestedMinutes, Math.max(0, targetMinutes - actualMinutes - vacationMinutes));
  const sicknessMinutes = !holiday && absence?.sickness ? Math.max(0, targetMinutes - actualMinutes - vacationMinutes - compensationMinutes) : 0;
  const uncoveredMinutes = Math.max(0, targetMinutes - actualMinutes - vacationMinutes - holidayMinutes - compensationMinutes - sicknessMinutes);
  return { actualMinutes, vacationMinutes, targetMinutes,
    balanceMinutes: actualMinutes + vacationMinutes + holidayMinutes + sicknessMinutes - targetMinutes,
    holiday, holidayMinutes, sicknessMinutes, compensationRequestedMinutes, compensationMinutes, uncoveredMinutes, vacationFraction };
}
/** Preserve the legacy totals shape for existing API/model consumers. */
export function dayTotals(state: AppState, date: string): DayTotals {
  const { actualMinutes, vacationMinutes, targetMinutes, balanceMinutes } = dayAccounting(state, date);
  return { actualMinutes, vacationMinutes, targetMinutes, balanceMinutes };
}
export function weekTotals(state: AppState, week: string): DayTotals {
  return datesInRange(week, addDays(week, 7)).reduce((sum, day) => {
    const v = dayTotals(state, day);
    return { actualMinutes: sum.actualMinutes + v.actualMinutes, vacationMinutes: sum.vacationMinutes + v.vacationMinutes, targetMinutes: sum.targetMinutes + v.targetMinutes, balanceMinutes: sum.balanceMinutes + v.balanceMinutes };
  }, { actualMinutes: 0, vacationMinutes: 0, targetMinutes: 0, balanceMinutes: 0 });
}
export function activeWeeks(state: AppState, asOf = today(state.settings.timezone)): Set<string> {
  const weeks = new Set(state.weeks.map(w => w.weekStart));
  for (const b of state.blocks) {
    const first = localDate(b.start, state.settings.timezone);
    const last = localDate(Temporal.Instant.from(b.end).subtract({ nanoseconds: 1 }).toString(), state.settings.timezone);
    for (const d of datesInRange(first, addDays(last, 1))) weeks.add(weekStartFor(d));
  }
  const currentWeek = weekStartFor(asOf);
  for (const vacation of state.vacations) {
    const week = weekStartFor(vacation.date);
    if (week <= currentWeek) weeks.add(week);
  }
  for (const absence of state.absences ?? []) {
    const week = weekStartFor(absence.date);
    if (week <= currentWeek && (absence.sickness || absence.compensation)) weeks.add(week);
  }
  return weeks;
}
export function periodSummary(state: AppState, from: string, toExclusive: string, asOf = today(state.settings.timezone)): PeriodSummary {
  const empty = (): PeriodPart => ({ actualMinutes: 0, vacationMinutes: 0, targetMinutes: 0, balanceMinutes: 0, days: 0, weeks: [] });
  const result: PeriodSummary = { confirmed: empty(), provisional: empty() };
  const closed = new Set(state.weeks.filter(w => w.status === 'closed').map(w => w.weekStart));
  const active = activeWeeks(state, asOf);
  for (const date of datesInRange(from, toExclusive)) {
    const week = weekStartFor(date);
    if (!active.has(week)) continue;
    const part = closed.has(week) ? result.confirmed : result.provisional;
    const day = dayTotals(state, date);
    part.actualMinutes += day.actualMinutes;
    part.vacationMinutes += day.vacationMinutes;
    part.targetMinutes += day.targetMinutes;
    part.balanceMinutes += day.balanceMinutes;
    part.days++;
    if (!part.weeks.includes(week)) part.weeks.push(week);
  }
  return result;
}
