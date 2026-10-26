import { useMessages, errorText, type TextValue } from '../i18n';
import { workflows } from '../locales/workflows';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { AppState, VacationChange, VacationFraction } from '../../shared/types.js';
import { dayTotals, targetForDay } from '../../shared/calculations.js';
import { Temporal, addDays, datesInRange } from '../../shared/time.js';
import { duration, longDate } from '../format';
import { Modal } from './Modal';
import './vacation-dialog.css';

const snapshot = (state: AppState) => JSON.stringify([...state.vacations].sort((a, b) => a.date.localeCompare(b.date)));

export function VacationDialog({ state, date, busy, requestError, onSave, onClose }: {
  state: AppState;
  date: string;
  busy: boolean;
  requestError: string;
  onSave: (days: VacationChange[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t, m, text: renderText } = useMessages(workflows);
  const [opening] = useState(() => ({ vacations: new Map(state.vacations.map(day => [day.date, day.fraction])), snapshot: snapshot(state), zone: state.settings.timezone }));
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [mode, setMode] = useState<'book' | 'remove'>('book');
  const [fraction, setFraction] = useState<VacationFraction>(() => state.vacations.find(day => day.date === date)?.fraction ?? 1);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [fractions, setFractions] = useState<Record<string, VacationFraction>>({});
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<TextValue>('');
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const confirmed = useRef('');
  const helpId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  let dates: string[] = [];
  let rangeError = '';
  try {
    const first = Temporal.PlainDate.from(from);
    const last = Temporal.PlainDate.from(to);
    const length = first.until(last).days + 1;
    if (length < 1) rangeError = t('rangeEnd');
    else if (length > 366) rangeError = t('rangeMax');
    else dates = datesInRange(first.toString(), addDays(last.toString(), 1));
  } catch { rangeError = t('rangeValid'); }

  const current = new Map(state.vacations.map(day => [day.date, day.fraction]));
  const localState = { ...state, settings: { ...state.settings, timezone: opening.zone } };
  const rows = dates.map(day => {
    const target = targetForDay(day, state.profiles);
    const value = fractions[day] ?? fraction;
    const eligible = mode === 'book' ? target > 0 : current.has(day);
    return { date: day, target, fraction: value, eligible, selected: eligible && !excluded[day], totals: dayTotals(localState, day) };
  });
  const selected = rows.filter(row => row.selected);
  const changes: VacationChange[] = selected.flatMap(row => {
    const next = mode === 'remove' ? null : row.fraction;
    return (current.get(row.date) ?? null) === next ? [] : [{ date: row.date, fraction: next }];
  });
  const skipped = rows.filter(row => !row.eligible).length;
  const externalChange = snapshot(state) !== opening.snapshot;
  const close = () => {
    if (pendingRef.current) return;
    if (!dirty || window.confirm(t('confirmDiscardVacation'))) onClose();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current || busy || rangeError || changes.length === 0) return;
    const conflicts = changes.filter(change => (opening.vacations.get(change.date) ?? null) !== (current.get(change.date) ?? null));
    const replacements = changes.filter(change => change.fraction !== null && current.has(change.date) && current.get(change.date) !== change.fraction);
    const confirmation = JSON.stringify({ changes, current: changes.map(change => [change.date, current.get(change.date) ?? null]) });
    if ((conflicts.length > 0 || replacements.length > 0) && confirmed.current !== confirmation) {
      const message = conflicts.length > 0
        ? t('confirmVacationChanged')
        : t('confirmVacationReplace');
      if (!window.confirm(message)) return;
      confirmed.current = confirmation;
    }
    pendingRef.current = true;
    setPending(true);
    setLocalError('');
    try { await onSave(changes); }
    catch (issue) { if (mounted.current) setLocalError(errorText(issue, m('saveVacationFailed'))); }
    finally { pendingRef.current = false; if (mounted.current) setPending(false); }
  };

  return <Modal title={t('vacation')} onClose={close} closeDisabled={pending} className="vacation-dialog modal-wide">
    <form className="dialog-content vacation-content" onSubmit={submit}>
      <p className="muted small" id={helpId}>{t('vacationHelp')}</p>
      <fieldset className="vacation-fields" disabled={pending} aria-describedby={helpId}>
        <div className="segmented" role="group" aria-label={t('vacationAction')}>
          <button type="button" aria-pressed={mode === 'book'} className={mode === 'book' ? 'selected' : ''} onClick={() => { setMode('book'); setDirty(true); }}>{t('book')}</button>
          <button type="button" aria-pressed={mode === 'remove'} className={mode === 'remove' ? 'selected' : ''} onClick={() => { setMode('remove'); setDirty(true); }}>{t('remove')}</button>
        </div>
        <div className="vacation-range">
          <label className="field">{t('from')}<input type="date" required value={from} onChange={event => { setFrom(event.target.value); setDirty(true); }} /></label>
          <label className="field">{t('through')}<input type="date" required value={to} onChange={event => { setTo(event.target.value); setDirty(true); }} /></label>
          {mode === 'book' && <label className="field">{t('fraction')}<select value={fraction} onChange={event => { setFraction(Number(event.target.value) as VacationFraction); setFractions({}); setDirty(true); }}><option value={1}>{t('wholeDay')}</option><option value={0.5}>{t('halfDay')}</option></select></label>}
        </div>
        {rangeError && <p className="form-error" role="alert">{rangeError}</p>}
        {externalChange && <p className="vacation-notice small" role="status">{t('vacationChanged')}</p>}
        {rows.length > 0 && <>
          <div className="vacation-preview-head"><strong>{t('reviewSelection')}</strong><span>{t('selectedCount', { count: selected.length })}{skipped > 0 ? t(mode === 'book' ? 'skippedTarget' : 'skippedVacation', { count: skipped }) : ''}</span></div>
          <div className="vacation-days">
            {rows.map(row => <div key={row.date} className={`vacation-day${row.selected ? ' is-selected' : ''}`}>
              <label className="vacation-day-choice"><input type="checkbox" checked={row.selected} disabled={!row.eligible} onChange={event => { setExcluded(value => ({ ...value, [row.date]: !event.target.checked })); setDirty(true); }} /><span><strong>{longDate(row.date)}</strong><small>{t('target')} {duration(row.target)}{current.has(row.date) ? t('previousVacation', { fraction: current.get(row.date) === 1 ? t('oneDay') : t('halfDayShort') }) : ''}{!row.eligible && (mode === 'book' ? t('noTarget') : t('noVacation'))}</small></span></label>
              {mode === 'book' && row.eligible && <label className="vacation-row-fraction"><span className="sr-only">{t('fractionDate', { date: longDate(row.date) })}</span><select value={row.fraction} disabled={!row.selected} onChange={event => { setFractions(value => ({ ...value, [row.date]: Number(event.target.value) as VacationFraction })); setDirty(true); }}><option value={1}>{t('oneDay')}</option><option value={0.5}>{t('halfDayShort')}</option></select></label>}
              <span className="vacation-credit">{mode === 'remove' ? (row.selected ? `−${duration((current.get(row.date) ?? 0) * row.target)}` : '—') : row.selected ? `+${duration(row.fraction * row.target)}` : '—'}</span>
              {row.selected && mode === 'book' && row.totals.actualMinutes > 0 && <p className={row.fraction === 1 ? 'vacation-work-warning small' : 'vacation-composition small'}>{row.fraction === 1 && <strong>{t('workAdditional')} </strong>}{t('workVacationComposition', { work: duration(row.totals.actualMinutes), vacation: duration(row.fraction * row.target), target: duration(row.target) })}</p>}
            </div>)}
          </div>
          <p className="vacation-summary small">{changes.length === 0 ? t('noVacationChange') : t(mode === 'remove' ? changes.length === 1 ? 'vacationRemovedOne' : 'vacationRemovedMany' : changes.length === 1 ? 'vacationSavedOne' : 'vacationSavedMany', { count: changes.length })}</p>
        </>}
      </fieldset>
      {state.undo && changes.length > 0 && <p className="vacation-notice small">{t('vacationUndo')}</p>}
      {pending && <p className="muted small" role="status">{t('vacationPending')}</p>}
      {(localError || requestError) && <p className="form-error" role="alert">{renderText(localError) || requestError}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={pending} onClick={close}>{t('cancel')}</button><button type="submit" className="button primary" disabled={busy || pending || !!rangeError || changes.length === 0}>{mode === 'remove' ? t('removeVacation') : t('bookVacation')}</button></div>
    </form>
  </Modal>;
}
