import { useMessages, errorText, type TextValue } from '../i18n';
import { workflows } from '../locales/workflows';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppState, VacationAllowance } from '../../shared/types.js';
import { dayAccounting } from '../../shared/calculations.js';
import { vacationAccount } from '../../shared/vacations.js';
import { Temporal, today } from '../../shared/time.js';
import { duration, longDate } from '../format';
import { absenceSummaryMessages } from '../locales/absence-summary';
import './vacation-account.css';

const allowanceKey = (allowance: VacationAllowance | null | undefined) => allowance ? `${allowance.entitlementDays}/${allowance.carryoverDays}` : '';

export function VacationAccount({ state, anchor, busy, requestError, onSaveAllowance, onOpenVacation, onPendingChange, onDirtyChange, resetDraft = 0 }: {
  state: AppState;
  anchor: string;
  busy: boolean;
  requestError: string;
  onSaveAllowance: (input: VacationAllowance) => Promise<boolean>;
  onOpenVacation: (date: string) => void;
  onPendingChange?: (pending: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  resetDraft?: number;
}) {
  const { t } = useMessages(workflows);
  const [year, setYear] = useState(() => Temporal.PlainDate.from(anchor).year);
  const [pending, setPending] = useState(false);
  const dirtyRef = useRef(false);
  const pendingRef = useRef(false);
  const currentDate = today(state.settings.timezone);
  const newVacationDate = Temporal.PlainDate.from(currentDate).year === year ? currentDate : `${String(year).padStart(4, '0')}-01-01`;
  const chooseYear = (value: number) => {
    if (value === year || pendingRef.current) return;
    if (dirtyRef.current && !window.confirm(t('confirmDiscardAllowance'))) return;
    dirtyRef.current = false;
    onDirtyChange?.(false);
    setYear(value);
  };
  return <section className="vacation-account" aria-label={t('vacationAccount')}>
    <div className="vacation-account-toolbar">
      <div className="period-nav">
        <button type="button" className="icon-button" aria-label={t('previousVacationYear')} disabled={pending || year <= 1} onClick={() => chooseYear(year - 1)}>‹</button>
        <label className="vacation-year-label">{t('vacationYear')}<select aria-label={t('vacationYear')} value={year} disabled={pending} onChange={event => chooseYear(Number(event.target.value))}>{Array.from({ length: 11 }, (_, index) => year - 5 + index).filter(value => value >= 1 && value <= 9999).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <button type="button" className="icon-button" aria-label={t('nextVacationYear')} disabled={pending || year >= 9999} onClick={() => chooseYear(year + 1)}>›</button>
      </div>
      <button type="button" className="button secondary" disabled={pending} onClick={() => onOpenVacation(newVacationDate)}>{t('bookVacation')}</button>
    </div>
    <AllowanceForm key={`${year}/${resetDraft}`} state={state} year={year} busy={busy} requestError={requestError} onSave={onSaveAllowance} onPending={value => { pendingRef.current = value; setPending(value); onPendingChange?.(value); }} onDirtyChange={value => { dirtyRef.current = value; onDirtyChange?.(value); }} onOpenVacation={onOpenVacation} />
  </section>;
}

function AllowanceForm({ state, year, busy, requestError, onSave, onPending, onDirtyChange, onOpenVacation }: {
  state: AppState;
  year: number;
  busy: boolean;
  requestError: string;
  onSave: (input: VacationAllowance) => Promise<boolean>;
  onPending: (pending: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  onOpenVacation: (date: string) => void;
}) {
  const { t, m, text: renderText, locale } = useMessages(workflows);
  const { t: absenceText } = useMessages(absenceSummaryMessages);
  const daysLabel = (days: number) => t(Math.abs(days) === 1 ? 'daysOne' : 'daysMany', { count: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(days) });
  const account = vacationAccount(state, year);
  const [baseline, setBaseline] = useState(() => allowanceKey(account.allowance));
  const [entitlement, setEntitlement] = useState(() => account.allowance ? String(account.allowance.entitlementDays) : '');
  const [carryover, setCarryover] = useState(() => account.allowance ? String(account.allowance.carryoverDays) : '');
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localError, setLocalError] = useState<TextValue>('');
  const [attempted, setAttempted] = useState(false);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const values = [entitlement, carryover].map(Number);
  const valid = entitlement.trim() !== '' && carryover.trim() !== '' && values.every(value => Number.isFinite(value) && value >= 0 && value <= 3650 && Number.isInteger(value * 2));
  const nextKey = valid ? `${values[0]}/${values[1]}` : '';
  const draftKey = valid ? nextKey : entitlement === '' && carryover === '' ? '' : JSON.stringify([entitlement, carryover]);
  const dirty = draftKey !== baseline;
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  useEffect(() => { dirtyCallback.current(dirty); }, [dirty]);
  const changed = valid && nextKey !== allowanceKey(account.allowance);
  const externalChange = baseline !== allowanceKey(account.allowance);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current || busy || !valid || !changed) return;
    if (externalChange && !window.confirm(t('confirmAllowanceChanged'))) return;
    pendingRef.current = true;
    setPending(true);
    setAttempted(true);
    onPending(true);
    setSaved(false);
    setLocalError('');
    try {
      const ok = await onSave({ year, entitlementDays: values[0], carryoverDays: values[1] });
      if (ok && mounted.current) { setBaseline(nextKey); setSaved(true); }
    } catch (issue) { if (mounted.current) setLocalError(errorText(issue, m('saveAllowanceFailed'))); }
    finally { pendingRef.current = false; if (mounted.current) { setPending(false); onPending(false); } }
  };
  const vacations = state.vacations.filter(day => Number(day.date.slice(0, 4)) === year).sort((a, b) => a.date.localeCompare(b.date));
  return <>
    <div className="vacation-account-stats">
      <div><span>{t('taken')}</span><strong>{daysLabel(account.takenDays)}</strong></div>
      <div><span>{t('planned')}</span><strong>{daysLabel(account.plannedDays)}</strong></div>
      <div><span>{t('remaining')}</span><strong className={account.remainingDays !== null && account.remainingDays < 0 ? 'negative' : ''}>{account.remainingDays === null ? t('unknown') : daysLabel(account.remainingDays)}</strong></div>
    </div>
    {account.remainingDays === null && <p className="muted small">{t('allowanceUnknown')}</p>}
    {account.remainingDays !== null && account.remainingDays < 0 && <p className="vacation-account-notice small">{t('allowanceExceeded')}</p>}
    <form className="vacation-allowance-form" onSubmit={submit}>
      <fieldset disabled={pending}>
        <legend>{t('allowanceYear', { year })}</legend>
        <div className="form-grid">
          <label className="field">{t('annualAllowance')}<input type="number" min={0} max={3650} step={0.5} required placeholder={t('notSet')} value={entitlement} onChange={event => { setEntitlement(event.target.value); setSaved(false); }} /></label>
          <label className="field">{t('carryover')}<input type="number" min={0} max={3650} step={0.5} required placeholder={t('notSet')} value={carryover} onChange={event => { setCarryover(event.target.value); setSaved(false); }} /></label>
        </div>
        <p className="muted small">{t('allowanceHelp')}</p>
        {externalChange && <p className="vacation-account-notice small" role="status">{t('allowanceExternal', { current: account.allowance ? t('allowanceCurrent', { entitlement: daysLabel(account.allowance.entitlementDays), carryover: daysLabel(account.allowance.carryoverDays) }) : t('noAllowance') })}</p>}
        {state.undo && changed && <p className="vacation-account-notice small">{t('allowanceUndo')}</p>}
        <div className="vacation-allowance-actions"><button type="submit" className="button secondary" disabled={busy || pending || !changed}>{t('saveAllowance')}</button>{saved && <span className="vacation-saved small" role="status">{t('allowanceSaved')}</span>}</div>
      </fieldset>
      {pending && <p className="muted small" role="status">{t('allowancePending')}</p>}
      {(localError || (attempted && !pending && requestError)) && <p className="form-error" role="alert">{renderText(localError) || requestError}</p>}
    </form>
    <div className="vacation-account-list">
      <h3>{t('vacationDaysYear', { year })}</h3>
      {vacations.length === 0 ? <p className="muted small">{t('noVacationYear')}</p> : <ul>{vacations.map(day => {
        // Public holidays suspend leave credit; show the same amount the account counts.
        const accounting = dayAccounting(state, day.date);
        return <li key={day.date}><div><strong>{longDate(day.date)}</strong><span>{day.fraction === 1 ? t('oneDay') : t('halfDayShort')} · {t('creditDuration', { duration: duration(accounting.vacationMinutes) })}{accounting.holiday ? ` · ${absenceText('suspended')}` : ''}</span></div><button type="button" className="button secondary" disabled={pending} onClick={() => onOpenVacation(day.date)} aria-label={t('editVacationDate', { date: longDate(day.date) })}>{t('edit')}</button></li>;
      })}</ul>}
    </div>
  </>;
}
