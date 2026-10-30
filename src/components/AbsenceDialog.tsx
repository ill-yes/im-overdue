import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AbsenceChange, AppState, CompensationAmount, VacationFraction } from '../../shared/types.js';
import { dayAccounting, targetForDay } from '../../shared/calculations.js';
import { accountSummary } from '../../shared/accounting.js';
import { Temporal, addDays, datesInRange } from '../../shared/time.js';
import { duration, longDate } from '../format';
import { errorText, useMessages, type TextValue } from '../i18n';
import { accountingMessages } from '../locales/accounting';
import { Modal } from './Modal';
import './absence-dialog.css';

type Draft = { vacationFraction: VacationFraction | 0; compensationMode: 'none' | 'whole' | 'half' | 'minutes'; minutes: string; sickness: boolean };
type DayDraft = { value: Draft; baseline: AbsenceChange; origin: 'pattern' | 'individual'; explicitConflict: boolean };
const emptyDraft: Draft = { vacationFraction: 0, compensationMode: 'none', minutes: '60', sickness: false };
function currentChange(state: AppState, date: string): AbsenceChange {
  const absence = state.absences?.find(day => day.date === date);
  return { date, vacationFraction: state.vacations.find(day => day.date === date)?.fraction ?? 0, compensation: absence?.compensation ?? null, sickness: absence?.sickness ?? false };
}
function toDraft(change: AbsenceChange): Draft {
  return { vacationFraction: change.vacationFraction, sickness: change.sickness, compensationMode: change.compensation?.mode === 'minutes' ? 'minutes' : change.compensation?.value === 1 ? 'whole' : change.compensation?.value === 0.5 ? 'half' : 'none', minutes: String(change.compensation?.mode === 'minutes' ? change.compensation.value : 60) };
}
function toChange(date: string, draft: Draft): AbsenceChange {
  const compensation: CompensationAmount | null = draft.compensationMode === 'none' ? null : draft.compensationMode === 'minutes' ? { mode: 'minutes', value: Number(draft.minutes) } : { mode: 'fraction', value: draft.compensationMode === 'whole' ? 1 : 0.5 };
  return { date, vacationFraction: draft.vacationFraction, sickness: draft.sickness, compensation };
}
function invalidDraft(draft: Draft) { return draft.compensationMode === 'minutes' && (!/^\d+$/.test(draft.minutes) || Number(draft.minutes) < 1 || Number(draft.minutes) > 10080); }
function sameChange(a: AbsenceChange, b: AbsenceChange) { return a.vacationFraction === b.vacationFraction && a.sickness === b.sickness && JSON.stringify(a.compensation) === JSON.stringify(b.compensation); }
function isEdited(draft: DayDraft) { return draft.explicitConflict || !sameChange(toChange(draft.baseline.date, draft.value), draft.baseline); }
function editDraft(current: AbsenceChange, previous: DayDraft | undefined, value: Draft, origin: DayDraft['origin']): DayDraft {
  const change = toChange(current.date, value);
  const keepBaseline = previous && isEdited(previous) && !sameChange(change, current);
  const baseline = keepBaseline ? previous.baseline : current;
  return { value, baseline, origin, explicitConflict: !!keepBaseline && !sameChange(baseline, current) && sameChange(change, baseline) };
}

