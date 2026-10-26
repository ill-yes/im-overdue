import { useMessages, errorText, type TextValue } from '../i18n';
import { workflows } from '../locales/workflows';
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from 'react';
import { ArrowLeft, Check, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { RecentEntry, ReusableInput, WorkBlock, WorkTemplate } from '../../shared/types.js';
import { REUSABLE_DURATION_MAX_MINUTES, REUSABLE_NOTE_MAX_LENGTH, REUSABLE_TITLE_MAX_LENGTH, reusableKey } from '../../shared/reuse.js';
import { duration, longDate, shortDate } from '../format';
import { legacyReuseEntries, matchesReuse, recentReuseEntries } from '../reuse-model';
import './reuse-picker.css';

type Editor = { id?: string; original?: WorkTemplate; title: string; note: string; durationMinutes: string };
export type ReuseEditorView = 'new' | 'edit' | null;
export interface ReusePickerHandle { back: () => void; canClose: () => boolean; prepareLeave: () => boolean }

export function ReusePicker({
  templates,
  recentEntries,
  blocks,
  busy,
  hasUndo,
  onSelect,
  onSaveTemplate,
  onDeleteTemplate,
  onBack,
  backLabel,
  onPendingChange,
  onEditorChange,
  targetDate,
  requestError = '',
  active = true,
  presentation = 'dialog',
  ref,
  zone = 'UTC',
}: {
  templates: WorkTemplate[];
  recentEntries: RecentEntry[];
  blocks: WorkBlock[];
  busy: boolean;
  hasUndo: boolean;
  onSelect: (entry: ReusableInput) => void;
  onSaveTemplate: (input: ReusableInput, id?: string) => Promise<boolean>;
  onDeleteTemplate: (id: string) => Promise<boolean>;
  onBack: () => void;
  backLabel?: string;
  onPendingChange?: (pending: boolean) => void;
  onEditorChange?: (view: ReuseEditorView) => void;
  targetDate?: string;
  requestError?: string;
  active?: boolean;
  presentation?: 'dialog' | 'page';
  ref?: Ref<ReusePickerHandle>;
  zone?: string;
}) {
  const { t, m, text: renderText, locale } = useMessages(workflows);
  const [tab, setTab] = useState<'templates' | 'recent'>('templates');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TextValue>('');
  const [feedback, setFeedback] = useState<TextValue>('');
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const tabsId = useId();
  const editorTitleRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const editRefs = useRef(new Map<string, HTMLButtonElement>());
  const returnTarget = useRef<'create' | { id: string } | null>(null);
  const listScroll = useRef<HTMLDivElement>(null);
  const listScrollTop = useRef(0);
  const focusAfterDelete = useRef(false);
  const templatesTabRef = useRef<HTMLButtonElement>(null);
  const recentTabRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const editorView: ReuseEditorView = editor ? editor.id ? 'edit' : 'new' : null;
  useLayoutEffect(() => { onEditorChange?.(editorView); }, [editorView, onEditorChange]);
  useLayoutEffect(() => {
    if (!active) return;
    if (editorView) editorTitleRef.current?.focus();
    else {
      if (listScroll.current) listScroll.current.scrollTop = listScrollTop.current;
      const target = returnTarget.current;
      const control = target === 'create' ? createRef.current : target ? editRefs.current.get(target.id) : null;
      (control ?? searchRef.current)?.focus({ preventScroll: true });
      returnTarget.current = null;
    }
  }, [active, editorView]);
  useLayoutEffect(() => {
    if (active && !pending && focusAfterDelete.current) {
      focusAfterDelete.current = false;
      searchRef.current?.focus();
    }
  }, [active, pending]);
  const recent = useMemo(() => recentReuseEntries(recentEntries), [recentEntries]);
  const legacy = useMemo(() => legacyReuseEntries(blocks, zone), [blocks, zone]);
  const matchingTemplates = templates.filter((entry) => matchesReuse(entry, query));
  const matchingRecent = recent.filter((entry) => matchesReuse(entry, query));
  const matchingLegacy = legacy.filter((entry) => matchesReuse(entry, query));
  const locked = busy || pending;
  const changed = editor && (editor.original
    ? reusableKey({ title: editor.title, note: editor.note, durationMinutes: Number(editor.durationMinutes) }) !== reusableKey(editor.original)
    : Boolean(editor.title.trim() || editor.note.trim() || editor.durationMinutes !== '60'));
  const currentTemplate = editor?.id ? templates.find((item) => item.id === editor.id) : undefined;
  const externallyChanged = editor?.original && (!currentTemplate || reusableKey(currentTemplate) !== reusableKey(editor.original));
  const minutes = editor ? Number(editor.durationMinutes) : 0;
  const valid = editor && editor.title.trim().length > 0 && editor.title.trim().length <= REUSABLE_TITLE_MAX_LENGTH
    && editor.note.length <= REUSABLE_NOTE_MAX_LENGTH && Number.isInteger(minutes) && minutes >= 1 && minutes <= REUSABLE_DURATION_MAX_MINUTES;
  const setBusy = (value: boolean) => {
    pendingRef.current = value;
    if (mounted.current) setPending(value);
    if (mounted.current) onPendingChange?.(value);
  };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (pendingRef.current) return;
    if (event.key === 'ArrowRight' || event.key === 'End') {
      event.preventDefault(); setTab('recent'); recentTabRef.current?.focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'Home') {
      event.preventDefault(); setTab('templates'); templatesTabRef.current?.focus();
    }
  };
  const openEditor = (template?: WorkTemplate) => {
    if (pendingRef.current) return;
    listScrollTop.current = listScroll.current?.scrollTop ?? 0;
    returnTarget.current = template ? { id: template.id } : 'create';
    setEditor(template
      ? { id: template.id, original: { ...template }, title: template.title, note: template.note, durationMinutes: String(template.durationMinutes) }
      : { title: '', note: '', durationMinutes: '60' });
    setError('');
    setFeedback('');
  };
  const canClose = () => !pendingRef.current && (!editorRef.current || !changed || window.confirm(t('confirmDiscardTemplate')));
  const resetEditor = () => {
    editorRef.current = null;
    setEditor(null);
    setError('');
  };
  const closeEditor = () => {
    if (!canClose()) return;
    resetEditor();
  };
  useImperativeHandle(ref, () => ({
    canClose,
    prepareLeave: () => {
      if (!canClose()) return false;
      resetEditor();
      return true;
    },
    back: () => {
      if (pendingRef.current) return;
      if (editor) closeEditor();
      else onBack();
    },
  }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor || !valid || !changed || locked || pendingRef.current) return;
    const candidate: ReusableInput = { title: editor.title.trim(), note: editor.note.trim(), durationMinutes: minutes };
    if (editor.id) {
      const current = templates.find((item) => item.id === editor.id);
      if (!current) {
        setError(m('templateDeletedSaveNew'));
        setEditor({ ...editor, id: undefined, original: undefined });
        return;
      }
      if (editor.original && reusableKey(current) !== reusableKey(editor.original) && reusableKey(current) !== reusableKey(candidate)
        && !window.confirm(t('confirmOverwriteTemplate'))) return;
    }
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const saved = await onSaveTemplate(candidate, editor.id);
      if (saved && mounted.current) {
        setEditor(null);
        setFeedback(m('templateSaved'));
      }
    } catch (issue) {
      if (mounted.current) setError(errorText(issue, m('saveTemplateFailed')));
    } finally { setBusy(false); }
  };
  const remove = async (template: WorkTemplate) => {
    if (locked || pendingRef.current || !window.confirm(t('confirmDeleteTemplate', { title: template.title }))) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const deleted = await onDeleteTemplate(template.id);
      if (deleted && mounted.current) {
        setFeedback(m('templateDeleted'));
        focusAfterDelete.current = true;
      }
    } catch (issue) {
      if (mounted.current) setError(errorText(issue, m('deleteTemplateFailed')));
    } finally { setBusy(false); }
  };
  const choose = (entry: ReusableInput) => {
    if (pendingRef.current) return;
    onSelect({ title: entry.title, note: entry.note, durationMinutes: entry.durationMinutes });
  };
  const rows = (items: (ReusableInput & { id: string; workDate?: string })[], editable: boolean) => items.map((entry) => (
    <li className="reuse-row" key={entry.id}>
      <div className="reuse-row-main">
        <div className="reuse-row-head"><strong>{entry.title || t('withoutActivity')}</strong><span>{duration(entry.durationMinutes)}</span></div>
        {entry.workDate && <small className="reuse-work-date">{shortDate(entry.workDate)}</small>}
        {entry.note && <p title={entry.note}>{entry.note}</p>}
      </div>
      <div className="reuse-row-actions">
        <button type="button" className="button secondary" onClick={() => choose(entry)} disabled={pending} aria-label={t('applyEntry', { title: entry.title || t('entryWithoutActivity') })}>{t('apply')}</button>
        {editable && <>
          <button ref={(node) => { if (node) editRefs.current.set(entry.id, node); else editRefs.current.delete(entry.id); }} type="button" className="icon-button" onClick={() => openEditor(entry as WorkTemplate)} disabled={pending} aria-label={t('editTemplateName', { title: entry.title })} title={t('edit')}><Pencil size={15} /></button>
          <button type="button" className="icon-button reuse-danger" onClick={() => remove(entry as WorkTemplate)} disabled={locked} aria-label={t('deleteTemplateName', { title: entry.title })} title={t('delete')}><Trash2 size={15} /></button>
        </>}
      </div>
    </li>
  ));
  const notices = (pending || error || requestError || feedback) && <div className="workflow-feedback">
    {pending && <p className="muted small" role="status">{t('templatePending')}</p>}
    {error && <p className="form-error" role="alert">{renderText(error)}</p>}
    {requestError && <p className="form-error" role="alert">{requestError}</p>}
    {feedback && <p className="reuse-feedback small" role="status"><Check size={15} />{renderText(feedback)}</p>}
  </div>;
  if (!active) return null;
  return <section className={`reuse-picker${presentation === 'page' ? ' reuse-picker-page' : ''}`} aria-label={presentation === 'page' ? t('templatesRecent') : t('quickPick')}>
    {editor ? <form className="reuse-editor" onSubmit={save}>
      <div className="dialog-scroll reuse-editor-fields">
        <p className="muted small">{t('templateDescription')}</p>
        {externallyChanged && <p className="reuse-warning small" role="status">{currentTemplate
          ? t('templateChanged')
          : t('templateDeletedDraft')}</p>}
        <label className="field">{t('activity')}<input ref={editorTitleRef} data-dialog-autofocus value={editor.title} maxLength={REUSABLE_TITLE_MAX_LENGTH} onChange={(event) => setEditor({ ...editor, title: event.target.value })} required disabled={pending} /></label>
        <div className="reuse-editor-grid">
          <label className="field">{t('durationMinutes')}<input type="number" min="1" max={REUSABLE_DURATION_MAX_MINUTES} step="1" value={editor.durationMinutes} onChange={(event) => setEditor({ ...editor, durationMinutes: event.target.value })} required disabled={pending} /></label>
          <span className="reuse-editor-duration">{valid ? duration(minutes) : t('minutesRange', { max: REUSABLE_DURATION_MAX_MINUTES.toLocaleString(locale) })}</span>
        </div>
        <label className="field">{t('note')} <span className="optional">{t('optional')}</span><textarea rows={3} maxLength={REUSABLE_NOTE_MAX_LENGTH} value={editor.note} onChange={(event) => setEditor({ ...editor, note: event.target.value })} disabled={pending} /></label>
        {hasUndo && changed && <p className="reuse-warning small">{t('templateSaveDeleteUndo')}</p>}
      </div>
      {notices}
      <div className="dialog-actions workflow-actions">
        <button type="button" className="button secondary" onClick={closeEditor} disabled={pending}><ArrowLeft size={15} />{presentation === 'page' ? t('backOverview') : t('backQuickPick')}</button>
        <button type="submit" className="button primary" disabled={locked || !valid || !changed}>{pending ? t('savingTemplate') : t('saveTemplate')}</button>
      </div>
    </form> : <div className="reuse-list-view">
      <div className="dialog-scroll" ref={listScroll} onScroll={(event) => { listScrollTop.current = event.currentTarget.scrollTop; }}>
        {targetDate && <p className="reuse-target">{t('workDate')} <strong>{longDate(targetDate)}</strong></p>}
        <p className="muted small">{t('reuseInstructions')}</p>
        <div className="reuse-tabs" role="tablist" aria-label={t('chooseSource')}>
          <button ref={templatesTabRef} type="button" role="tab" id={`${tabsId}-templates`} aria-controls={`${tabsId}-panel`} aria-selected={tab === 'templates'} tabIndex={tab === 'templates' ? 0 : -1} onClick={() => setTab('templates')} onKeyDown={tabKey} disabled={pending}>{t('templates')}</button>
          <button ref={recentTabRef} type="button" role="tab" id={`${tabsId}-recent`} aria-controls={`${tabsId}-panel`} aria-selected={tab === 'recent'} tabIndex={tab === 'recent' ? 0 : -1} onClick={() => setTab('recent')} onKeyDown={tabKey} disabled={pending}>{t('recentEntries')}</button>
        </div>
        <label className="reuse-search"><Search size={15} aria-hidden="true" /><span className="visually-hidden">{t('searchActivity')}</span><input ref={searchRef} data-dialog-autofocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchActivity')} disabled={pending} /></label>
        {tab === 'templates' && <div className="reuse-create"><button ref={createRef} type="button" className="button secondary" onClick={() => openEditor()} disabled={pending}><Plus size={15} />{t('newTemplate')}</button></div>}
        <div className="reuse-scroll" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
          {tab === 'templates' ? (matchingTemplates.length > 0
            ? <ul className="reuse-list">{rows(matchingTemplates, true)}</ul>
            : <p className="reuse-empty">{query ? t('noTemplateMatch') : t('noTemplates')}</p>)
            : <>
              {matchingRecent.length > 0 ? <ul className="reuse-list">{rows(matchingRecent, false)}</ul> : <p className="reuse-empty">{query ? t('noRecentMatch') : t('noRecent')}</p>}
              {matchingLegacy.length > 0 && <><h3 className="reuse-legacy-title">{t('legacyEntries')}</h3><ul className="reuse-list">{rows(matchingLegacy, false)}</ul></>}
              {!query && recent.length === 0 && legacy.length === 0 && <p className="reuse-hint">{t('firstReuseHint')}</p>}
            </>}
        </div>
        {hasUndo && tab === 'templates' && templates.length > 0 && <p className="reuse-warning small">{t('templateUndoWarning')}</p>}
      </div>
      {notices}
      {presentation !== 'page' && <div className="dialog-actions workflow-actions"><button type="button" className="button secondary" onClick={onBack} disabled={pending}>{backLabel !== undefined && <ArrowLeft size={15} />}{backLabel ?? t('close')}</button></div>}
    </div>}
  </section>;
}
