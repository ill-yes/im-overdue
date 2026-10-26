import { useMessages } from '../i18n.js';
import { calendarMessages } from '../locales/calendar.js';
import { MoreHorizontal, Plus, StickyNote, Sun } from 'lucide-react';
import { Popover } from '../components/Popover';
import { duration, longDate, shortDate as noteDateLabel } from '../format.js';
import { dateObj, durationLabel, fullDate, shortDate, weekday } from './format.js';
import type { CalendarDay } from './week-view-model.js';

interface CalendarDayHeadingProps {
  day: Pick<CalendarDay, 'date' | 'bounds' | 'total' | 'vacation'>;
  selected: boolean;
  note: string;
  busy: boolean;
  onReviewDay?: (date: string) => void;
  onNew: (date: string) => void;
  onNote: (date: string) => void;
  onVacation?: (date: string) => void;
}

export function CalendarDayHeading({
  day: { date, bounds, total, vacation },
  selected,
  note,
  busy,
  onReviewDay,
  onNew,
  onNote,
  onVacation,
}: CalendarDayHeadingProps) {
  const { t } = useMessages(calendarMessages);
  return (
    <div
      className="ov-calendar-dayhead"
      tabIndex={-1}
      aria-label={`${shortDate.format(dateObj(date))}${selected ? t('selectedDay') : ''}`}
    >
      {onReviewDay ? (
        <button
          className="ov-day-date ov-day-review"
          type="button"
          aria-label={t('openReviewFor', { date: shortDate.format(dateObj(date)) })}
          onClick={() => onReviewDay(date)}
        >
          <span>{weekday.format(dateObj(date))}</span>
          <strong>{fullDate.format(dateObj(date))}</strong>
        </button>
      ) : (
        <div className="ov-day-date">
          <span>{weekday.format(dateObj(date))}</span>
          <strong>{fullDate.format(dateObj(date))}</strong>
        </div>
      )}
      <div className="ov-day-totals">
        <span>{vacation ? t('work') : t('actual')} {durationLabel(total.actualMinutes)}</span>
        <span>{t('target')} {durationLabel(total.targetMinutes)}</span>
        {vacation && <span className="ov-day-vacation-credit">{t('vacation')} +{duration(total.vacationMinutes)}</span>}
      </div>
      {vacation && (
        <button className="ov-day-vacation" type="button" disabled={!onVacation || busy}
          aria-label={t('editVacationFor', { date: noteDateLabel(date) })}
          onClick={() => onVacation?.(date)}>
          <Sun size={11} /> {vacation.fraction === 0.5 ? t('halfVacation') : t('vacation')}
        </button>
      )}
      <div className="ov-day-actions">
        <button
          className="ov-day-add"
          type="button"
          title={t('enterWorkingTime')}
          aria-label={t('enterTimeFor', { date: shortDate.format(dateObj(date)) })}
          disabled={busy}
          onClick={() => onNew(date)}
        >
          <Plus size={16} />
        </button>
        <Popover label={t('actionsFor', { date: longDate(date) })} trigger={<><MoreHorizontal size={15} />{note && <span className="ov-note-dot" data-note-date={date} />}</>} className="ov-day-note" menu>
          <button role="menuitem" aria-label={t('openNoteFor', { date: noteDateLabel(date) })} onClick={() => onNote(date)}><StickyNote size={15} />{note ? t('editDayNote') : t('dayNote')}</button>
          {onVacation && <button role="menuitem" disabled={busy} aria-label={t('vacationFor', { date: noteDateLabel(date), action: vacation ? t('edit') : t('add') })} onClick={() => onVacation(date)}><Sun size={15} />{vacation ? t('editVacation') : t('addVacation')}</button>}
        </Popover>
      </div>
      {bounds.minutes !== 1440 && <div className="ov-dst-note">{t('dst', { hours: bounds.minutes / 60 })}</div>}
      <div className="ov-day-lane-labels"><span>{t('evidence')}</span><span>{t('workingTime')}</span></div>
    </div>
  );
}
