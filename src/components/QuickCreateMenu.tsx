import { useMessages, errorText, type TextValue } from '../i18n.js';
import { calendarMessages } from '../locales/calendar.js';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronRight, Search, X } from 'lucide-react';
import type { AppState, BlockInput } from '../../shared/types.js';
import { REUSABLE_TITLE_MAX_LENGTH } from '../../shared/reuse.js';
import { localDate, localTimeWithOffset, minutesBetween } from '../../shared/time.js';
import { duration, longDate, shortDate } from '../format';
import type { QuickCreateDraft } from '../quick-create';
import { quickReuseGroups, type QuickReuseEntry } from '../quick-reuse-model';
import { useQuickCreatePosition } from '../hooks/useQuickCreatePosition';
import './quick-create-menu.css';

export function QuickCreateMenu({ draft, state, busy, requestError, onSave, onDetails, onClose }: {
  draft: QuickCreateDraft;
  state: AppState;
  busy: boolean;
  requestError: TextValue;
  onSave: (input: BlockInput) => Promise<boolean>;
  onDetails: (input: BlockInput) => void;
  onClose: (restoreFocus: boolean) => void;
}) {
  const { t, m, language, text } = useMessages(calendarMessages);
  const [title, setTitle] = useState(draft.input.title ?? '');
  const [note, setNote] = useState(draft.input.note);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TextValue>('');
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLFormElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const initialFocusDone = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listOpenRef = useRef(false);
  const focusNext = useRef<'search' | 'trigger' | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();
  const position = useQuickCreatePosition(draft, rootRef, mainRef, listRef, listOpen, onClose, state.settings.timezone);
  const groups = useMemo(() => quickReuseGroups(state, draft.zone, query, language), [state, draft.zone, query, language]);
  const inlineList = Boolean(listOpen && position?.inline);
  listOpenRef.current = listOpen;

  const clearHoverTimer = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = null; };
  const openList = (focus: boolean) => {
    if (pendingRef.current) return;
    clearHoverTimer();
    focusNext.current = focus ? 'search' : null;
    setListOpen(true);
    if (focus && listOpen) { searchRef.current?.focus(); focusNext.current = null; }
  };
  const back = () => {
    clearHoverTimer();
    focusNext.current = 'trigger';
    setListOpen(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearHoverTimer(); };
  }, []);
  useLayoutEffect(() => {
    if (position && !initialFocusDone.current && titleRef.current) {
      titleRef.current.focus({ preventScroll: true });
      initialFocusDone.current = true;
    }
  }, [position]);
  useLayoutEffect(() => {
    const control = focusNext.current === 'search' ? searchRef.current : focusNext.current === 'trigger' ? triggerRef.current : null;
    if (control) { control.focus({ preventScroll: true }); focusNext.current = null; }
  }, [listOpen, inlineList]);
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (listOpenRef.current) back();
      else onClose(true);
    };
    const pointerdown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(':disabled, [aria-disabled="true"]')) return;
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) onClose(false);
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) onClose(false);
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('pointerdown', pointerdown, true);
    document.addEventListener('focusin', focusin);
    return () => { document.removeEventListener('keydown', keydown, true); document.removeEventListener('pointerdown', pointerdown, true); document.removeEventListener('focusin', focusin); };
  }, [onClose]);

  const input = (text = { title, note }): BlockInput => ({ ...draft.input, title: text.title.trim(), note: text.note.trim() });
  const save = async (candidate: BlockInput) => {
    if (pendingRef.current || busy) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    clearHoverTimer();
    try {
      await onSave(candidate);
    } catch (issue) {
      if (mountedRef.current) setError(errorText(issue, m('saveFailed')));
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void save(input()); };
  const select = (entry: QuickReuseEntry) => {
    if (pendingRef.current || busy) return;
    setTitle(entry.title);
    setNote(entry.note);
    void save(input(entry));
  };
  const listKeydown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft' && event.target !== searchRef.current) { event.preventDefault(); back(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    if ((event.key === 'Home' || event.key === 'End') && event.target === searchRef.current) return;
    const entries = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.quick-create-choice:not(:disabled)') ?? [])];
    if (!entries.length) return;
    event.preventDefault();
    const current = entries.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1
      : current < 0 ? event.key === 'ArrowUp' ? entries.length - 1 : 0
      : (current + (event.key === 'ArrowUp' ? -1 : 1) + entries.length) % entries.length;
    entries[next]?.focus();
  };
  const leave = () => {
    clearHoverTimer();
    hoverTimer.current = setTimeout(() => {
      if (!listRef.current?.contains(document.activeElement) && !pendingRef.current) setListOpen(false);
    }, 220);
  };
  const notices = <>
    {state.settings.timezone !== draft.zone && <p className="quick-create-hint" role="status">{t('zoneChanged', { zone: draft.zone })}</p>}
    {(requestError || error) && <p className="quick-create-error" role="alert">{text(requestError || error)}</p>}
    {pending && <p className="quick-create-hint" role="status">{t('savingContinues')}</p>}
    {busy && !pending && <p className="quick-create-hint" role="status">{t('otherChange')}</p>}
  </>;
  const endDate = localDate(draft.input.end, draft.zone);

  return createPortal(<div
    className={`quick-create-root${inlineList ? ' quick-create-inline' : ''}`}
    ref={rootRef} role="dialog" aria-label={t('quickEntry')} aria-modal="false"
    style={{ left: position?.left ?? 8, top: position?.top ?? 8, width: position?.width ?? 300, visibility: position ? 'visible' : 'hidden', '--quick-create-max-height': `${position?.maxHeight ?? 500}px` } as CSSProperties}
    onPointerEnter={clearHoverTimer} onPointerLeave={(event) => { if (event.pointerType === 'mouse') leave(); }}
  >
    {!inlineList && <form ref={mainRef} className="quick-create-panel quick-create-main" onSubmit={submit}>
      <header className="quick-create-heading"><strong>{t('enterWorkingTime')}</strong><button className="icon-button" type="button" aria-label={t('closeQuickEntry')} onClick={() => onClose(true)}><X size={16} /></button></header>
      <div className="quick-create-summary">
        <strong>{longDate(draft.anchor.date)}</strong>
        <span>{localTimeWithOffset(draft.input.start, draft.zone)} – {endDate !== draft.anchor.date && `${shortDate(endDate)} · `}{localTimeWithOffset(draft.input.end, draft.zone)}</span>
        <span>{t('duration')} <b>{duration(minutesBetween(draft.input.start, draft.input.end))}</b></span>
      </div>
      <label className="field quick-create-title">{t('activityTitle')}<input ref={titleRef} value={title} maxLength={REUSABLE_TITLE_MAX_LENGTH} onChange={(event) => setTitle(event.target.value)} placeholder={t('optional')} disabled={pending} /></label>
      {note && <p className="quick-create-note" title={note}>{note}</p>}
      <button ref={triggerRef} className="quick-create-trigger" type="button" aria-expanded={listOpen} aria-controls={listId} disabled={pending} onPointerEnter={(event) => { if (event.pointerType === 'mouse' && position && !position.inline) openList(false); }} onClick={() => openList(true)} onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); openList(true); } }}><span>{t('quickSelection')}</span><ChevronRight size={17} /></button>
      {!listOpen && notices}
      <button className="button primary quick-create-save" type="submit" disabled={pending || busy}>{pending ? t('saving') : t('save')}</button>
      <button className="quick-create-details" type="button" disabled={pending} onClick={() => { if (!pendingRef.current) onDetails(input()); }}>{t('details')}</button>
    </form>}
    {listOpen && <section ref={listRef} id={listId} className="quick-create-panel quick-create-list" aria-label={t('quickSelection')} onKeyDown={listKeydown} style={inlineList ? undefined : { left: position?.listLeft ?? 308, top: position?.listTop ?? 0 }}>
      <header className="quick-create-heading"><button className="quick-create-back" type="button" onClick={back}><ArrowLeft size={16} />{t('back')}</button><strong>{t('quickSelection')}</strong>{inlineList && <button className="icon-button" type="button" aria-label={t('closeQuickEntry')} onClick={() => onClose(true)}><X size={16} /></button>}</header>
      <p className="quick-create-hint">{t('selectSaves', { duration: duration(minutesBetween(draft.input.start, draft.input.end)) })}</p>
      <label className="quick-create-search"><Search size={15} aria-hidden="true" /><span className="visually-hidden">{t('searchReuse')}</span><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchReuse')} disabled={pending} /></label>
      <div className="quick-create-entries">
        {groups.map((group) => <section className="quick-create-group" key={group.id} aria-label={group.label}><h3>{group.label}</h3>{group.entries.length ? <ul>{group.entries.map((entry) => <li key={entry.id}><button type="button" className="quick-create-choice" aria-label={t('reuseTitle', { title: entry.title || t('withoutTitle') })} onClick={() => select(entry)} disabled={pending || busy}><strong>{entry.title || t('withoutTitle')}</strong>{entry.workDate && <small>{shortDate(entry.workDate)}</small>}{entry.note && <span>{entry.note}</span>}</button></li>)}</ul> : <p className="quick-create-empty">{query ? t('noMatchingEntries') : group.id === 'templates' ? t('noTemplates') : t('noEntries')}</p>}</section>)}
      </div>
      {notices}
    </section>}
  </div>, document.body);
}
