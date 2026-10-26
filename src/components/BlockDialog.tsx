import { useMessages, errorText, type TextValue } from '../i18n';
import { workflows } from '../locales/workflows';
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronRight, Trash2 } from 'lucide-react';
import type { BlockInput, RecentEntry, ReusableInput, WorkBlock, WorkTemplate } from '../../shared/types.js';
import { Temporal, localDate, localTime, minutesBetween, offsetAt, resolveLocal, shiftInstant } from '../../shared/time.js';
import { REUSABLE_NOTE_MAX_LENGTH, REUSABLE_TITLE_MAX_LENGTH } from '../../shared/reuse.js';
import { duration } from '../format';
import { Modal } from './Modal';
import { ReusePicker, type ReuseEditorView, type ReusePickerHandle } from './ReusePicker';
import './block-dialog.css';

type Choice = 'earlier' | 'later' | '';
type EndFields = { date: string; time: string; choice: Choice };

function instantChoice(date: string, time: string, instant: string | undefined, zone: string): Choice {
  if (!instant) return '';
  const resolution = resolveLocal(date, time, zone);
  return resolution.kind === 'ambiguous' ? (Temporal.Instant.compare(resolution.later, instant) === 0 ? 'later' : 'earlier') : '';
}

function endFields(instant: string, zone: string): EndFields {
  const date = localDate(instant, zone);
  const time = localTime(instant, zone);
  return { date, time, choice: instantChoice(date, time, instant, zone) };
}

