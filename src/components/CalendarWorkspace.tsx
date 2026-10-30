import { undoLabel } from '../locales/shell.js';
import { useMessages } from '../i18n.js';
import { calendarMessages } from '../locales/calendar.js';
import { useMemo, type Ref } from 'react';
import { ArrowDownToLine, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Filter, ListChecks, Maximize2, Minimize2, MoreHorizontal, Palmtree, Plus, StickyNote, Undo2 } from 'lucide-react';
import { Calendar, type CalendarProps } from '../Calendar';
import { MonthCalendar } from '../MonthCalendar';
import { dayAccounting, periodSummary, weekTotals } from '../../shared/calculations.js';
import { intersectsRange, toActivityInterval, toInstantRange } from '../../shared/activities.js';
import { monthOverview } from '../../shared/month.js';
import { noteText } from '../../shared/notes.js';
import { addDays, datesInRange, dayBounds, periodBounds, Temporal, weekStartFor } from '../../shared/time.js';
import { type Activity, type NoteScope } from '../../shared/types.js';
import { duration, periodLabel, weekLabel } from '../format';
import { DayReview } from './DayReview';
import { Popover } from './Popover';
import type { TimesheetPreset } from './TimesheetDialog';
import { absenceSummaryMessages } from '../locales/absence-summary.js';

type CalendarView = 'week' | 'month';
type CalendarActions = {
  navigate: (date: string, selectDay?: boolean) => void;
  movePeriod: (step: number) => void;
  setView: (view: CalendarView) => void;
  openReuse: () => void;
  toggleFocus: () => void;
  openReportsMonth: () => void;
  undoLastChange: () => void;
  toggleSource: (source: string) => void;
  openNote: (scope: NoteScope, date: string) => void;
  openTimesheet: (preset: TimesheetPreset) => void;
  setWeekStatus: () => void;
  closeReview: () => void;
  showActivity: (activity: Activity) => void;
  openDay: (date: string) => void;
};
type CalendarWorkspaceProps = {
  anchorDate: string;
  view: CalendarView;
  currentDay: string;
  entryDate: string;
  reviewDate?: string;
  closed: boolean;
  focused: boolean;
  gestureActive: boolean;
  reviewToggle: Ref<HTMLButtonElement>;
  vacationToggle: Ref<HTMLButtonElement>;
  focusToggle: Ref<HTMLButtonElement>;
  calendar: CalendarProps & {
    onReviewDay: (date: string) => void;
    onVacation: (date: string) => void;
  };
  actions: CalendarActions;
};

