import { accountExportRows, filteredTimesheetDays, timesheetSummary } from '../../shared/timesheet.js';
import { timesheetMessages } from '../../shared/timesheet-messages.js';
import { Temporal, weekStartFor } from '../../shared/time.js';
import type { PeriodPart, TimesheetDay, TimesheetOptions, TimesheetSnapshot } from '../../shared/types.js';
import { shortDate, weekLabel } from '../format';
import { reportBlockTime, reportDate, reportDuration } from '../timesheet-format';
import { useMessages } from '../i18n';
import { exportMessages } from '../locales/exports';
import { accountingExportMessages } from '../locales/accounting-export';

function AccountSection({ snapshot }: { snapshot: TimesheetSnapshot }) {
  const { t: a, language } = useMessages(accountingExportMessages);
  const { t } = useMessages(timesheetMessages);
  const account = snapshot.account;
  if (!account) return <p className="timesheet-coverage">{a('accountUnavailable')}</p>;
  const rows = accountExportRows(snapshot);
  return <section className="timesheet-account" aria-label={a('accountTitle')}>
    <h4>{a('accountTitle')}</h4>
    <p className="timesheet-coverage">{a('accountScope', { date: shortDate(account.asOf, language) })}</p>
    {account.opening && <p className="timesheet-coverage">{a('openingDate', { date: shortDate(account.opening.date, language) })} · {reportDuration(account.opening.minutes, true)}</p>}
    {(!account.opening || account.opening.date > account.asOf) ? <p className="timesheet-draft-notice">{a('noOpening')}</p>
      : account.from > account.asOf ? <p className="timesheet-draft-notice">{a('futurePeriod')}</p> : null}
    <div className="timesheet-table-scroll" role="region" aria-label={a('accountTitle')} tabIndex={0}>
      <table className="timesheet-account-table">
        <thead><tr><th scope="col">{t('date')}</th><th scope="col">{t('entryType')} / {t('reason')}</th><th scope="col">{t('status')}</th><th scope="col">{a('balance')}</th></tr></thead>
        {(['closed', 'open', 'planned'] as const).map(status => <tbody key={status} className={`timesheet-account-${status}`}>
          <tr className="timesheet-account-group"><th colSpan={4} scope="rowgroup">{t(status)}</th></tr>
          {rows.filter(row => row.status === status).map((row, index) => <tr key={`${row.kind}-${index}`} className={row.kind === 'startBalance' || row.kind === 'endBalance' ? 'timesheet-account-total' : undefined}>
          <td>{shortDate(row.date, language)}</td><th scope="row">{t(row.kind)}{row.reason && <span className="timesheet-account-reason">{row.reason}</span>}</th>
          <td>{t(row.status)}</td><td>{row.minutes === null ? a('unknownBalance') : reportDuration(row.minutes, true)}</td>
        </tr>)}</tbody>)}
      </table>
    </div>
  </section>;
}

function dayCredits(day: TimesheetDay) {
  return {
    vacation: day.accounting?.vacationMinutes ?? day.totals.vacationMinutes,
    sickness: day.accounting?.sicknessMinutes ?? 0,
    holiday: day.accounting?.holidayMinutes ?? 0,
  };
}

function totalCredits(credits: ReturnType<typeof dayCredits>) {
  return credits.vacation + credits.sickness + credits.holiday;
}

function SummaryRow({ label, part, days }: { label: string; part: PeriodPart; days: TimesheetDay[] }) {
  const { t: a } = useMessages(accountingExportMessages);
  const credits = days.reduce((sum, day) => {
    const value = dayCredits(day);
    return { vacation: sum.vacation + value.vacation, sickness: sum.sickness + value.sickness, holiday: sum.holiday + value.holiday };
  }, { vacation: 0, sickness: 0, holiday: 0 });
  return <tr>
    <th scope="row" colSpan={2}>{label}<span className="timesheet-credit-breakdown">{a('creditBreakdown', {
      vacation: reportDuration(credits.vacation), sickness: reportDuration(credits.sickness), holiday: reportDuration(credits.holiday),
    })}</span></th>
    <td>{reportDuration(part.actualMinutes)}</td>
    <td>{reportDuration(totalCredits(credits))}</td>
    <td>{reportDuration(part.targetMinutes)}</td>
    <td>{reportDuration(part.balanceMinutes, true)}</td>
  </tr>;
}