export function BlockDialog({
  date, block, zone, busy, requestError, initialInput, initialReuse, initialZone,
  templates = [], recentEntries = [], blocks = [], hasUndo = false,
  onClose, onSave, onDelete, onSaveTemplate, onDeleteTemplate,
}: {
  date: string;
  block?: WorkBlock;
  zone: string;
  busy: boolean;
  requestError: string;
  initialInput?: BlockInput;
  initialZone?: string;
  initialReuse?: ReusableInput;
  templates?: WorkTemplate[];
  recentEntries?: RecentEntry[];
  blocks?: WorkBlock[];
  hasUndo?: boolean;
  onClose: () => void;
  onSave: (input: BlockInput) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onSaveTemplate?: (input: ReusableInput, id?: string) => Promise<boolean>;
  onDeleteTemplate?: (id: string) => Promise<boolean>;
}) {
  const { t, m, text: renderText } = useMessages(workflows);
  // App keys each dialog session. Keep the zone and draft stable across state refreshes.
  const [inputZone] = useState(initialZone ?? zone);
  const originalStart = block?.start ?? initialInput?.start;
  const originalEnd = block?.end ?? initialInput?.end;
  const [startDate, setStartDate] = useState(originalStart ? localDate(originalStart, inputZone) : date);
  const [startTime, setStartTime] = useState(originalStart ? localTime(originalStart, inputZone) : '09:00');
  const [startChoice, setStartChoice] = useState<Choice>(() => instantChoice(startDate, startTime, originalStart, inputZone));
  const initialEnd = originalEnd ? endFields(originalEnd, inputZone) : { date, time: '17:00', choice: '' as Choice };
  const [endDate, setEndDate] = useState(initialEnd.date);
  const [endTime, setEndTime] = useState(initialEnd.time);
  const [endChoice, setEndChoice] = useState<Choice>(initialEnd.choice);
  const [title, setTitle] = useState(block?.title ?? initialInput?.title ?? initialReuse?.title ?? '');
  const [note, setNote] = useState(block?.note ?? initialInput?.note ?? initialReuse?.note ?? '');
  const [noteOpen, setNoteOpen] = useState(Boolean(block?.note ?? initialInput?.note ?? initialReuse?.note));
  const [rememberTemplate, setRememberTemplate] = useState(false);
  const [templateOptionsOpen, setTemplateOptionsOpen] = useState(false);
  const [reuseOpen, setReuseOpen] = useState(false);
  const [reusePending, setReusePending] = useState(false);
  const [reuseEditorView, setReuseEditorView] = useState<ReuseEditorView>(null);
  const reuseRef = useRef<ReusePickerHandle>(null);
  const reuseToggleRef = useRef<HTMLButtonElement>(null);
  const focusTitle = useRef(true);
  const [timeEdited, setTimeEdited] = useState(false);
  const [pendingDuration, setPendingDuration] = useState<number | null>(null);
  const [error, setError] = useState<TextValue>('');
  const [feedback, setFeedback] = useState<TextValue>('');
  const [pending, setPending] = useState<'save' | 'delete' | 'template' | null>(null);
  const pendingRef = useRef(false);
  const textEdited = useRef(false);
  const mounted = useRef(true);
  const titleRef = useRef<HTMLInputElement>(null);
  const endErrorId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    if (!reuseOpen) (focusTitle.current ? titleRef.current : reuseToggleRef.current)?.focus();
  }, [reuseOpen]);

  const startResolution = (() => { try { return resolveLocal(startDate, startTime, inputZone); } catch { return null; } })();
  const endResolution = (() => { try { return resolveLocal(endDate, endTime, inputZone); } catch { return null; } })();
  const choose = (resolution: ReturnType<typeof resolveLocal> | null, choice: Choice) => {
    if (!resolution || resolution.kind === 'missing') return null;
    if (resolution.kind === 'valid') return resolution.instant;
    return choice ? resolution[choice] : null;
  };
  const start = choose(startResolution, startChoice);
  const end = choose(endResolution, endChoice);
  const length = start && end ? minutesBetween(start, end) : null;
  const exceedsLocalWeek = start && end
    ? Temporal.Instant.compare(end, Temporal.Instant.from(start).toZonedDateTimeISO(inputZone).add({ days: 7 }).toInstant()) > 0
    : false;
  const invalidDuration = length !== null && (length <= 0 || !Number.isInteger(length) || exceedsLocalWeek);
  const durationError = exceedsLocalWeek
    ? t('blockMaxWeek')
    : length !== null && !Number.isInteger(length)
    ? t('blockWholeMinutes')
    : t('blockEndAfterStart');
  const canApplyDurationAutomatically = !block && !initialInput && !timeEdited && start !== null;
  const setEndFromDuration = (startInstant: string, minutes: number) => {
    const next = endFields(shiftInstant(startInstant, minutes), inputZone);
    setEndDate(next.date);
    setEndTime(next.time);
    setEndChoice(next.choice);
    setPendingDuration(null);
  };
  const applyReuse = (entry: ReusableInput) => {
    if (pendingRef.current || reusePending) return;
    if (textEdited.current && (title !== entry.title || note !== entry.note) && !window.confirm(t('confirmReplaceText'))) return;
    setTitle(entry.title);
    setNote(entry.note);
    if (entry.note) setNoteOpen(true);
    textEdited.current = false;
    setFeedback(m('selectionApplied'));
    setError('');
    focusTitle.current = true;
    setReuseOpen(false);
    if (canApplyDurationAutomatically) setEndFromDuration(start!, entry.durationMinutes);
    else setPendingDuration(entry.durationMinutes);
  };
  useEffect(() => {
    if (initialReuse && !block && !initialInput) {
      if (start) setEndFromDuration(start, initialReuse.durationMinutes);
      else setPendingDuration(initialReuse.durationMinutes);
    }
    // Initial reuse applies once for this keyed session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const close = () => {
    if (reusePending || (pendingRef.current && pending === 'template')) return;
    if (reuseOpen && reuseRef.current && !reuseRef.current.canClose()) return;
    onClose();
  };
  const closeReuse = () => {
    if (reusePending) return;
    focusTitle.current = false;
    setReuseOpen(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pendingRef.current || busy || reusePending) return;
    if (!start || !end) { setError(m('chooseValidTime')); return; }
    if (invalidDuration || length === null) return;
    if (rememberTemplate && !title.trim()) { setError(m('templateNeedsActivity')); return; }
    setError('');
    setFeedback('');
    pendingRef.current = true;
    setPending('save');
    try { await onSave({ start, end, title: title.trim(), note: note.trim(), rememberTemplate }); }
    catch (issue) { if (mounted.current) setError(errorText(issue, m('saveBlockFailed'))); }
    finally { pendingRef.current = false; if (mounted.current) setPending(null); }
  };
  const saveTemplateOnly = async () => {
    if (!onSaveTemplate || !start || !end || !length || invalidDuration || !title.trim() || pendingRef.current || busy || reusePending) return;
    pendingRef.current = true;
    setPending('template');
    setError('');
    setFeedback('');
    try {
      const saved = await onSaveTemplate({ title: title.trim(), note: note.trim(), durationMinutes: length });
      if (saved && mounted.current) setFeedback(m('templateSavedBlockUnsaved'));
    } catch (issue) { if (mounted.current) setError(errorText(issue, m('saveTemplateFailed'))); }
    finally { pendingRef.current = false; if (mounted.current) setPending(null); }
  };
  const remove = async () => {
    if (pendingRef.current || busy || reusePending) return;
    pendingRef.current = true;
    setPending('delete');
    setError('');
    try { await onDelete(); }
    catch (issue) { if (mounted.current) setError(errorText(issue, m('deleteBlockFailed'))); }
    finally { pendingRef.current = false; if (mounted.current) setPending(null); }
  };
  const ambiguity = (label: string, resolution: ReturnType<typeof resolveLocal> | null, value: Choice, setter: (v: Choice) => void) => {
    if (!resolution) return <p className="form-error">{t('invalidTime', { label })}</p>;
    if (resolution.kind === 'missing') return <p className="form-error">{t('missingTime', { label })}</p>;
    if (resolution.kind === 'ambiguous') return <label className="field full">{t('ambiguousTime', { label })}
      <select value={value} onChange={(event) => { setter(event.target.value as Choice); setTimeEdited(true); }} required disabled={pending !== null || reusePending}>
        <option value="">{t('chooseOccurrence')}</option>
        <option value="earlier">{t('firstOccurrence', { offset: offsetAt(resolution.earlier, inputZone) })}</option>
        <option value="later">{t('secondOccurrence', { offset: offsetAt(resolution.later, inputZone) })}</option>
      </select>
    </label>;
    return null;
  };
  const modalTitle = reuseOpen
    ? reuseEditorView === 'new' ? t('newTemplate') : reuseEditorView === 'edit' ? t('editTemplate') : t('quickPick')
    : block ? t('editBlock') : t('createBlock');
  return <Modal title={modalTitle} onClose={close} onEscape={() => reuseOpen ? reuseRef.current?.back() : close()} closeDisabled={reusePending || pending === 'template'} className="workflow-modal">
    <div className="block-dialog-content">
      {onSaveTemplate && onDeleteTemplate && <ReusePicker ref={reuseRef} active={reuseOpen} templates={templates} recentEntries={recentEntries} blocks={blocks} zone={inputZone} busy={busy || pending !== null} hasUndo={hasUndo} requestError={requestError} onSelect={applyReuse} onSaveTemplate={onSaveTemplate} onDeleteTemplate={onDeleteTemplate} onPendingChange={setReusePending} onEditorChange={setReuseEditorView} onBack={closeReuse} backLabel={t('backWorkingTime')} />}
    {!reuseOpen && <form onSubmit={submit} className="block-dialog-form">
      <div className="dialog-scroll">
      {zone !== inputZone && <p className="form-error" role="status">{t('zoneChanged', { zone, inputZone })}</p>}
      <div className="form-grid">
        <label className="field full">{t('activity')} <span className="optional">{t('optional')}</span><input ref={titleRef} data-dialog-autofocus maxLength={REUSABLE_TITLE_MAX_LENGTH} value={title} onChange={(event) => { textEdited.current = true; setTitle(event.target.value); setFeedback(''); }} placeholder={t('activityPlaceholder')} disabled={pending !== null || reusePending} /></label>
        <label className="field">{t('startDate')}<input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setStartChoice(''); setTimeEdited(true); }} required disabled={pending !== null || reusePending} /></label>
        <label className="field">{t('startTime')}<input type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); setStartChoice(''); setTimeEdited(true); }} required disabled={pending !== null || reusePending} /></label>
        {ambiguity(t('start'), startResolution, startChoice, setStartChoice)}
        <label className="field">{t('endDate')}<input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setEndChoice(''); setTimeEdited(true); }} required disabled={pending !== null || reusePending} aria-describedby={invalidDuration ? endErrorId : undefined} /></label>
        <label className="field">{t('endTime')}<input type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); setEndChoice(''); setTimeEdited(true); }} required disabled={pending !== null || reusePending} aria-describedby={invalidDuration ? endErrorId : undefined} /></label>
        {ambiguity(t('end'), endResolution, endChoice, setEndChoice)}
      </div>
      <p className="muted small block-input-zone">{t('inputZone')} <strong>{inputZone}</strong></p>
      {pendingDuration !== null && <div className="block-duration-action"><span>{start ? t('selectedDuration', { duration: duration(pendingDuration) }) : t('selectedDurationStart', { duration: duration(pendingDuration) })}</span><button type="button" className="button secondary" onClick={() => { if (start) setEndFromDuration(start, pendingDuration); }} disabled={!start || pending !== null || reusePending}>{t('applyTemplateDuration')}</button></div>}
      <div className="calculation-line"><span>{t('duration')}</span><strong>{length !== null && length > 0 ? duration(length) : '—'}</strong></div>
      {invalidDuration && <p className="form-error" id={endErrorId} role="alert">{durationError}</p>}
      <p className="muted small block-time-hint">{t('breakHint')}</p>
      <details className="block-disclosure" open={noteOpen} onToggle={(event) => setNoteOpen(event.currentTarget.open)}>
        <summary>{t('note')} {note.trim() && <span>{t('present')}</span>}</summary>
        <label className="field">{t('note')} <span className="optional">{t('optional')}</span><textarea rows={2} maxLength={REUSABLE_NOTE_MAX_LENGTH} value={note} onChange={(event) => { textEdited.current = true; setNote(event.target.value); setFeedback(''); }} placeholder={t('moreDetails')} disabled={pending !== null || reusePending} /></label>
      </details>
      {onSaveTemplate && onDeleteTemplate && <button ref={reuseToggleRef} type="button" className="button secondary block-reuse-toggle" onClick={() => setReuseOpen(true)} disabled={pending !== null}>{t('quickPick')}<ChevronRight size={16} /></button>}
      {onSaveTemplate && <details className="block-template-section block-disclosure" open={templateOptionsOpen} onToggle={(event) => setTemplateOptionsOpen(event.currentTarget.open)}>
        <summary>{t('templateOptions')} {rememberTemplate && <span className="block-template-active">{t('rememberTemplateActive')}</span>}</summary>
        <label className="block-remember"><input type="checkbox" checked={rememberTemplate} onChange={(event) => setRememberTemplate(event.target.checked)} disabled={pending !== null || reusePending} />{t('rememberTemplate')}</label>{rememberTemplate && !title.trim() && <p className="muted small">{t('templateActivityHint')}</p>}{rememberTemplate && title.trim() && <p className="muted small">{t('blockAndTemplateAtomic')}</p>}
        <button type="button" className="button secondary block-template-only" onClick={saveTemplateOnly} disabled={busy || pending !== null || reusePending || !title.trim() || !start || !end || !length || invalidDuration}>{t('onlyTemplate')}</button>
        {hasUndo && title.trim() && <p className="block-warning small">{t('onlyTemplateUndo')}</p>}</details>}
      </div>
      {(pending || feedback || error || requestError) && <div className="workflow-feedback">
        {pending && <p className="muted small" role="status">{pending === 'template' ? t('savingTemplateWait') : t(pending === 'delete' ? 'deletingContinues' : 'savingContinues')}</p>}
        {feedback && <p className="block-feedback small" role="status">{renderText(feedback)}</p>}
        {error && <p className="form-error" role="alert">{renderText(error)}</p>}
        {requestError && <p className="form-error" role="alert">{requestError}</p>}
      </div>}
      <div className="dialog-actions block-actions workflow-actions">
        {block && <button type="button" className="button danger-text push-left" disabled={busy || pending !== null || reusePending} onClick={remove}><Trash2 size={15} />{t('delete')}</button>}
        <button type="button" className="button secondary" onClick={close} disabled={reusePending || pending === 'template'}>{pending ? t('close') : t('cancel')}</button>
        <button className="button primary" type="submit" disabled={busy || pending !== null || reusePending || !start || !end || length === null || invalidDuration || (rememberTemplate && !title.trim())}>{pending === 'save' ? t('savingBlock') : t('saveBlock')}</button>
      </div>
    </form>}
    </div>
  </Modal>;
}
