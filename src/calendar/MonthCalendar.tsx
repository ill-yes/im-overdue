import { useMemo } from 'react';
import { useMessages } from '../i18n.js';
import { calendarMessages } from '../locales/calendar.js';
import type { MonthOverview } from '../../shared/month.js';
import { StickyNote } from 'lucide-react';
import { noteText } from '../../shared/notes.js';
import type { AppState, CalendarNote, Source, VacationDay } from '../../shared/types.js';
import { duration, longDate, sourceLabel } from '../format.js';
import './month-calendar.css';
import { DayAbsenceSummary, dayAbsenceItems } from '../components/DayAbsenceSummary.js';

function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)));
}
function sourceDots(sources: Source[]) {
  return sources.map((source) => (
    <span className={`mo-source-dot mo-source-${source}`} key={source} title={sourceLabel(source)} />
  ));
}

export interface MonthCalendarProps {
  overview: MonthOverview;
  state?: AppState;
  notes: CalendarNote[];
  vacations?: VacationDay[];
  today: string;
  onSelectDay: (date: string) => void;
}

export function MonthCalendar({ overview, state, notes, vacations = [], today, onSelectDay }: MonthCalendarProps) {
  const { t, locale, language } = useMessages(calendarMessages);
  const weekdays = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(Date.UTC(2024, 0, 1 + index))));
  }, [locale]);
  const monthFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }), [locale]);
  const monthName = (date: string) => monthFormatter.format(new Date(`${date}T12:00:00Z`));
  const activityLabel = (count: number) => t(count === 1 ? 'activityOne' : 'activityMany', { count });
  return (
    <section className="mo-calendar" aria-label={t('monthCalendar')}>
      <p className="mo-calendar-hint">{t('monthHint')}</p>
      <div className="mo-calendar-scroll">
        <div className="mo-calendar-grid">
          {weekdays.map((day) => (
            <div className="mo-weekday" key={day} aria-hidden="true">
              {day}
            </div>
          ))}
          {overview.days.map((day) => {
            const untouched = day.status === 'untouched';
            const actual = duration(day.totals.actualMinutes);
            const balance = untouched ? '—' : duration(day.totals.balanceMinutes, true);
            const sources = (day.activitySourceNames ?? day.activitySources.map(source => sourceLabel(source))).join(', ');
            const hasNote = Boolean(noteText(notes, 'day', day.date));
            const vacation = vacations.find((item) => item.date === day.date);
            const vacationLabel = vacation?.fraction === 0.5 ? t('halfVacation') : t('vacation');
            const absenceItems = state ? dayAbsenceItems(state, day.date, language) : [];
            const absenceLabel = absenceItems.map(item => `${item.label}: ${item.detail}`).join('. ');
            const label = `${longDate(day.date)}, ${t(`status.${day.status}`)}. ${vacation ? t('work') : t('actual')} ${actual}, ${t('target')} ${duration(day.totals.targetMinutes)}${state ? (absenceLabel ? `, ${absenceLabel}` : '') : vacation ? `, ${vacationLabel}, ${t('vacation')} +${duration(day.totals.vacationMinutes)}` : ''}, ${t('dailyBalance')} ${balance}. ${activityLabel(day.activityCount)}${sources ? t('fromSources', { sources }) : ''}.${hasNote ? ` ${t('noteExists')}.` : ''} ${t('openWeek')}`;
            return (
              <button
                className={`mo-day${day.inMonth ? '' : ' mo-day-outside'}${day.isWeekend ? ' mo-day-weekend' : ''}${day.date === today ? ' mo-day-today' : ''}`}
                type="button"
                key={day.date}
                data-month-day={day.date}
                data-in-month={String(day.inMonth)}
                data-day-status={day.status}
                aria-label={label}
                aria-current={day.date === today ? 'date' : undefined}
                onClick={() => onSelectDay(day.date)}
              >
                <span className="mo-day-top">
                  <span className="mo-day-date">
                    {dayNumber(day.date)}
                    {!day.inMonth && <small>{monthName(day.date)}</small>}
                  </span>
                  <span className={`mo-day-state mo-day-state-${day.status}`}>{t(`status.${day.status}`)}</span>
                </span>
                <span className="mo-day-times">
                  <span>
                    {vacation ? t('work') : t('actual')} <strong>{actual}</strong>
                  </span>
                  <span>
                    {t('target')} <strong>{duration(day.totals.targetMinutes)}</strong>
                  </span>
                </span>
                {state && absenceItems.length > 0 && <DayAbsenceSummary state={state} date={day.date} items={absenceItems} />}
                {!state && vacation && <span className="mo-day-vacation"><span>{vacationLabel}</span> +{duration(day.totals.vacationMinutes)}</span>}
                <span
                  className={`mo-day-balance${!untouched && day.totals.balanceMinutes < 0 ? ' mo-day-negative' : ''}`}
                >
                  <span>{t('balance')}</span>
                  <strong>{balance}</strong>
                </span>
                <span className="mo-day-activity">
                  {day.activityCount > 0 ? (
                    <>
                      <span className="mo-source-list" aria-hidden="true">
                        {sourceDots(day.activitySources)}
                      </span>
                      <span>{activityLabel(day.activityCount)}</span>
                    </>
                  ) : (
                    <span>{t('noActivities')}</span>
                  )}
                </span>
                {hasNote && (
                  <span className="mo-day-note" data-note-date={day.date}>
                    <StickyNote size={12} aria-hidden="true" /> {t('noteExists')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