export function AbsenceDialog({ state, initialDate, busy, requestError, onClose, onSave, onDirtyChange, onPendingChange }: {
  state: AppState; initialDate: string; busy: boolean; onClose: () => void;
  requestError?: TextValue;
  onSave: (changes: AbsenceChange[], expectedRevision: number) => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void; onPendingChange?: (pending: boolean) => void;
}) {
  const { t, m, text, language } = useMessages(accountingMessages);
  const [openingRevision] = useState(state.revision);
  const [from, setFrom] = useState(initialDate);
  const [to, setTo] = useState(initialDate);
  const [dayDrafts, setDayDrafts] = useState<Record<string, DayDraft>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [bulk, setBulk] = useState<Draft>(() => toDraft(currentChange(state, initialDate)));
  const [bulkActive, setBulkActive] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TextValue>('');
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = busy || pending;
  let dates: string[] = [];
  let rangeError = '';
  try {
    const first = Temporal.PlainDate.from(from); const last = Temporal.PlainDate.from(to);
    const days = first.until(last, { largestUnit: 'days' }).days + 1;
    if (days < 1) rangeError = t('rangeInvalid');
    else if (days > 366) rangeError = t('rangeMax');
    else dates = datesInRange(from, addDays(to, 1));
  } catch { rangeError = t('rangeInvalid'); }
  const rows = dates.map(date => {
    const current = currentChange(state, date);
    const target = targetForDay(date, state.profiles);
    const hasOriginal = current.vacationFraction > 0 || current.sickness || !!current.compensation;
    const eligible = target > 0 || hasOriginal;
    const selected = eligible && !excluded[date];
    const entry = dayDrafts[date];
    const baseline = entry?.baseline ?? current;
    const edited = !!entry && isEdited(entry);
    // Untouched values follow fresh server state. Only a real local edit keeps
    // its captured baseline, so a conflict retry cannot write stale neighbours.
    const draft = edited ? entry.value : toDraft(current);
    const change = toChange(date, draft);
    const previewState: AppState = { ...state, vacations: [...state.vacations.filter(day => day.date !== date), ...(change.vacationFraction ? [{ date, fraction: change.vacationFraction }] : [])], absences: [...(state.absences ?? []).filter(day => day.date !== date), { date, compensation: change.compensation, sickness: change.sickness }] };
    const totals = dayAccounting(invalidDraft(draft) ? state : previewState, date);
    return { date, current, baseline, entry, edited, draft, target, selected, eligible, change, totals };
  });
  const changedRows = rows.filter(row => row.selected && row.edited && !sameChange(row.change, row.current));
  const changes = changedRows.map(row => row.change);
  const selectedRows = rows.filter(row => row.selected);
  const mixed = selectedRows.some(row => !sameChange(row.change, selectedRows[0].change));
  const patternApplicable = selectedRows.some(row => row.target > 0 && !sameChange(row.change, toChange(row.date, bulk)));
  const invalid = rows.some(row => row.selected && (invalidDraft(row.draft) || (row.target <= 0 && (row.change.vacationFraction > 0 || row.change.sickness || row.change.compensation !== null) && !sameChange(row.change, currentChange(state, row.date)))));
  const summary = accountSummary(state);
  const compensationIncrease = rows.filter(row => row.selected && !invalidDraft(row.draft)).reduce((sum, row) => sum + row.totals.compensationMinutes - dayAccounting(state, row.date).compensationMinutes, 0);
  const mutate = (date: string, draft: Draft) => {
    setDayDrafts(previous => ({ ...previous, [date]: editDraft(currentChange(state, date), previous[date], draft, 'individual') }));
    setDirty(true); setError('');
  };
  const apply = (pattern: Draft, clear = false) => {
    const affected = rows.filter(row => row.selected && (clear || row.target > 0));
    setDayDrafts(previous => {
      const next = { ...previous };
      affected.forEach(row => { next[row.date] = editDraft(row.current, previous[row.date], pattern, 'pattern'); });
      return next;
    });
    setBulk(pattern); setBulkActive(true);
    setDirty(true); setError('');
  };
  const changeRange = (nextFrom: string, nextTo: string) => {
    if (bulkActive) {
      let nextDates: string[] = [];
      try {
        const first = Temporal.PlainDate.from(nextFrom);
        const last = Temporal.PlainDate.from(nextTo);
        const length = first.until(last, { largestUnit: 'days' }).days + 1;
        if (length > 0 && length <= 366) nextDates = datesInRange(nextFrom, addDays(nextTo, 1));
      } catch { /* The range validation above explains incomplete dates. */ }
      const added = nextDates.filter(date => !dates.includes(date) && !excluded[date] && targetForDay(date, state.profiles) > 0);
      setDayDrafts(previous => {
        const next = { ...previous };
        added.forEach(date => {
          const entry = previous[date];
          const current = currentChange(state, date);
          // Individual edits survive range changes. Returning pattern days
          // receive the current pattern, retaining any real edit's conflict base.
          if (entry?.origin === 'individual' && isEdited(entry)) return;
          next[date] = entry?.origin === 'individual' ? {
            value: toDraft(current),
            baseline: current,
            origin: 'individual',
            explicitConflict: false,
          } : editDraft(current, entry, bulk, 'pattern');
        });
        return next;
      });
    }
    setFrom(nextFrom); setTo(nextTo); setDirty(true);
  };
  const selectDay = (date: string, selected: boolean) => {
    const row = rows.find(value => value.date === date)!;
    // Keep the visible value while excluded, including untouched server values.
    // Store value and baseline together so toggling never invents a local edit.
    setDayDrafts(previous => ({ ...previous, [date]: {
      value: row.draft,
      baseline: row.edited ? row.baseline : row.current,
      origin: 'individual',
      explicitConflict: row.edited && !!row.entry?.explicitConflict,
    } }));
    setExcluded(value => ({ ...value, [date]: !selected })); setDirty(true);
  };
  const close = () => { if (!pendingRef.current && (!dirty || window.confirm(t('discard')))) onClose(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pendingRef.current || busy || rangeError || invalid || !changes.length) return;
    if (changedRows.some(row => !sameChange(row.baseline, row.current)) && !window.confirm(t('replaceChanged'))) return;
    pendingRef.current = true; setPending(true); setError('');
    try {
      const ok = await onSave(changes, state.revision);
      if (mounted.current && ok) { setDirty(false); onClose(); }
      else if (mounted.current) setError(m('saveFailed'));
    } catch (issue) { if (mounted.current) setError(errorText(issue, m('saveFailed'))); }
    finally { pendingRef.current = false; if (mounted.current) setPending(false); }
  };
  const controls = (draft: Draft, update: (value: Draft) => void, suffix: string, disabled = false) => <>
    <label className="field">{t('vacation')}<select aria-label={`${t('vacation')} ${suffix}`} disabled={disabled} value={draft.vacationFraction} onChange={e => update({ ...draft, vacationFraction: Number(e.target.value) as VacationFraction | 0 })}><option value={0}>{t('none')}</option><option value={0.5}>{t('half')}</option><option value={1}>{t('whole')}</option></select></label>
    <label className="field">{t('compensation')}<select aria-label={`${t('compensation')} ${suffix}`} disabled={disabled} value={draft.compensationMode} onChange={e => update({ ...draft, compensationMode: e.target.value as Draft['compensationMode'] })}><option value="none">{t('none')}</option><option value="half">{t('half')}</option><option value="whole">{t('whole')}</option><option value="minutes">{t('minutes')}</option></select></label>
    {draft.compensationMode === 'minutes' && <label className="field absence-minutes">{t('minutes')}<input aria-label={`${t('minutes')} ${suffix}`} type="number" min={1} max={10080} step={1} required disabled={disabled} value={draft.minutes} onChange={e => update({ ...draft, minutes: e.target.value })} /></label>}
    <label className="absence-sickness"><input type="checkbox" disabled={disabled} checked={draft.sickness} onChange={e => update({ ...draft, sickness: e.target.checked })} />{t('sickness')}</label>
  </>;
  return <Modal title={t('absences')} className="modal-wide workflow-modal absence-dialog" onClose={close} closeDisabled={pending}>
    <form className="absence-form" noValidate onSubmit={submit} aria-busy={pending}><div className="dialog-scroll absence-body"><p className="muted small">{t('absenceHelp')}</p>
      <fieldset className="absence-fields" disabled={locked}>
        <div className="absence-range"><label className="field">{t('from')}<input data-dialog-autofocus type="date" required value={from} onChange={e => changeRange(e.target.value, to)} /></label><label className="field">{t('through')}<input type="date" required value={to} onChange={e => changeRange(from, e.target.value)} /></label></div>
        {rangeError && <p className="form-error" role="alert">{rangeError}</p>}
        <div className="absence-bulk"><div className="absence-controls">{controls(bulk, value => apply(value), '')}</div><p className="absence-pattern-help" role="status">{t(bulkActive ? 'patternActive' : mixed ? 'patternMixed' : 'patternReady')}</p><div className="absence-bulk-actions">{patternApplicable && <button type="button" className="button secondary" disabled={invalidDraft(bulk)} onClick={() => apply(bulk)}>{t('applyPattern')}</button>}<button type="button" className="button quiet" disabled={!rows.some(row => row.selected)} onClick={() => apply({ ...emptyDraft }, true)}>{t('clearSelected')}</button></div></div>
        <p className="absence-count">{t('selected', { count: rows.filter(row => row.selected).length, changes: changes.length })}</p>
        <div className="absence-days">{rows.map(row => <section key={row.date} className={`absence-day${row.selected ? ' is-selected' : ''}`}>
          <label className="absence-day-label"><input type="checkbox" checked={row.selected} disabled={!row.eligible} onChange={e => selectDay(row.date, e.target.checked)} /><span><strong>{longDate(row.date)}</strong><small>{t('target')} {duration(row.target)} · {t('work')} {duration(row.totals.actualMinutes)}</small></span></label>
          {bulkActive && row.selected && row.edited && row.target > 0 && row.entry?.origin === 'individual' && !sameChange(row.change, toChange(row.date, bulk)) && <p className="absence-day-adjustment">{t('dayAdjustment')}</p>}
          {row.target > 0 ? <div className="absence-controls">{controls(row.draft, value => mutate(row.date, value), longDate(row.date), !row.selected)}</div> : <p className="muted small">{t('noTarget')}</p>}
          {row.target <= 0 && row.eligible && <button type="button" className="button quiet" disabled={!row.selected} onClick={() => mutate(row.date, { ...emptyDraft })}>{t('clearSelected')}</button>}
          {row.selected && <><dl className="absence-calculation"><div><dt>{t('vacation')}</dt><dd>{duration(row.totals.vacationMinutes)}</dd></div><div><dt>{t('compensation')} ({t('used').toLocaleLowerCase()})</dt><dd>{duration(row.totals.compensationMinutes)}</dd></div><div><dt>{t('sickness')}</dt><dd>{duration(row.totals.sicknessMinutes)}</dd></div><div><dt>{t('balance')}</dt><dd className={row.totals.balanceMinutes < 0 ? 'negative' : 'positive'}>{duration(row.totals.balanceMinutes, true)}</dd></div>{row.totals.uncoveredMinutes > 0 && <div><dt>{t('uncovered')}</dt><dd>{duration(row.totals.uncoveredMinutes)}</dd></div>}</dl>
          {row.totals.holiday && <p className="absence-notice">{t('holidaySuspends', { name: language === 'en' ? row.totals.holiday.nameEn : row.totals.holiday.name })}</p>}
          {!row.totals.holiday && row.totals.compensationRequestedMinutes > row.totals.compensationMinutes && <p className="absence-notice">{t('reducedComp', { requested: duration(row.totals.compensationRequestedMinutes), used: duration(row.totals.compensationMinutes) })}</p>}
          {invalidDraft(row.draft) && <p className="form-error" role="alert">{t('invalidComp')}</p>}</>}
        </section>)}</div>
      </fieldset>
      {compensationIncrease > 0 && summary.confirmedMinutes === null && <p className="absence-notice">{t('noOpeningComp')}</p>}
      {compensationIncrease > 0 && summary.confirmedMinutes !== null && compensationIncrease > summary.confirmedMinutes - summary.plannedCompensationMinutes && <p className="absence-notice" role="status">{t('insufficient')}</p>}
      {state.revision !== openingRevision && <p className="absence-notice" role="status">{t('changed')}</p>}
      {state.undo && changes.length > 0 && <p className="muted small">{t('undoNotice')}</p>}
      {(requestError || error) && <p className="form-error" role="alert">{text(requestError || error)}</p>}{pending && <p className="muted small" role="status">{t('saving')}</p>}
      </div><div className="dialog-actions workflow-actions"><button type="button" className="button secondary" disabled={pending} onClick={close}>{t('cancel')}</button><button type="submit" className="button primary" disabled={locked || !!rangeError || invalid || !changes.length}>{t('saveAbsences')}</button></div>
    </form>
  </Modal>;
}
