import { activeWeeks, dayAccounting } from './calculations.js';
import { addDays, datesInRange, Temporal, today } from './time.js';
import type { AccountPeriod, AccountSummary, AppState } from './types.js';

/** Iterate only recorded/active weeks, never every day since an arbitrarily old opening date. */
function accountDays(state: AppState, from: string, through: string): { date: string; closed: boolean; minutes: number }[] {
  if (from > through) return [];
  const closed = new Set(state.weeks.filter(week => week.status === 'closed').map(week => week.weekStart));
  return [...activeWeeks(state, through)].sort().flatMap(week => {
    if (week > through || addDays(week, 6) < from) return [];
    return datesInRange(week, addDays(week, 7)).filter(date => date >= from && date <= through)
      .map(date => ({ date, closed: closed.has(week), minutes: dayAccounting(state, date).balanceMinutes }));
  });
}

export function accountSummary(state: AppState, asOf = today(state.settings.timezone)): AccountSummary {
  Temporal.PlainDate.from(asOf);
  const opening = state.accountOpening ?? null;
  const empty: AccountSummary = { opening, asOf, confirmedMinutes: null, closedMinutes: 0, entryMinutes: 0,
    provisionalMinutes: 0, plannedCompensationMinutes: 0, plannedEntryMinutes: 0, excludedEntries: [] };
  if (!opening) return empty;
  const entries = state.accountEntries ?? [];
  const result = { ...empty, excludedEntries: entries.filter(entry => entry.date < opening.date) };
  for (const entry of entries) {
    if (entry.date < opening.date) continue;
    if (entry.date <= asOf) result.entryMinutes += entry.minutes;
    else result.plannedEntryMinutes += entry.minutes;
  }
  for (const day of accountDays(state, opening.date, asOf)) {
    if (day.closed) result.closedMinutes += day.minutes;
    else result.provisionalMinutes += day.minutes;
  }
  for (const absence of state.absences ?? []) {
    if (absence.date >= opening.date && absence.date > asOf && absence.compensation)
      result.plannedCompensationMinutes += dayAccounting(state, absence.date).compensationMinutes;
  }
  if (opening.date <= asOf) result.confirmedMinutes = opening.minutes + result.closedMinutes + result.entryMinutes;
  return result;
}

/** All numbers are reconstructed from one state snapshot, rather than from today's mutable UI. */
export function accountPeriod(state: AppState, from: string, to: string, asOf = today(state.settings.timezone)): AccountPeriod {
  if (Temporal.PlainDate.compare(from, to) >= 0) throw new Error('Invalid account period.');
  const opening = state.accountOpening ?? null;
  const effectiveAsOf = asOf < to ? asOf : addDays(to, -1);
  const result: AccountPeriod = { opening, from, to, asOf: effectiveAsOf, startMinutes: null, endMinutes: null,
    provisionalMinutes: 0, plannedCompensationMinutes: 0, plannedEntryMinutes: 0, movements: [] };
  if (!opening) return result;
  if (from > opening.date && from <= asOf) result.startMinutes = accountSummary(state, addDays(from, -1)).confirmedMinutes;
  else if (from <= opening.date && opening.date <= effectiveAsOf) result.startMinutes = 0;
  result.endMinutes = from <= effectiveAsOf ? accountSummary(state, effectiveAsOf).confirmedMinutes : null;
  if (opening.date >= from && opening.date < to)
    result.movements.push({ date: opening.date, kind: 'opening', minutes: opening.minutes, reason: '' });
  for (const day of accountDays(state, from > opening.date ? from : opening.date, effectiveAsOf)) {
    if (day.closed) {
      if (day.minutes !== 0) result.movements.push({ date: day.date, kind: 'work', minutes: day.minutes, reason: '' });
    } else result.provisionalMinutes += day.minutes;
  }
  for (const entry of state.accountEntries ?? []) {
    if (entry.date < opening.date || entry.date < from || entry.date >= to) continue;
    result.movements.push({ date: entry.date, kind: entry.kind, minutes: entry.minutes, reason: entry.reason });
    if (entry.date > effectiveAsOf) result.plannedEntryMinutes += entry.minutes;
  }
  for (const absence of state.absences ?? []) {
    if (absence.compensation && absence.date >= opening.date && absence.date >= from && absence.date < to && absence.date > effectiveAsOf)
      result.plannedCompensationMinutes += dayAccounting(state, absence.date).compensationMinutes;
  }
  result.movements.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'opening' ? -1 : b.kind === 'opening' ? 1 : a.kind.localeCompare(b.kind)));
  return result;
}
