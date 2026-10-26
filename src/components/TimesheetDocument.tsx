import { filteredTimesheetDays, timesheetSummary } from '../../shared/timesheet.js';
import { Temporal, weekStartFor } from '../../shared/time.js';
import type { PeriodPart, TimesheetOptions, TimesheetSnapshot } from '../../shared/types.js';
import { shortDate, weekLabel } from '../format';
import { reportBlockTime, reportDate, reportDuration } from '../timesheet-format';
import { useMessages } from '../i18n';
import { exportMessages } from '../locales/exports';

function SummaryRow({ label, part }: { label: string; part: PeriodPart }) {
  return <tr>
    <th scope="row" colSpan={2}>{label}</th>
    <td>{reportDuration(part.actualMinutes)}</td>
    <td>{reportDuration(part.vacationMinutes)}</td>
    <td>{reportDuration(part.targetMinutes)}</td>
    <td>{reportDuration(part.balanceMinutes, true)}</td>
  </tr>;
}

/** The screen preview and print portal deliberately render the same document. */
export function TimesheetDocument({ snapshot, options }: { snapshot: TimesheetSnapshot; options: TimesheetOptions }) {
  const { t, locale, language } = useMessages(exportMessages);
  const days = filteredTimesheetDays(snapshot, options);
  const summary = timesheetSummary(snapshot, options);
  const omitted = snapshot.days.length - days.length;
  const through = Temporal.PlainDate.from(snapshot.to).subtract({ days: 1 }).toString();
  const includeYear = snapshot.from.slice(0, 4) !== through.slice(0, 4);
  const provisional = days.some(day => day.status !== 'closed');
  const seenWeeks = new Set<string>();
  const createdAt = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium', timeStyle: 'short', hour12: false, timeZone: snapshot.timezone,
  }).format(new Date(snapshot.createdAt));

  return <article className="timesheet-document">
    <header className="timesheet-document-header">
      <div><h3>{t('documentTitle')}</h3>{options.name.trim() && <p className="timesheet-person">{options.name.trim()}</p>}</div>
      <p className="timesheet-document-period">{shortDate(snapshot.from, language)} - {shortDate(through, language)}</p>
    </header>
    {omitted > 0 && <p className="timesheet-coverage">{t('coverage', { included: days.length, total: snapshot.days.length, omitted })}</p>}
    {provisional && <p className="timesheet-draft-notice">{t('draftNotice')}</p>}
    <div className="timesheet-table-scroll" role="region" aria-label={t('tableLabel')} tabIndex={0}>
      <table className="timesheet-table">
        <colgroup><col className="timesheet-date-column" /><col className="timesheet-work-column" /><col /><col /><col /><col /></colgroup>
        <thead><tr><th scope="col">{t('date')}</th><th scope="col">{t('workingTimes')}</th><th scope="col">{t('work')}</th><th scope="col">{t('leave')}</th><th scope="col">{t('target')}</th><th scope="col">{t('balance')}</th></tr></thead>
        <tbody>{days.map(day => {
          const week = weekStartFor(day.date);
          const showWeekNote = options.includeWeekNotes && !seenWeeks.has(week) && day.weekNote;
          seenWeeks.add(week);
          const quiet = day.totals.actualMinutes === 0 && day.totals.vacationMinutes === 0 && day.totals.targetMinutes === 0;
          const selectedTextLength = day.blocks.reduce((length, block) => length + (options.includeTitles ? block.title.length : 0) + (options.includeBlockNotes ? block.note.length : 0), 0)
            + (options.includeDayNotes ? day.dayNote.length : 0) + (showWeekNote ? day.weekNote.length : 0);
          const rowClass = [quiet ? 'timesheet-day-quiet' : '', selectedTextLength > 1000 || day.blocks.length > 12 ? 'timesheet-day-expanded' : ''].filter(Boolean).join(' ');
          return <tr key={day.date} className={rowClass || undefined} data-timesheet-day={day.date}>
            <th scope="row" className="timesheet-date">{reportDate(day.date, includeYear, language)}</th>
            <td className="timesheet-intervals">
              {day.blocks.map((block, index) => <div className="timesheet-block" key={`${block.start}-${index}`}>
                <div className="timesheet-block-line">
                  <span className="timesheet-block-time">{reportBlockTime(day, block, snapshot.timezone)}</span>
                  {options.includeTitles && block.title && <span className="timesheet-block-title">{block.title}</span>}
                </div>
                {options.includeBlockNotes && block.note && <p className="timesheet-note"><strong>{t('blockNote')}</strong> {block.note}</p>}
              </div>)}
              {day.vacationFraction > 0 && <div className="timesheet-vacation">{t(day.vacationFraction === 0.5 ? 'leaveHalf' : 'leaveFull')}</div>}
              {day.blocks.length === 0 && day.vacationFraction === 0 && <span className="timesheet-no-blocks">—</span>}
              {day.status !== 'closed' && <span className={`timesheet-status ${day.status}`}>{t(day.status === 'open' ? 'provisional' : 'unrecorded')}</span>}
              {options.includeDayNotes && day.dayNote && <p className="timesheet-note"><strong>{t('dayNote')}</strong> {day.dayNote}</p>}
              {showWeekNote && <p className="timesheet-note"><strong>{t('weekNote', { week: weekLabel(week, language) })}</strong> {day.weekNote}</p>}
            </td>
            <td>{reportDuration(day.totals.actualMinutes)}</td>
            <td>{reportDuration(day.totals.vacationMinutes)}</td>
            <td>{reportDuration(day.totals.targetMinutes)}</td>
            <td>{day.status === 'untouched' ? '' : reportDuration(day.totals.balanceMinutes, true)}</td>
          </tr>;
        })}{!days.length && <tr><td colSpan={6} className="timesheet-empty">{t('empty')}</td></tr>}</tbody>
        {(summary.confirmed.days > 0 || summary.provisional.days > 0) && <tfoot>
          {summary.confirmed.days > 0 && <SummaryRow label={t(provisional ? 'closedTotal' : 'total')} part={summary.confirmed} />}
          {summary.provisional.days > 0 && <SummaryRow label={t('provisionalTotal')} part={summary.provisional} />}
        </tfoot>}
      </table>
    </div>
    <footer className="timesheet-document-footer">
      <p>{t(provisional ? 'footerProvisional' : 'footerClosed')} · {t('acknowledgement')}</p>
      <p>{t('footerDetails', { timezone: snapshot.timezone, createdAt })}</p>
    </footer>
  </article>;
}
