import { useMessages } from '../i18n';
import { workflows } from '../locales/workflows';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, FileDown } from 'lucide-react';
import type { AppState, VacationAllowance } from '../../shared/types.js';
import { dayAccounting, periodSummary } from '../../shared/calculations.js';
import { Temporal, datesInRange, periodBounds, weekStartFor } from '../../shared/time.js';
import { duration, periodLabel, weekLabel } from '../format';
import { VacationAccount } from './VacationAccount';
import { HoursAccount } from './HoursAccount';
import { accountingMessages } from '../locales/accounting';
import { accountingUxMessages } from '../locales/accounting-ux';
import type { TimesheetPreset } from './TimesheetDialog';
import './reports-page.css';

type Kind = 'month' | 'quarter' | 'year';
type LeaveGuard = () => boolean;
type ReportsPageProps = {
  state: AppState;
  anchor: string;
  busy: boolean;
  requestError: string;
  onSaveAllowance: (input: VacationAllowance) => Promise<boolean>;
  onOpenVacation: (date: string) => void;
  onTimesheet: (preset: TimesheetPreset) => void;
  onNavigateWeek: (week: string) => void;
  onLeaveGuardChange?: (guard: LeaveGuard | null) => void;
  initialTab?: 'account' | 'balance';
} & Pick<Parameters<typeof HoursAccount>[0], 'onOpening' | 'onEntry' | 'onDeleteEntry'>;

