import { useMessages } from '../i18n.js';
import { calendarMessages } from '../locales/calendar.js';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Plus, Search, StickyNote, Sun, X } from 'lucide-react';
import { noteText } from '../../shared/notes.js';
import { dayReviewData, filterDayReview, pageDayReview, reviewRowTime } from '../../shared/day-review.js';
import { addDays } from '../../shared/time.js';
import type { Activity, AppState } from '../../shared/types.js';
import { activityKey, activitySourceName } from '../../shared/data-sources.js';
import { duration, longDate } from '../format.js';
import { safeExternalUrl } from '../links.js';
import './day-review.css';


export interface DayReviewProps {
  state: AppState;
  date: string;
  enabledSources: string[];
  busy: boolean;
  onSelectDay: (date: string) => void;
  onShowActivity: (activity: Activity) => void;
  onNew: () => void;
  onNote: () => void;
  onVacation?: (date: string) => void;
  onClose: () => void;
}

export function DayReview({
  state,
  date,
  enabledSources,
  busy,
  onSelectDay,
  onShowActivity,
  onNew,
  onNote,
  onVacation,
  onClose,
}: DayReviewProps) {
  const { t } = useMessages(calendarMessages);
  const [query, setQuery] = useState('');
  const [pageState, setPageState] = useState({ key: '', count: 50 });
  const sourceKey = JSON.stringify(enabledSources);
  const pageKey = JSON.stringify([date, sourceKey, query]);
  const visible = pageState.key === pageKey ? pageState.count : 50;
  const review = useMemo(() => dayReviewData(state, date, enabledSources), [state, date, sourceKey]);
  const matches = useMemo(() => filterDayReview(review.rows, query), [review.rows, query]);
  const page = useMemo(() => pageDayReview(matches, visible), [matches, visible]);
  const note = noteText(state.notes, 'day', date);
  const vacation = state.vacations.find((item) => item.date === date);

  return (
    <aside id="day-review" className="day-review" aria-label={t('reviewFor', { date: longDate(date) })}>
      <header className="dr-head">
        <div>
          <span className="dr-eyebrow">{t('dayReview')}</span>
          <h2>{longDate(date)}</h2>
        </div>
        <button
          className="dr-icon"
          type="button"
          aria-label={t('closeReview')}
          title={t('close')}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="dr-nav">
        <button
          className="dr-icon"
          type="button"
          aria-label={t('previousDay')}
          onClick={() => onSelectDay(addDays(date, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <label className="dr-date">
          <span>{t('date')}</span>
          <input
            type="date"
            aria-label={t('selectDay')}
            value={date}
            onChange={(event) => {
              if (event.target.value) onSelectDay(event.target.value);
            }}
          />
        </label>
        <button
          className="dr-icon"
          type="button"
          aria-label={t('nextDay')}
          onClick={() => onSelectDay(addDays(date, 1))}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className={`dr-summary${vacation ? ' has-vacation' : ''}`}>
        <div>
          <span>{vacation ? t('work') : t('actual')}</span>
          <strong>{duration(review.totals.actualMinutes)}</strong>
        </div>
        {vacation && <div className="dr-vacation-total"><span>{vacation.fraction === 0.5 ? t('halfVacation') : t('vacation')}</span>
          <strong>+{duration(review.totals.vacationMinutes)}</strong></div>}
        <div>
          <span>{t('target')}</span>
          <strong>{duration(review.totals.targetMinutes)}</strong>
        </div>
        <div className="dr-weekstatus">
          <span>{t('week')}</span>
          <strong data-day-review-status={review.status}>{t(`status.${review.status}`)}</strong>
        </div>
      </div>
      <button className="dr-new" type="button" disabled={busy} onClick={onNew}>
        <Plus size={15} /> {t('enterTime')}
      </button>
      <section className="dr-note" aria-label={t('noteForDay')}>
        {onVacation && <button className="button secondary dr-vacation-action" type="button" disabled={busy}
          onClick={() => onVacation(date)}><Sun size={15} /> {vacation ? t('editVacation') : t('addVacation')}</button>}
        <button className="button secondary" type="button" onClick={onNote}>
          <StickyNote size={15} /> {t('dayNote')}
        </button>
        {note ? (
          <p className="dr-note-preview">{note}</p>
        ) : (
          <span className="dr-note-hint">{t('noteHint')}</span>
        )}
      </section>
      <div className="dr-evidence-head">
        <div>
          <strong>{t('evidence')}</strong>
          <span>{review.rows.length}</span>
        </div>
        <small>{review.timezone}</small>
      </div>
      <label className="dr-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          aria-label={t('searchActivities')}
          placeholder={t('searchEvidence')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {review.rows.length === 0 ? (
        <div className="dr-empty">
          {review.totalActivityCount === 0
            ? t('noActivitiesForDay')
            : t('noSourcesMatch')}
        </div>
      ) : matches.length === 0 ? (
        <div className="dr-empty">{t('noQueryMatch', { query: query.trim() })}</div>
      ) : (
        <>
          <div className="dr-list" aria-label={t('dayActivities')}>
            {page.rows.map((row) => {
              const activity = row.activity;
              const url = safeExternalUrl(activity.url);
              return (
                <article
                  className={`dr-activity dr-source-${activity.source}`}
                  key={activityKey(activity)}
                  data-review-activity={activityKey(activity)}
                >
                  <div className="dr-row-meta">
                    <span className="dr-source">{activitySourceName(activity, state.dataSources)}</span>
                    <time>{reviewRowTime(row, date, review.timezone)}</time>
                  </div>
                  <h3>{activity.title}</h3>
                  {(row.startsBeforeDay || row.endsAfterDay) && (
                    <p className="dr-clipped">
                      {row.startsBeforeDay && row.endsAfterDay
                        ? t('startsBeforeEndsAfter')
                        : row.startsBeforeDay
                          ? t('startsBefore')
                          : t('endsAfter')}
                    </p>
                  )}
                  <div className="dr-row-actions">
                    <button type="button" onClick={() => onShowActivity(activity)}>
                      {t('showInCalendar')}
                    </button>
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                        {t('source')} <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {page.remaining > 0 && (
            <button
              className="dr-more"
              type="button"
              onClick={() => setPageState({ key: pageKey, count: visible + 50 })}
            >
              {t('showMore')} <span>{t('remaining', { count: page.remaining })}</span>
            </button>
          )}
        </>
      )}
    </aside>
  );
}
