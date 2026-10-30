import { dayAccounting } from './calculations.js';
import { today } from './time.js';
import type { AppState, VacationAccount, VacationDay } from './types.js';

export function vacationForDay(vacations: VacationDay[], date: string): VacationDay | undefined {
  return vacations.find(vacation => vacation.date === date);
}

export function vacationAccount(state: AppState, year: number, asOf = today(state.settings.timezone)): VacationAccount {
  const allowance = state.vacationAllowances.find(value => value.year === year) ?? null;
  let takenDays = 0;
  let plannedDays = 0;
  for (const vacation of state.vacations) {
    if (Number(vacation.date.slice(0, 4)) !== year || dayAccounting(state, vacation.date).vacationMinutes <= 0) continue;
    if (vacation.date <= asOf) takenDays += vacation.fraction;
    else plannedDays += vacation.fraction;
  }
  return { year, allowance, takenDays, plannedDays,
    remainingDays: allowance ? allowance.entitlementDays + allowance.carryoverDays - takenDays - plannedDays : null };
}
