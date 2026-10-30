import { dayAccounting } from '../../shared/calculations.js';
import { holidayReviewRequired } from '../../shared/holidays.js';
import { translate, type Language } from '../../shared/i18n.js';
import type { AppState } from '../../shared/types.js';
import { duration } from '../format.js';
import { useMessages } from '../i18n.js';
import { absenceSummaryMessages } from '../locales/absence-summary.js';
import './day-absence-summary.css';

type AbsenceItem = { kind: 'holiday' | 'vacation' | 'sickness' | 'compensation' | 'review'; label: string; detail: string };

/** Day metadata is computed from the complete state, independently of evidence filters. */
export function dayAbsenceItems(state: AppState, date: string, language: Language): AbsenceItem[] {
  const t = (key: keyof typeof absenceSummaryMessages, params?: Record<string, string>) =>
    translate(absenceSummaryMessages, key, params, language);
  const accounting = dayAccounting(state, date);
  const absence = state.absences?.find(item => item.date === date);
  const vacation = state.vacations.find(item => item.date === date);
  const items: AbsenceItem[] = [];
  if (holidayReviewRequired(state, date)) items.push({ kind: 'review', label: t('holidayReview'), detail: t('holidayReviewDetail') });
  const credit = (minutes: number) => t('credited', { duration: duration(minutes) });
  const suspended = accounting.holiday ? ` · ${t('suspended')}` : '';
  if (accounting.holiday) items.push({ kind: 'holiday',
    label: language === 'en' ? accounting.holiday.nameEn : accounting.holiday.name,
    detail: credit(accounting.holidayMinutes) });
  if (vacation) items.push({ kind: 'vacation', label: t(vacation.fraction === 0.5 ? 'halfVacation' : 'vacation'),
    detail: credit(accounting.vacationMinutes) + suspended });
  if (absence?.sickness) items.push({ kind: 'sickness', label: t('sickness'),
    detail: credit(accounting.sicknessMinutes) + suspended });
  if (absence?.compensation) {
    const unused = Math.max(0, accounting.compensationRequestedMinutes - accounting.compensationMinutes);
    items.push({ kind: 'compensation', label: t('compensation'),
      detail: t('compensationUsed', { duration: duration(accounting.compensationMinutes) })
        + (unused > 0 ? ` · ${t('unused', { duration: duration(unused) })}` : '') + suspended });
  }
  return items;
}

export function DayAbsenceSummary({ state, date, className = '', items }: {
  state: AppState; date: string; className?: string; items?: AbsenceItem[];
}) {
  const { language } = useMessages(absenceSummaryMessages);
  const summaries = items ?? dayAbsenceItems(state, date, language);
  return <span className={`day-absence-summary ${className}`} data-day-absences={date}>
    <span className="day-absence-items">
      {summaries.map(item => <span key={item.kind} className={`day-absence-item is-${item.kind}`} data-absence-kind={item.kind}>
        <span className="day-absence-label">{item.label}</span>
        <span className="day-absence-detail">{item.detail}</span>
      </span>)}
    </span>
  </span>;
}