/** The screen preview and print portal deliberately render the same document. */
export function TimesheetDocument({ snapshot, options }: { snapshot: TimesheetSnapshot; options: TimesheetOptions }) {
  const { t, locale, language } = useMessages(exportMessages);
  const { t: a } = useMessages(accountingExportMessages);
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
    <p className="timesheet-credit-note">{a('creditExplanation')}</p>
    <div className="timesheet-table-scroll" role="region" aria-label={t('tableLabel')} tabIndex={0}>
      <table className="timesheet-table">
        <colgroup><col className="timesheet-date-column" /><col className="timesheet-work-column" /><col /><col /><col /><col /></colgroup>
        <thead><tr><th scope="col">{t('date')}</th><th scope="col">{t('workingTimes')}</th><th scope="col">{t('work')}</th><th scope="col">{a('credits')}</th><th scope="col">{t('target')}</th><th scope="col">{t('balance')}</th></tr></thead>
        <tbody>{days.map(day => {
          const week = weekStartFor(day.date);
          const showWeekNote = options.includeWeekNotes && !seenWeeks.has(week) && day.weekNote;
          seenWeeks.add(week);
          const quiet = day.totals.actualMinutes === 0 && day.totals.vacationMinutes === 0 && day.totals.targetMinutes === 0;
          const accounting = day.accounting;
          const planned = !!snapshot.account && day.date > snapshot.account.asOf;
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
              {(accounting?.vacationFraction ?? day.vacationFraction) > 0 && <div className="timesheet-vacation">{t((accounting?.vacationFraction ?? day.vacationFraction) === 0.5 ? 'leaveHalf' : 'leaveFull')}</div>}
              {accounting && <div className="timesheet-absence">
                {accounting.holiday && <div>{a('holiday')} · {language === 'en' ? accounting.holiday.nameEn : accounting.holiday.name} · {reportDuration(accounting.holidayMinutes)}</div>}
                {accounting.sicknessMinutes > 0 && <div>{a('sickness')} · {reportDuration(accounting.sicknessMinutes)}</div>}
                {accounting.compensationMinutes > 0 && <div>{a('compensation')} · {reportDuration(accounting.compensationMinutes)}</div>}
                {accounting.compensationRequestedMinutes !== accounting.compensationMinutes && accounting.compensationRequestedMinutes > 0 && <div>{a('requestedCompensation', { duration: reportDuration(accounting.compensationRequestedMinutes) })}</div>}
                {accounting.uncoveredMinutes > 0 && <div className="timesheet-uncovered">{a('uncovered')} · {reportDuration(accounting.uncoveredMinutes)}</div>}
                {planned && (accounting.vacationMinutes > 0 || accounting.holidayMinutes > 0 || accounting.sicknessMinutes > 0 || accounting.compensationRequestedMinutes > 0) && <div className="timesheet-uncovered">{a('plannedDaily')}</div>}
              </div>}
              {day.blocks.length === 0 && day.vacationFraction === 0 && !accounting?.holiday && !accounting?.sicknessMinutes && !accounting?.compensationRequestedMinutes && !accounting?.uncoveredMinutes && <span className="timesheet-no-blocks">—</span>}
              {day.status !== 'closed' && <span className={`timesheet-status ${day.status}`}>{t(day.status === 'open' ? 'provisional' : 'unrecorded')}</span>}
              {options.includeDayNotes && day.dayNote && <p className="timesheet-note"><strong>{t('dayNote')}</strong> {day.dayNote}</p>}
              {showWeekNote && <p className="timesheet-note"><strong>{t('weekNote', { week: weekLabel(week, language) })}</strong> {day.weekNote}</p>}
            </td>
            <td>{reportDuration(day.totals.actualMinutes)}</td>
            <td>{reportDuration(totalCredits(dayCredits(day)))}</td>
            <td>{reportDuration(day.totals.targetMinutes)}</td>
            <td>{day.status === 'untouched' ? '' : reportDuration(day.totals.balanceMinutes, true)}</td>
          </tr>;
        })}{!days.length && <tr><td colSpan={6} className="timesheet-empty">{t('empty')}</td></tr>}</tbody>
        {(summary.confirmed.days > 0 || summary.provisional.days > 0) && <tfoot>
          {summary.confirmed.days > 0 && <SummaryRow label={t(provisional ? 'closedTotal' : 'total')} part={summary.confirmed} days={days.filter(day => day.status === 'closed')} />}
          {summary.provisional.days > 0 && <SummaryRow label={t('provisionalTotal')} part={summary.provisional} days={days.filter(day => day.status === 'open')} />}
        </tfoot>}
      </table>
    </div>
    {options.includeAccount && <AccountSection snapshot={snapshot} />}
    <footer className="timesheet-document-footer">
      <p>{t(provisional ? 'footerProvisional' : 'footerClosed')} · {t('acknowledgement')}</p>
      <p>{t('footerDetails', { timezone: snapshot.timezone, createdAt })}</p>
    </footer>
  </article>;
}