export function ReportsPage({ state, anchor, busy, requestError, onSaveAllowance, onOpenVacation, onTimesheet, onNavigateWeek, onLeaveGuardChange, onOpening, onEntry, onDeleteEntry, initialTab = 'account' }: ReportsPageProps) {
  const { t, locale } = useMessages(workflows);
  const { t: a } = useMessages(accountingMessages);
  const { t: ux } = useMessages(accountingUxMessages);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const [kind, setKind] = useState<Kind>('month');
  const [tab, setTab] = useState<'account' | 'balance' | 'vacation'>(initialTab);
  const [date, setDate] = useState(anchor);
  const [pending, setPending] = useState(false);
  const [resetDraft, setResetDraft] = useState(0);
  const pendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const guardRef = useRef<LeaveGuard>(() => true);
  guardRef.current = () => {
    if (pendingRef.current) return false;
    if (!dirtyRef.current) return true;
    if (!window.confirm(a('discard'))) return false;
    dirtyRef.current = false;
    setResetDraft(value => value + 1);
    return true;
  };
  const canLeave = useCallback(() => guardRef.current(), []);
  useEffect(() => {
    onLeaveGuardChange?.(canLeave);
    return () => onLeaveGuardChange?.(null);
  }, [canLeave, onLeaveGuardChange]);
  const chooseTab = (next: typeof tab) => {
    if (next === tab) return true;
    if (!canLeave()) return false;
    setTab(next);
    return true;
  };
  const move = (step: number) => setDate(Temporal.PlainDate.from(date).add(kind === 'month' ? { months: step } : kind === 'quarter' ? { months: step * 3 } : { years: step }).toString());
  const bounds = periodBounds(date, kind);
  const summary = periodSummary(state, bounds.from, bounds.to);
  const credits = useMemo(() => {
    const closed = new Set(state.weeks.filter(week => week.status === 'closed').map(week => week.weekStart));
    const totals = { vacation: 0, sickness: 0, holidays: 0 };
    for (const day of datesInRange(bounds.from, bounds.to)) {
      if (!closed.has(weekStartFor(day))) continue;
      const accounting = dayAccounting(state, day);
      totals.vacation += accounting.vacationMinutes;
      totals.sickness += accounting.sicknessMinutes;
      totals.holidays += accounting.holidayMinutes;
    }
    return totals;
  }, [state, bounds.from, bounds.to]);
  return <section className="reports-page" aria-label={t('timeAccount')}>
    <header className="reports-page-heading"><div><h1>{t('timeAccount')}</h1><p>{t('timeAccountSubtitle')}</p></div></header>
    <div className="reports-panel">
      <div className="reports-page-tabs" role="tablist" aria-label={t('accountView')} onKeyDown={event => {
        if (pending || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const tabs = ['account', 'balance', 'vacation'] as const;
        const next = event.key === 'Home' ? 'account' : event.key === 'End' ? 'vacation' : tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
        if (chooseTab(next)) document.getElementById(`reports-${next}-tab`)?.focus({ preventScroll: true });
      }}>
        <button type="button" role="tab" id="reports-account-tab" aria-controls="reports-account-panel" aria-selected={tab === 'account'} tabIndex={tab === 'account' ? 0 : -1} disabled={pending} onClick={() => chooseTab('account')}>{a('hoursAccount')}</button>
        <button type="button" role="tab" id="reports-balance-tab" aria-controls="reports-hours-panel" aria-selected={tab === 'balance'} tabIndex={tab === 'balance' ? 0 : -1} disabled={pending} onClick={() => chooseTab('balance')}>{t('periodReports')}</button>
        <button type="button" role="tab" id="reports-vacation-tab" aria-controls="reports-vacation-panel" aria-selected={tab === 'vacation'} tabIndex={tab === 'vacation' ? 0 : -1} disabled={pending} onClick={() => chooseTab('vacation')}>{t('vacationAccount')}</button>
      </div>
      <div role="tabpanel" id="reports-account-panel" aria-labelledby="reports-account-tab" hidden={tab !== 'account'} className="reports-panel-content">
        <HoursAccount resetDraft={resetDraft} state={state} busy={busy} onOpening={onOpening} onEntry={onEntry} onDeleteEntry={onDeleteEntry}
          onAbsence={() => { if (canLeave()) onOpenVacation(anchor); }}
          onTimesheet={() => { if (canLeave()) onTimesheet({ kind: 'month', ...periodBounds(anchor, 'month') }); }}
          onDirtyChange={value => { if (tab === 'account') dirtyRef.current = value; }}
          onPendingChange={value => { if (tab === 'account') { pendingRef.current = value; setPending(value); } }} />
        {tab === 'account' && requestError && <p className="form-error" role="alert">{requestError}</p>}
      </div>
      <div role="tabpanel" id="reports-hours-panel" aria-labelledby="reports-balance-tab" hidden={tab !== 'balance'} className="reports-panel-content">
        <div className="reports-period-toolbar">
          <div className="segmented" role="group" aria-label={t('period')}>{([['month', t('month')], ['quarter', t('quarter')], ['year', t('year')]] as const).map(([value, label]) => <button type="button" key={value} className={kind === value ? 'selected' : ''} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}</div>
          <div className="period-nav"><button type="button" className="icon-button" onClick={() => move(-1)} aria-label={t('previousPeriod')}>‹</button><strong>{periodLabel(date, kind)}</strong><button type="button" className="icon-button" onClick={() => move(1)} aria-label={t('nextPeriod')}>›</button></div>
          <button type="button" className="button secondary reports-export" onClick={() => onTimesheet({ kind: kind === 'month' ? 'month' : 'custom', ...bounds })}><FileDown size={16} />{t('timesheet')}</button>
        </div>
        <section className="reports-confirmed" aria-label={t('confirmedAccount')}>
          <div className="reports-balance"><span>{t('confirmedBalance')}</span><strong className={summary.confirmed.balanceMinutes < 0 ? 'negative' : 'positive'}>{summary.confirmed.days ? duration(summary.confirmed.balanceMinutes, true) : '—'}</strong><small>{t(summary.confirmed.weeks.length === 1 ? 'closedWeekOne' : 'closedWeekMany', { count: number(summary.confirmed.weeks.length) })}</small></div>
          <div className="reports-amounts">
            <dl className="reports-totals"><div><dt>{t('actual')}</dt><dd>{summary.confirmed.days ? duration(summary.confirmed.actualMinutes) : '—'}</dd></div><div><dt>{ux('credits')}</dt><dd>{summary.confirmed.days ? duration(credits.vacation + credits.sickness + credits.holidays) : '—'}</dd></div><div><dt>{t('target')}</dt><dd>{summary.confirmed.days ? duration(summary.confirmed.targetMinutes) : '—'}</dd></div></dl>
            <dl className="reports-credit-breakdown" aria-label={ux('creditBreakdown')}>{(['vacation', 'sickness', 'holidays'] as const).map(key => <div key={key}><dt>{ux(key)}</dt><dd>{summary.confirmed.days ? duration(credits[key]) : '—'}</dd></div>)}</dl>
          </div>
        </section>
        <section className="reports-provisional" aria-label={t('provisionalAccount')}><div><span>{t('provisionalBalance')}</span><strong>{summary.provisional.days ? duration(summary.provisional.balanceMinutes, true) : '—'}</strong></div><p>{t(summary.provisional.weeks.length === 1 ? 'openWeekOne' : 'openWeekMany', { count: number(summary.provisional.weeks.length) })}</p></section>
        {summary.provisional.weeks.length > 0 && <details className="reports-open-weeks"><summary>{t('showOpenWeeks', { count: number(summary.provisional.weeks.length) })}</summary><ul>{summary.provisional.weeks.map(week => <li key={week}><button type="button" onClick={() => { if (canLeave()) onNavigateWeek(week); }}><span>{weekLabel(week)}</span><ArrowUpRight size={15} aria-hidden="true" /></button></li>)}</ul></details>}
        <p className="reports-equation">{ux('balanceRule')}</p>
        <p className="reports-explanation">{t('reportsExplanation')}</p>
      </div>
      <div role="tabpanel" id="reports-vacation-panel" aria-labelledby="reports-vacation-tab" hidden={tab !== 'vacation'} className="reports-panel-content">
        <VacationAccount state={state} anchor={anchor} busy={busy} requestError={requestError} resetDraft={resetDraft} onSaveAllowance={onSaveAllowance} onOpenVacation={value => { if (canLeave()) onOpenVacation(value); }} onDirtyChange={value => { if (tab === 'vacation') dirtyRef.current = value; }} onPendingChange={value => { if (tab === 'vacation') { pendingRef.current = value; setPending(value); } }} />
      </div>
    </div>
  </section>;
}