/** Calendar presentation and derived summaries; sessions and writes stay in App. */
export function CalendarWorkspace({ anchorDate, view, currentDay, entryDate, reviewDate, closed, focused, gestureActive, reviewToggle, vacationToggle, focusToggle, calendar, actions }: CalendarWorkspaceProps) {
  const { t, language } = useMessages(calendarMessages);
  const { t: a } = useMessages(absenceSummaryMessages);
  const { active = true, state, weekStart: week, enabledSources: sources, busy, quickDraft: quickCreate,
    onNew: openEditor, onReviewDay: openReview, onVacation: openVacation } = calendar;
  const { navigate, movePeriod, setView, openReuse, toggleFocus, openReportsMonth, undoLastChange,
    toggleSource, openNote, openTimesheet, setWeekStatus, closeReview, showActivity, openDay } = actions;
  const totals = useMemo(() => weekTotals(state, week), [state, week]);
  const report = useMemo(() => {
    const { from, to } = periodBounds(anchorDate, 'month');
    return periodSummary(state, from, to);
  }, [state, anchorDate]);
  const month = useMemo(() => view === 'month' ? monthOverview(state, anchorDate, sources) : null,
    [state, view, anchorDate, sources]);
  const absenceTotals = useMemo(() => {
    const range = view === 'week' ? { from: week, to: addDays(week, 7) } : periodBounds(anchorDate, 'month');
    return datesInRange(range.from, range.to).reduce((sum, date) => {
      const day = dayAccounting(state, date);
      return { holiday: sum.holiday + day.holidayMinutes, sickness: sum.sickness + day.sicknessMinutes,
        compensation: sum.compensation + day.compensationMinutes };
    }, { holiday: 0, sickness: 0, compensation: 0 });
  }, [state, week, anchorDate, view]);
  const absenceTotalItems = (Object.keys(absenceTotals) as (keyof typeof absenceTotals)[])
    .filter(key => absenceTotals[key] > 0);
  const absenceSummary = absenceTotalItems.length > 0 && <div className="summary-item summary-absence-totals">
    {absenceTotalItems.map(key => <span key={key}>{a(key)} <strong>{duration(absenceTotals[key])}</strong></span>)}
  </div>;
  const weeklyNote = noteText(state.notes, 'week', week);
  const future = week > weekStartFor(currentDay);
  const activityCount = useMemo(() => {
    const range = toInstantRange(dayBounds(week, state.settings.timezone).start,
      dayBounds(addDays(week, 7), state.settings.timezone).start);
    return state.activities.filter(activity => intersectsRange(toActivityInterval(activity), range)).length;
  }, [state.activities, state.settings.timezone, week]);
  return (
    <section hidden={!active} className="calendar-workspace" aria-label={t('workspace')}>
      <h1 className="sr-only">{t('calendar')}</h1>
      {totals && <>
        <section className="workspace-toolbar" aria-label={view === 'week' ? t('weekControls') : t('monthControls')}>
          <div className="week-nav">
            <button className="icon-button" onClick={() => movePeriod(-1)} aria-label={view === 'week' ? t('previousWeek') : t('previousMonth')}><ChevronLeft size={20} /></button>
            <label className="week-identity" title={view === 'week' ? t('chooseWeek') : t('chooseMonth')}>
              <strong>{view === 'week' ? weekLabel(week) : periodLabel(anchorDate, 'month')}</strong>
              <span>{view === 'week' ? t('weekNumber', { number: Temporal.PlainDate.from(week).weekOfYear! }) : t('calendarMonth')} · {state.settings.timezone} <ChevronDown size={12} /></span>
              {view === 'week' ? <input type="date" aria-label={t('chooseWeekDate')} value={anchorDate} onChange={e => { if(e.target.value) navigate(e.target.value, true); }} /> : <input type="month" aria-label={t('chooseMonth')} value={anchorDate.slice(0, 7)} onChange={e => { if(e.target.value) navigate(`${e.target.value}-01`); }} />}
            </label>
            <button className="icon-button" onClick={() => movePeriod(1)} aria-label={view === 'week' ? t('nextWeek') : t('nextMonth')}><ChevronRight size={20} /></button>
          </div>
          <div className="toolbar-right">
            <button className="button quiet today-button" onClick={() => navigate(currentDay, true)}>{t('today')}</button>
            <div className="segmented view-switch" role="group" aria-label={t('calendarView')}>
              <button className={view === 'week' ? 'selected' : ''} aria-pressed={view === 'week'} onClick={() => setView('week')}>{t('week')}</button>
              <button className={view === 'month' ? 'selected' : ''} aria-pressed={view === 'month'} onClick={() => setView('month')}>{t('month')}</button>
            </div>
            {view === 'week' && <>
              <div className="entry-split"><button className="button primary" onClick={() => openEditor(entryDate)}><Plus size={16} />{t('enterTime')}</button>
                <button className="button primary entry-choices" aria-label={t('quickSelection')} title={t('reuseHint')} onClick={openReuse}><ChevronDown size={17} /></button></div>
              <button ref={focusToggle} className={`icon-button focus-toggle${focused ? ' selected' : ''}`} aria-pressed={focused} aria-label={focused ? t('exitFocus') : t('focusView')} title={focused ? t('exitFocusShortcut') : t('enlargeWeek')} onClick={toggleFocus} disabled={gestureActive}>{focused ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
            </>}
          </div>
        </section>
        {view === 'week' ? <section className="summary-strip" aria-label={t('weeklySummary')}>
          <div className="summary-item"><span>{t('work')}</span><strong>{duration(totals.actualMinutes)}</strong></div>
          <div className="summary-item"><span>{t('target')}</span><strong>{duration(totals.targetMinutes)}</strong></div>
          {totals.vacationMinutes > 0 && <div className="summary-item"><span>{t('vacation')}</span><strong>{duration(totals.vacationMinutes)}</strong></div>}
          {absenceSummary}
          <div className="summary-item"><span>{t('weeklyBalance')} <small>{closed ? t('closedLower') : t('provisionalLower')}</small></span><strong className={totals.balanceMinutes < 0 ? 'negative' : 'positive'}>{duration(totals.balanceMinutes, true)}</strong></div>
          <button className="summary-item summary-link" aria-label={t('openMonthBalance')} onClick={openReportsMonth}><span>{periodLabel(anchorDate, 'month')} · {t('confirmedLower')} <ChevronRight size={12} /></span><strong className={report?.confirmed.balanceMinutes && report.confirmed.balanceMinutes < 0 ? 'negative' : 'positive'}>{report?.confirmed.days ? duration(report.confirmed.balanceMinutes, true) : '—'}</strong></button>
        </section> : month && <section className="summary-strip" aria-label={t('monthlySummary')}>
          <div className="summary-item"><span>{t('workingTime')}</span><strong>{duration(month.actualMinutes)}</strong></div>
          <button className="summary-item summary-link" onClick={openReportsMonth}><span>{t('confirmedBalance')} <ChevronRight size={12} /></span><strong className={month.summary.confirmed.balanceMinutes < 0 ? 'negative' : 'positive'}>{month.summary.confirmed.days ? duration(month.summary.confirmed.balanceMinutes, true) : '—'}</strong></button>
          <div className="summary-item"><span>{t('provisionalBalance')}</span><strong className={month.summary.provisional.balanceMinutes < 0 ? 'negative' : 'positive'}>{month.summary.provisional.days ? duration(month.summary.provisional.balanceMinutes, true) : '—'}</strong></div>
          {absenceSummary}
          <div className="summary-item"><span>{t('openWeeks')}</span><strong>{month.summary.provisional.weeks.length}</strong></div>
        </section>}
        <section className="calendar-section">
          <div className="section-heading">
            <div className="section-title"><h2>{view === 'week' ? t('weekCalendar') : t('monthCalendar')}</h2>{view === 'week' && <span className={`status-pill ${closed ? 'closed' : 'open'}`}>{closed ? t('status.closed') : t('status.open')}</span>}</div>
            <div className="section-actions">
              <button className="icon-button undo-button" aria-label={t('undo')} disabled={busy || gestureActive || Boolean(quickCreate) || !state.undo} title={state.undo ? t('undoShortcut', { label: undoLabel(state.undo.label, language) }) : t('nothingToUndo')} onClick={undoLastChange}><Undo2 size={17} /></button>
              {view === 'week' && <button ref={reviewToggle} className={`button quiet${reviewDate ? ' selected' : ''}`} aria-expanded={Boolean(reviewDate)} aria-controls="day-review" onClick={() => reviewDate ? closeReview() : openReview(entryDate)}><ListChecks size={16} />{t('reviewDay')}</button>}
              <Popover label={t('filterEvidence')} trigger={<><Filter size={15} /><span>{t('evidence')}</span><small>{sources.length === state.dataSources.length ? t('all') : `${sources.length}/${state.dataSources.length}`}</small></>} className="button quiet">
                <p className="popover-caption">{t('showImported')}</p><div className="source-filters" aria-label={t('filterSources')}>
                  {state.dataSources.map(source => <label key={source.id} className={`source-filter source-${source.type} ${sources.includes(source.id) ? 'active' : ''}`}><input type="checkbox" checked={sources.includes(source.id)} onChange={() => toggleSource(source.id)} />{source.name}</label>)}
                </div>
              </Popover>
              <Popover label={t('moreActions')} trigger={<MoreHorizontal size={19} />} className="icon-button" menu>
                {view === 'week' && <><button role="menuitem" ref={vacationToggle} onClick={() => openVacation(entryDate)}><Palmtree size={16} />{a('absences')}</button><button role="menuitem" onClick={() => openNote('week', week)}><StickyNote size={16} />{weeklyNote ? t('editWeekNote') : t('weekNote')}</button></>}
                <button role="menuitem" onClick={() => openTimesheet(view === 'week' ? { kind: 'week', from: week, to: addDays(week, 7) } : { kind: 'month', ...periodBounds(anchorDate, 'month') })}><ArrowDownToLine size={16} />{t('timesheet')}</button>
              </Popover>
              {view === 'week' && <button className={`button close-week-button ${closed ? 'quiet' : 'secondary'}`} disabled={busy || (!closed && future)} title={!closed && future ? t('futureWeek') : undefined} onClick={setWeekStatus}>{closed ? t('reopenWeek') : t('closeWeek')}</button>}
            </div>
          </div>
          {view === 'week' && weeklyNote && <button className="week-note-preview" onClick={() => openNote('week', week)} aria-label={t('readWeekNote')}><StickyNote size={15} /><span>{weeklyNote}</span><small>{t('editUpper')}</small></button>}
          {state.activities.length === 0 && state.blocks.length === 0 && <div className="empty-hint"><CircleHelp size={16} /><span>{view === 'week' ? t('weekEmptyHint') : t('monthEmptyHint')}</span></div>}
          {view === 'week' ? <>
            <div className={`review-workspace${reviewDate ? ' is-review-open' : ''}`}>
              {reviewDate && <DayReview state={state} date={reviewDate} enabledSources={sources} busy={busy} onSelectDay={openReview} onShowActivity={showActivity} onNew={() => openEditor(reviewDate)} onNote={() => openNote('day', reviewDate)} onVacation={date => openVacation(date)} onClose={closeReview} />}
              <div className="review-calendar"><Calendar {...calendar} /></div>
            </div>
            <div className="calendar-footer"><span><i className="legend-mark evidence" />{t('evidenceLegend')}</span><span><i className="legend-mark tracked" />{a('workLegend')}</span><span>{activityCount ? t(activityCount === 1 ? 'weekEvidenceOne' : 'weekEvidenceMany', { count: activityCount }) : t('noWeekEvidence')}</span></div>
          </> : month && <><MonthCalendar state={state} overview={month} notes={state.notes} vacations={state.vacations} today={currentDay} onSelectDay={openDay} /><div className="calendar-footer"><span>{t('confirmedHint')}</span><span>{t(month.activityCount === 1 ? 'monthEvidenceOne' : 'monthEvidenceMany', { count: month.activityCount })}</span></div></>}
        </section>
        <p className="footnote">{a('footnote')}</p>
      </>}
    </section>
  );
}
