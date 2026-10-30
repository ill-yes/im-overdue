import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { AccountEntry, AccountEntryInput, AccountOpening, AppState } from '../../shared/types.js';
import { accountSummary } from '../../shared/accounting.js';
import { today, Temporal } from '../../shared/time.js';
import { duration, shortDate } from '../format';
import { errorText, useMessages, type TextValue } from '../i18n';
import { accountingMessages } from '../locales/accounting';
import { accountingUxMessages } from '../locales/accounting-ux';
import './hours-account.css';

function timeInput(minutes: number) {
  return `${minutes < 0 ? '-' : ''}${Math.floor(Math.abs(minutes) / 60)}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
}
function parseTime(value: string): number | null {
  const match = value.trim().replace('−', '-').match(/^([+-]?)(\d+):([0-5]\d)$/);
  if (!match) return null;
  const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1);
  return Number.isSafeInteger(minutes) && Math.abs(minutes) <= 1e9 ? minutes : null;
}
function validDate(value: string) { try { return Temporal.PlainDate.from(value).toString() === value; } catch { return false; } }
function entryFields(entry: AccountEntry) { return JSON.stringify([entry.date, entry.kind, timeInput(entry.kind === 'payout' ? Math.abs(entry.minutes) : entry.minutes), entry.reason]); }

export function HoursAccount({ state, busy, onOpening, onEntry, onDeleteEntry, onAbsence, onTimesheet, onDirtyChange, onPendingChange, resetDraft = 0 }: {
  state: AppState; busy: boolean;
  onOpening: (input: AccountOpening, expectedRevision: number) => Promise<boolean>;
  onEntry: (id: string | null, input: AccountEntryInput, expectedRevision: number) => Promise<boolean>;
  onDeleteEntry: (id: string, expectedRevision: number) => Promise<boolean>;
  onAbsence: () => void; onTimesheet: () => void;
  resetDraft?: number;
  onDirtyChange?: (dirty: boolean) => void; onPendingChange?: (pending: boolean) => void;
}) {
  const { t, m, text } = useMessages(accountingMessages);
  const { t: ux } = useMessages(accountingUxMessages);
  const summary = accountSummary(state);
  const [openingBase, setOpeningBase] = useState(() => state.accountOpening ?? null);
  const [openingDate, setOpeningDate] = useState(() => state.accountOpening?.date ?? today(state.settings.timezone));
  const [openingAmount, setOpeningAmount] = useState(() => timeInput(state.accountOpening?.minutes ?? 0));
  const [openingEditing, setOpeningEditing] = useState(!state.accountOpening);
  const [editing, setEditing] = useState<{ id: string | null; date: string; kind: 'payout' | 'correction'; amount: string; reason: string; base: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TextValue>('');
  const [saved, setSaved] = useState(false);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const openingToggle = useRef<HTMLButtonElement>(null);
  const openingInput = useRef<HTMLInputElement>(null);
  const previousOpeningEditing = useRef(openingEditing);
  const returnToOpeningToggle = useRef(false);
  const lastResetDraft = useRef(resetDraft);
  const helpId = useId();
  const openingMinutes = parseTime(openingAmount);
  const openingPreview = openingMinutes !== null && validDate(openingDate)
    ? accountSummary({ ...state, accountOpening: { date: openingDate, minutes: openingMinutes } }).confirmedMinutes : null;
  const openingDirty = openingBase ? openingDate !== openingBase.date || openingMinutes !== openingBase.minutes : openingAmount !== '0:00' || openingDate !== today(state.settings.timezone);
  const entryDirty = !!editing && JSON.stringify([editing.date, editing.kind, editing.amount, editing.reason]) !== editing.base;
  const currentEntry = editing?.id ? state.accountEntries?.find(entry => entry.id === editing.id) : undefined;
  const entryChanged = !!editing?.id && (!currentEntry || entryFields(currentEntry) !== editing.base);
  const openingUnchanged = !!state.accountOpening && openingDate === state.accountOpening.date && openingMinutes === state.accountOpening.minutes;
  const entryUnchanged = !!editing && !!currentEntry && editing.date === currentEntry.date && editing.kind === currentEntry.kind && (editing.kind === 'payout' ? -(parseTime(editing.amount) ?? 0) : parseTime(editing.amount)) === currentEntry.minutes && editing.reason.trim() === currentEntry.reason;
  const dirty = (openingEditing && openingDirty) || entryDirty;
  const parsedEntry = editing ? parseTime(editing.amount) : null;
  const entryPreview = editing && parsedEntry !== null && validDate(editing.date) && state.accountOpening && editing.date >= state.accountOpening.date
    ? accountSummary({ ...state, accountEntries: [
      ...(state.accountEntries ?? []).filter(entry => entry.id !== editing.id),
      { id: editing.id ?? 'preview', date: editing.date, kind: editing.kind, minutes: editing.kind === 'payout' ? -Math.abs(parsedEntry) : parsedEntry, reason: editing.reason },
    ] }).confirmedMinutes : null;
  const locked = busy || pending;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (lastResetDraft.current === resetDraft) return;
    lastResetDraft.current = resetDraft;
    setOpeningBase(state.accountOpening ?? null);
    setOpeningDate(state.accountOpening?.date ?? today(state.settings.timezone));
    setOpeningAmount(timeInput(state.accountOpening?.minutes ?? 0));
    returnToOpeningToggle.current = false;
    setOpeningEditing(!state.accountOpening);
    setEditing(null); setError(''); setSaved(false);
  }, [resetDraft, state]);
  useEffect(() => {
    if (openingEditing === previousOpeningEditing.current) return;
    previousOpeningEditing.current = openingEditing;
    if (openingEditing) openingInput.current?.focus({ preventScroll: true });
    else if (returnToOpeningToggle.current) openingToggle.current?.focus({ preventScroll: true });
    returnToOpeningToggle.current = false;
  }, [openingEditing]);
  const run = async (action: () => Promise<boolean>, done?: () => void) => {
    if (pendingRef.current || busy) return;
    pendingRef.current = true; setPending(true); setError(''); setSaved(false);
    try {
      const ok = await action();
      if (mounted.current && ok) { done?.(); setSaved(true); }
      else if (mounted.current) setError(m('saveFailed'));
    } catch (issue) { if (mounted.current) setError(errorText(issue, m('saveFailed'))); }
    finally { pendingRef.current = false; if (mounted.current) setPending(false); }
  };
  const saveOpening = (event: FormEvent) => {
    event.preventDefault();
    if (locked || openingUnchanged) return;
    if (openingMinutes === null || !validDate(openingDate)) { setError(m('invalidTime')); return; }
    const foreignOpening = JSON.stringify(openingBase) !== JSON.stringify(state.accountOpening ?? null);
    if ((foreignOpening || state.accountOpening) && !window.confirm(t(foreignOpening ? 'replaceRecordChanged' : 'openingConfirm'))) return;
    const input = { date: openingDate, minutes: openingMinutes };
    void run(() => onOpening(input, state.revision), () => { setOpeningBase(input); returnToOpeningToggle.current = true; setOpeningEditing(false); });
  };
  const resetOpening = () => {
    setOpeningBase(state.accountOpening ?? null);
    setOpeningDate(state.accountOpening?.date ?? today(state.settings.timezone));
    setOpeningAmount(timeInput(state.accountOpening?.minutes ?? 0));
    setError(''); setSaved(false);
  };
  const editOpening = () => {
    if (locked) return;
    resetOpening(); setOpeningEditing(true);
  };
  const cancelOpening = () => {
    if (locked || (openingDirty && !window.confirm(t('discard')))) return;
    resetOpening(); returnToOpeningToggle.current = true; setOpeningEditing(false);
  };
  const openEditor = (entry?: AccountEntry) => {
    if (locked || (entryDirty && !window.confirm(t('discard')))) return;
    const fields = { date: entry?.date ?? (state.accountOpening && state.accountOpening.date > summary.asOf ? state.accountOpening.date : summary.asOf), kind: entry?.kind ?? 'payout' as const, amount: timeInput(entry?.kind === 'payout' ? Math.abs(entry.minutes) : entry?.minutes ?? 0), reason: entry?.reason ?? '' };
    setEditing({ id: entry?.id ?? null, ...fields, base: JSON.stringify([fields.date, fields.kind, fields.amount, fields.reason]) });
    setError(''); setSaved(false);
  };
  const saveEntry = (event: FormEvent) => {
    event.preventDefault();
    if (!editing || locked || entryUnchanged) return;
    const parsed = parseTime(editing.amount);
    if (parsed === null) { setError(m('invalidTime')); return; }
    if (!state.accountOpening || !validDate(editing.date) || editing.date < state.accountOpening.date || !parsed || (editing.kind === 'payout' && parsed < 0) || !editing.reason.trim() || editing.reason.trim().length > 500) { setError(m('invalidEntry')); return; }
    if (entryChanged && !window.confirm(t(currentEntry ? 'replaceEntryChanged' : 'recreateEntry'))) return;
    const input: AccountEntryInput = { date: editing.date, kind: editing.kind, minutes: editing.kind === 'payout' ? -parsed : parsed, reason: editing.reason.trim() };
    void run(() => onEntry(editing.id && currentEntry ? editing.id : null, input, state.revision), () => setEditing(null));
  };
  return <section className="hours-account" aria-label={t('hoursAccount')}>
    <div className="hours-account-balance"><div><span>{t('confirmed')}</span><strong className={(summary.confirmedMinutes ?? 0) < 0 ? 'negative' : 'positive'}>{summary.confirmedMinutes === null ? '—' : duration(summary.confirmedMinutes, true)}</strong><p>{t('confirmedHelp', { date: shortDate(summary.asOf) })}</p></div>
      <dl><div><dt>{t('provisional')}</dt><dd>{duration(summary.provisionalMinutes, true)}</dd></div><div><dt>{t('planned')}</dt><dd>{duration(summary.plannedCompensationMinutes)}</dd></div><div><dt>{t('plannedEntries')}</dt><dd>{duration(summary.plannedEntryMinutes, true)}</dd></div></dl>
    </div>
    <p className="muted small">{t('provisionalHelp')}</p>
    <div className="hours-account-actions">
      <button type="button" className="button secondary" disabled={locked} onClick={onAbsence}>{ux('addAbsence')}</button>
      <button type="button" className="button secondary" disabled={locked} onClick={onTimesheet}>{ux('timesheet')}</button>
    </div>
    {summary.confirmedMinutes !== null && summary.confirmedMinutes < 0 && <p className="hours-account-notice" role="status">{t('negativeWarning')}</p>}
    {!state.accountOpening && <p className="hours-account-notice">{t('openingMissing')}</p>}
    {state.accountOpening && state.accountOpening.date > summary.asOf && <p className="hours-account-notice">{t('openingFuture')}</p>}
    {state.accountOpening && !openingEditing ? <div className="hours-account-opening-summary">
      <div><h3>{t('opening')}</h3><p><time dateTime={state.accountOpening.date}>{shortDate(state.accountOpening.date)}</time><strong>{duration(state.accountOpening.minutes, true)}</strong></p></div>
      <button ref={openingToggle} type="button" className="button quiet" disabled={locked} onClick={editOpening}>{ux('editOpening')}</button>
    </div> : <form className="hours-account-opening" onSubmit={saveOpening}>
      <h3>{t(state.accountOpening ? 'opening' : 'setupAccount')}</h3><p id={helpId} className="muted small">{t('openingHelp')}</p>
      <fieldset disabled={locked} aria-describedby={helpId}><div className="hours-account-fields"><label className="field">{t('date')}<input ref={openingInput} type="date" required value={openingDate} onChange={e => { setOpeningDate(e.target.value); setSaved(false); }} /></label><label className="field">{t('amount')}<input required placeholder="0:00" value={openingAmount} onChange={e => { setOpeningAmount(e.target.value); setSaved(false); }} /></label><button className="button secondary" type="submit" disabled={openingUnchanged}>{t('saveOpening')}</button></div><p className="muted small">{t('signedHelp')}</p>{state.accountOpening && <button type="button" className="button quiet" onClick={cancelOpening}>{t('cancel')}</button>}</fieldset>
    </form>}
    {openingEditing && (openingDirty || !state.accountOpening) && <p className="hours-account-preview" role="status">{t('balanceAfter', { balance: openingPreview === null ? '—' : duration(openingPreview, true) })}</p>}
    <div className="hours-account-ledger-heading"><h3>{t('ledger')}</h3><button type="button" className="button secondary" disabled={locked || !state.accountOpening} onClick={() => openEditor()}>{t('addEntry')}</button></div>
    {editing && <form className="hours-account-editor" onSubmit={saveEntry}><h4>{t(editing.id ? 'editEntry' : 'addEntry')}</h4><fieldset disabled={locked}><div className="hours-account-fields"><label className="field">{t('date')}<input data-dialog-autofocus type="date" required min={state.accountOpening?.date} value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} /></label><label className="field">{t('kind')}<select value={editing.kind} onChange={e => setEditing({ ...editing, kind: e.target.value as 'payout' | 'correction' })}><option value="payout">{t('payout')}</option><option value="correction">{t('correction')}</option></select></label><label className="field">{t('amount')}<input required placeholder="0:00" value={editing.amount} onChange={e => setEditing({ ...editing, amount: e.target.value })} /></label></div><p className="muted small">{t(editing.kind === 'payout' ? 'payoutHelp' : 'signedHelp')}</p><label className="field">{t('reason')}<textarea required maxLength={500} rows={2} value={editing.reason} onChange={e => setEditing({ ...editing, reason: e.target.value })} /></label><div className="dialog-actions compact"><button type="button" className="button secondary" onClick={() => { if (!entryDirty || window.confirm(t('discard'))) setEditing(null); }}>{t('cancel')}</button><button type="submit" className="button primary" disabled={entryUnchanged}>{t('save')}</button></div></fieldset></form>}
    {editing && <p className="hours-account-preview" role="status">{t(editing.date > summary.asOf ? 'futureEntryPreview' : 'balanceAfter', { balance: entryPreview === null ? '—' : duration(entryPreview, true) })}</p>}
    {editing && entryPreview !== null && entryPreview < 0 && <p className="hours-account-notice" role="status">{t('negativeWarning')}</p>}
    <ul className="hours-account-ledger">{[...(state.accountEntries ?? [])].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).map(entry => <li key={entry.id} className={state.accountOpening && entry.date < state.accountOpening.date ? 'is-excluded' : ''}><div className="hours-account-entry"><span><strong>{shortDate(entry.date)}</strong><small>{t(entry.kind)}{state.accountOpening && entry.date < state.accountOpening.date ? ` · ${t('excluded')}` : entry.date > summary.asOf ? ` · ${t('future')}` : ''}</small></span><b className={entry.minutes < 0 ? 'negative' : 'positive'}>{duration(entry.minutes, true)}</b></div><p>{entry.reason}</p><div className="hours-account-entry-actions"><button className="button quiet" type="button" disabled={locked || !state.accountOpening} onClick={() => openEditor(entry)}>{t('edit')}</button><button className="button quiet danger-text" type="button" disabled={locked} onClick={() => { if (window.confirm(t('deleteEntryConfirm'))) void run(() => onDeleteEntry(entry.id, state.revision), () => { if (editing?.id === entry.id) setEditing(null); }); }}>{t('delete')}</button></div></li>)}</ul>
    {!(state.accountEntries?.length) && <p className="muted small">{t('ledgerEmpty')}</p>}
    {entryChanged && <p className="hours-account-notice" role="status">{t('changed')}</p>}
    {openingEditing && JSON.stringify(openingBase) !== JSON.stringify(state.accountOpening ?? null) && <p className="hours-account-notice" role="status">{t('changed')}</p>}
    {pending && <p className="muted small" role="status">{t('saving')}</p>}{saved && <p className="positive small" role="status">{t('saved')}</p>}{error && <p className="form-error" role="alert">{text(error)}</p>}
  </section>;
}
