import { useMessages } from '../i18n';
import { workflows } from '../locales/workflows';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, FileDown } from 'lucide-react';
import type { AppState, VacationAllowance } from '../../shared/types.js';
import { periodSummary } from '../../shared/calculations.js';
import { Temporal, periodBounds } from '../../shared/time.js';
import { duration, periodLabel, weekLabel } from '../format';
import { VacationAccount } from './VacationAccount';
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
};

export function ReportsPage({ state, anchor, busy, requestError, onSaveAllowance, onOpenVacation, onTimesheet, onNavigateWeek, onLeaveGuardChange }: ReportsPageProps) {
  const { t, locale } = useMessages(workflows);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const [kind, setKind] = useState<Kind>('month');
  const [tab, setTab] = useState<'balance' | 'vacation'>('balance');
  const [date, setDate] = useState(anchor);
  const [pending, setPending] = useState(false);
  const [resetDraft, setResetDraft] = useState(0);
  const pendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const guardRef = useRef<LeaveGuard>(() => true);
  guardRef.current = () => {
    if (pendingRef.current) return false;
    if (!dirtyRef.current) return true;
    if (!window.confirm(t('confirmDiscardAllowance'))) return false;
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
  return <section className="reports-page" aria-label={t('timeAccount')}>
    <header className="reports-page-heading"><div><h1>{t('timeAccount')}</h1><p>{t('timeAccountSubtitle')}</p></div></header>
    <div className="reports-panel">
      <div className="reports-page-tabs" role="tablist" aria-label={t('accountView')} onKeyDown={event => {
        if (pending || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'balance' : event.key === 'End' ? 'vacation' : tab === 'balance' ? 'vacation' : 'balance';
        if (chooseTab(next)) document.getElementById(next === 'balance' ? 'reports-hours-tab' : 'reports-vacation-tab')?.focus({ preventScroll: true });
      }}>
        <button type="button" role="tab" id="reports-hours-tab" aria-controls="reports-hours-panel" aria-selected={tab === 'balance'} tabIndex={tab === 'balance' ? 0 : -1} disabled={pending} onClick={() => chooseTab('balance')}>{t('hoursAccount')}</button>
        <button type="button" role="tab" id="reports-vacation-tab" aria-controls="reports-vacation-panel" aria-selected={tab === 'vacation'} tabIndex={tab === 'vacation' ? 0 : -1} disabled={pending} onClick={() => chooseTab('vacation')}>{t('vacationAccount')}</button>
      </div>
      <div role="tabpanel" id="reports-hours-panel" aria-labelledby="reports-hours-tab" hidden={tab !== 'balance'} className="reports-panel-content">
        <div className="reports-period-toolbar">
          <div className="segmented" role="group" aria-label={t('period')}>{([['month', t('month')], ['quarter', t('quarter')], ['year', t('year')]] as const).map(([value, label]) => <button type="button" key={value} className={kind === value ? 'selected' : ''} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}</div>
          <div className="period-nav"><button type="button" className="icon-button" onClick={() => move(-1)} aria-label={t('previousPeriod')}>‹</button><strong>{periodLabel(date, kind)}</strong><button type="button" className="icon-button" onClick={() => move(1)} aria-label={t('nextPeriod')}>›</button></div>
          <button type="button" className="button secondary reports-export" onClick={() => onTimesheet({ kind: kind === 'month' ? 'month' : 'custom', ...bounds })}><FileDown size={16} />{t('timesheet')}</button>
        </div>
        <section className="reports-confirmed" aria-label={t('confirmedAccount')}>
          <div className="reports-balance"><span>{t('confirmedBalance')}</span><strong className={summary.confirmed.balanceMinutes < 0 ? 'negative' : 'positive'}>{summary.confirmed.days ? duration(summary.confirmed.balanceMinutes, true) : '—'}</strong><small>{t(summary.confirmed.weeks.length === 1 ? 'closedWeekOne' : 'closedWeekMany', { count: number(summary.confirmed.weeks.length) })}</small></div>
          <dl className="reports-totals"><div><dt>{t('actual')}</dt><dd>{summary.confirmed.days ? duration(summary.confirmed.actualMinutes) : '—'}</dd></div><div><dt>{t('target')}</dt><dd>{summary.confirmed.days ? duration(summary.confirmed.targetMinutes) : '—'}</dd></div><div><dt>{t('vacationCredit')}</dt><dd>{summary.confirmed.days ? duration(summary.confirmed.vacationMinutes) : '—'}</dd></div></dl>
        </section>
        <section className="reports-provisional" aria-label={t('provisionalAccount')}><div><span>{t('provisionalBalance')}</span><strong>{summary.provisional.days ? duration(summary.provisional.balanceMinutes, true) : '—'}</strong></div><p>{t(summary.provisional.weeks.length === 1 ? 'openWeekOne' : 'openWeekMany', { count: number(summary.provisional.weeks.length) })}</p></section>
        {summary.provisional.weeks.length > 0 && <details className="reports-open-weeks"><summary>{t('showOpenWeeks', { count: number(summary.provisional.weeks.length) })}</summary><ul>{summary.provisional.weeks.map(week => <li key={week}><button type="button" onClick={() => { if (canLeave()) onNavigateWeek(week); }}><span>{weekLabel(week)}</span><ArrowUpRight size={15} aria-hidden="true" /></button></li>)}</ul></details>}
        <p className="reports-explanation">{t('reportsExplanation')}</p>
      </div>
      <div role="tabpanel" id="reports-vacation-panel" aria-labelledby="reports-vacation-tab" hidden={tab !== 'vacation'} className="reports-panel-content">
        <VacationAccount state={state} anchor={anchor} busy={busy} requestError={requestError} resetDraft={resetDraft} onSaveAllowance={onSaveAllowance} onOpenVacation={value => { if (canLeave()) onOpenVacation(value); }} onDirtyChange={value => { dirtyRef.current = value; }} onPendingChange={value => { pendingRef.current = value; setPending(value); }} />
      </div>
    </div>
  </section>;
}

