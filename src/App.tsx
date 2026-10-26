import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { CalendarWorkspace } from './components/CalendarWorkspace';
import { api } from './api';
import { BlockDialog } from './components/BlockDialog';
import { ImportDialog } from './components/ImportDialog';
import { NoteDialog } from './components/NoteDialog';
import { QuickCreateMenu } from './components/QuickCreateMenu';
import { ReportsPage } from './components/ReportsPage';
import { TemplatesPage } from './components/TemplatesPage';
import { ReuseDialog } from './components/ReuseDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { TimesheetDialog, type TimesheetPreset } from './components/TimesheetDialog';
import { VacationDialog } from './components/VacationDialog';
import { WeekCloseDialog } from './components/WeekCloseDialog';
import { useAppRequests } from './hooks/useAppRequests';
import { useCalendarFocus } from './hooks/useCalendarFocus';
import { useWorkspaceNavigation, type WorkspacePage } from './hooks/useWorkspaceNavigation';
import { useUndoShortcut } from './hooks/useUndoShortcut';
import type { QuickCreateAnchor, QuickCreateDraft } from './quick-create';
import { weekLabel } from './format';
import { useMessages } from './i18n';
import { shellMessages, undoIsVacation } from './locales/shell';
import { noteText } from '../shared/notes.js';
import { activityDataSourceId } from '../shared/data-sources.js';
import { Temporal, addDays, localDate, today, weekStartFor } from '../shared/time.js';
import {
  type Activity,
  type BlockInput,
  type NoteScope,
  type ReusableInput,
  type Source,
  type WorkBlock,
  type VacationAllowance,
  type VacationChange,
} from '../shared/types.js';

type Dialog = { kind: 'import' | 'settings' | 'timesheet'; id: number; preset?: TimesheetPreset } | null;
type VacationEditor = { id: number; date: string } | null;
type WeekCloseEditor = { id: number; week: string } | null;
type BlockEditor = { id: number; date: string; block?: WorkBlock; initialInput?: BlockInput; initialReuse?: ReusableInput; initialZone?: string } | null;
type NoteEditor = { id: number; scope: NoteScope; date: string; initialText: string } | null;

function sameBlockValues(a: WorkBlock, b: Pick<WorkBlock, 'start' | 'end' | 'title' | 'note'>): boolean {
  return Temporal.Instant.compare(a.start, b.start) === 0 && Temporal.Instant.compare(a.end, b.end) === 0
    && a.title === b.title && a.note === b.note;
}

export default function App() {
  const { t, m, text: displayText } = useMessages(shellMessages);
  const [anchorDate, setAnchorDate] = useState(() => today('Europe/Berlin'));
  const [view, setView] = useState<'week' | 'month'>('week');
  const [weekFocusDate, setWeekFocusDate] = useState<string>();
  const [reviewDate, setReviewDate] = useState<string>();
  const [activityFocus, setActivityFocus] = useState<{
    dataSourceId: string;
    date: string;
    source: Source;
    id: string;
    requestId: number;
  }>();
  const [gestureActive, setGestureActive] = useState(false);
  const week = weekStartFor(anchorDate);
  const [sources, setSources] = useState<string[]>([]);
  const knownSources = useRef<Set<string> | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [blockEditor, setBlockEditor] = useState<BlockEditor>(null);
  const [noteEditor, setNoteEditor] = useState<NoteEditor>(null);
  const [vacationEditor, setVacationEditor] = useState<VacationEditor>(null);
  const [weekCloseEditor, setWeekCloseEditor] = useState<WeekCloseEditor>(null);
  const [reuseDialog, setReuseDialog] = useState<{ id: number; date: string } | null>(null);
  const [quickCreate, setQuickCreate] = useState<QuickCreateDraft | null>(null);
  const quickCreateRef = useRef<QuickCreateDraft | null>(null);
  const savedQuickFocus = useRef<{ draft: QuickCreateDraft; blockId?: string; week: string; origin: Element | null } | null>(null);
  const replaceQuickCreate = useCallback((next: QuickCreateDraft | null) => {
    quickCreateRef.current = next;
    setQuickCreate(next);
  }, []);
  const nextSessionId = useRef(0);
  const nextFocusId = useRef(0);
  const gestureInFlight = useRef(false);
  const reviewToggle = useRef<HTMLButtonElement>(null);
  const vacationToggle = useRef<HTMLButtonElement>(null);
  const reportsToggle = useRef<HTMLAnchorElement>(null);
  const initializeTimezone = useCallback((timezone: string) => {
    const initialDay = today(timezone);
    setAnchorDate(initialDay);
    setAccountSeed(current => ({ ...current, date: initialDay }));
  }, []);
  const { state, loading, busy, failure, message, clearFailure, retryLoad, applyMutation, importCommit, handlePreview, handleAnalyze, isRequestInFlight, getCurrentState } = useAppRequests(initializeTimezone);
  const sourceIds = state?.dataSources.map(source => source.id).join('|');
  useEffect(() => {
    if (!state) return;
    const ids = state.dataSources.map(source => source.id);
    const known = knownSources.current;
    setSources(current => ids.filter(id => !known || !known.has(id) || current.includes(id)));
    knownSources.current = new Set(ids);
  }, [sourceIds]);
  const error = displayText(failure?.message);
  const { focused, mainRef, focusToggle, enterFocus, leaveFocus, invalidateFocusOrigin } = useCalendarFocus({
    week,
    dialogOpen: Boolean(dialog || blockEditor || noteEditor || reuseDialog || quickCreate || vacationEditor || weekCloseEditor),
    gestureInFlight,
    reviewOpen: Boolean(reviewDate),
    messageVisible: Boolean(message),
    failureVisible: Boolean(failure),
    weekNoteVisible: Boolean(state && noteText(state.notes, 'week', week)),
  });
  const leaveGuards = useRef<Partial<Record<WorkspacePage, (() => boolean) | null>>>({});
  const activePage = useRef<WorkspacePage>('calendar');
  const internalNavigation = useRef(false);
  const canLeavePage = () => !gestureInFlight.current && (leaveGuards.current[activePage.current]?.() ?? true);
  const { page, navigatePage } = useWorkspaceNavigation(
    () => (internalNavigation.current || !(dialog || blockEditor || noteEditor || vacationEditor || reuseDialog || weekCloseEditor)) && canLeavePage(),
    () => { replaceQuickCreate(null); leaveFocus(); },
  );
  activePage.current = page;
  const [accountSeed, setAccountSeed] = useState({ id: 0, date: anchorDate });
  const [accountVisited, setAccountVisited] = useState(false);
  const [pageSessions] = useState(() => ({ reports: ++nextSessionId.current, templates: ++nextSessionId.current }));
  const registerReportsGuard = useCallback((guard: (() => boolean) | null) => { leaveGuards.current.reports = guard; }, []);
  const registerTemplatesGuard = useCallback((guard: (() => boolean) | null) => { leaveGuards.current.templates = guard; }, []);
  const accountAnchor = accountVisited ? accountSeed.date : anchorDate;
  useEffect(() => {
    if (page !== 'reports' || accountVisited) return;
    setAccountSeed(current => ({ ...current, date: anchorDate }));
    setAccountVisited(true);
  }, [page, accountVisited, anchorDate]);
  useEffect(() => {
    const current = document.activeElement;
    if (current !== document.body && !(current instanceof HTMLElement && current.closest('[hidden]'))) return;
    const selector = page === 'calendar' ? '.calendar-workspace h1' : page === 'reports' ? '.reports-page h1' : '.templates-page h1';
    const heading = mainRef.current?.querySelector<HTMLElement>(selector);
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [page]);
  const goToPage = (next: WorkspacePage) => {
    if (navigatePage(next) && next === 'reports' && !accountVisited) setAccountSeed(current => ({ id: current.id, date: anchorDate }));
  };
  const openReportsMonth = () => {
    if (navigatePage('reports')) {
      setAccountSeed(current => ({ id: current.id + 1, date: anchorDate }));
      setAccountVisited(true);
    }
  };
  const openDialog = (kind: NonNullable<Dialog>['kind']) => {
    if (!canLeavePage()) return;
    replaceQuickCreate(null);
    setDialog({ kind, id: ++nextSessionId.current });
  };
  const openTimesheet = (preset?: TimesheetPreset) => {
    if (!canLeavePage()) return;
    replaceQuickCreate(null);
    setDialog({ kind: 'timesheet', id: ++nextSessionId.current, preset });
  };
  const openEditor = (date: string, block?: WorkBlock) => {
    replaceQuickCreate(null);
    setBlockEditor({ id: ++nextSessionId.current, date, block });
  };
  const openVacation = (date: string) => {
    replaceQuickCreate(null);
    if (dialog) {
      (vacationToggle.current ?? reportsToggle.current)?.focus({ preventScroll: true });
      setDialog(null);
    }
    setVacationEditor({ id: ++nextSessionId.current, date });
  };
  const openNote = (scope: NoteScope, date: string) => {
    if (!state || noteEditor) return;
    replaceQuickCreate(null);
    setNoteEditor({
      id: ++nextSessionId.current,
      scope,
      date,
      initialText: noteText(state.notes, scope, date),
    });
  };
  useEffect(() => {
    if (view !== 'week' || dialog || blockEditor || noteEditor || reuseDialog || vacationEditor || weekCloseEditor) replaceQuickCreate(null);
  }, [view, dialog, blockEditor, noteEditor, reuseDialog, vacationEditor, weekCloseEditor, replaceQuickCreate]);

  const closed = state?.weeks.some((w) => w.weekStart === week && w.status === 'closed') ?? false;
  const currentDay = today(state?.settings.timezone ?? 'Europe/Berlin');
  const currentWeek = weekStartFor(currentDay);
  const entryDate =
    [reviewDate, weekFocusDate].find((date) => date && weekStartFor(date) === week) ??
    (currentWeek === week ? currentDay : week);

  const undoLastChange = async () => {
    if (page !== 'calendar' || !state?.undo || dialog || blockEditor || noteEditor || reuseDialog || vacationEditor || weekCloseEditor || quickCreateRef.current || gestureInFlight.current) return;
    const token = state.undo.token;
    await applyMutation(
      (revision) => api.undoBlock(token, revision),
      (result) => {
        const restored = result.weeks.filter(
          (w) =>
            w.status === 'closed' &&
            !state.weeks.some((old) => old.weekStart === w.weekStart && old.status === 'closed'),
        );
        const templatesRemoved = state.templates.filter((template) => !result.templates.some((item) => item.id === template.id)).length;
        return {
          catalog: { value: {
            en: `${shellMessages[undoIsVacation(state.undo?.label ?? '') ? 'undoVacation' : 'undoTime'].en}${templatesRemoved ? shellMessages.undoTemplate.en : ''}${restored.length ? shellMessages.undoWeeks.en.replace('{weeks}', restored.map(w => weekLabel(w.weekStart, 'en')).join('; ')) : ''}`,
            de: `${shellMessages[undoIsVacation(state.undo?.label ?? '') ? 'undoVacation' : 'undoTime'].de}${templatesRemoved ? shellMessages.undoTemplate.de : ''}${restored.length ? shellMessages.undoWeeks.de.replace('{weeks}', restored.map(w => weekLabel(w.weekStart, 'de')).join('; ')) : ''}`,
          } }, key: 'value',
        };
      },
    );
  };
  useUndoShortcut(
    () => page === 'calendar' && Boolean(state?.undo) && !busy && !isRequestInFlight() &&
      !dialog && !blockEditor && !noteEditor && !vacationEditor && !weekCloseEditor &&
      !reuseDialog && !quickCreateRef.current && !gestureInFlight.current,
    undoLastChange,
  );
  const onGestureChange = useCallback((active: boolean) => {
    if (active) replaceQuickCreate(null);
    gestureInFlight.current = active;
    setGestureActive(active);
  }, [replaceQuickCreate]);

  const createBlock = (input: BlockInput, anchor: QuickCreateAnchor) => {
    if (!state) return;
    replaceQuickCreate({ id: ++nextSessionId.current, input, zone: state.settings.timezone, anchor });
  };
  const closeQuickCreate = (draft: QuickCreateDraft, restoreFocus: boolean) => {
    if (savedQuickFocus.current?.draft === draft) savedQuickFocus.current = null;
    if (quickCreateRef.current !== draft) return;
    replaceQuickCreate(null);
    if (restoreFocus && draft.anchor.lane.isConnected) draft.anchor.lane.focus({ preventScroll: true });
  };
  const quickDetails = (draft: QuickCreateDraft, input: BlockInput) => {
    if (quickCreateRef.current !== draft) return;
    closeQuickCreate(draft, true);
    setBlockEditor({
      id: ++nextSessionId.current,
      date: localDate(input.start, draft.zone),
      initialInput: input,
      initialZone: draft.zone,
    });
  };
  useLayoutEffect(() => {
    const pending = savedQuickFocus.current;
    if (!pending || quickCreate === pending.draft) return;
    savedQuickFocus.current = null;
    if (activePage.current !== 'calendar' || view !== 'week' || pending.week !== week ||
      quickCreateRef.current || gestureInFlight.current || document.querySelector('[role="dialog"], dialog[open]')) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== pending.origin) return;
    const block = pending.blockId ? mainRef.current?.querySelector<HTMLElement>(`[data-work-block="${pending.blockId}"]`) : null;
    const lane = pending.draft.anchor.lane;
    if (block) block.focus({ preventScroll: true });
    else if (lane.isConnected && lane.dataset.date === pending.draft.anchor.date) lane.focus({ preventScroll: true });
  });
  const saveQuickCreate = async (draft: QuickCreateDraft, input: BlockInput): Promise<boolean> => {
    if (!state || quickCreateRef.current !== draft) return false;
    const existingIds = new Set(state.blocks.map((block) => block.id));
    let savedId: string | undefined;
    const ok = await applyMutation(
      async (revision, confirm) => {
        const result = await api.createBlock(input, revision, confirm);
        savedId = result.blocks.find((block) => !existingIds.has(block.id) && block.start === input.start)?.id;
        return result;
      },
      m('timeSaved'),
      draft.id,
    );
    if (ok && quickCreateRef.current === draft) {
      // Focus only after React commits both the saved block and the menu removal.
      savedQuickFocus.current = { draft, blockId: savedId, week, origin: document.activeElement };
      replaceQuickCreate(null);
    }
    return ok;
  };
  const updateBlock = async (id: string, input: BlockInput) => {
    await applyMutation(
      (revision, confirm) => api.updateBlock(id, input, revision, confirm),
      m('timeUpdated'),
    );
  };
  const saveEditor = async (editor: NonNullable<BlockEditor>, input: BlockInput): Promise<boolean> => {
    const snapshot = getCurrentState();
    if (!snapshot || isRequestInFlight()) return false;
    if (editor.block) {
      const current = snapshot.blocks.find(block => block.id === editor.block!.id);
      if (current && !sameBlockValues(current, editor.block)
        && !sameBlockValues(current, { ...input, title: input.title ?? current.title })
        && !window.confirm(t('overwriteChangedBlock'))) return false;
    }
    const ok = editor.block
      ? await applyMutation(
          (revision, confirm) => api.updateBlock(editor.block!.id, input, revision, confirm),
          input.rememberTemplate ? m('timeUpdatedTemplate') : m('timeUpdated'),
          editor.id,
          snapshot.revision,
        )
      : await applyMutation(
          (revision, confirm) => api.createBlock(input, revision, confirm),
          input.rememberTemplate ? m('timeSavedTemplate') : m('timeSaved'),
          editor.id,
        );
    if (ok) setBlockEditor((current) => (current === editor ? null : current));
    return ok;
  };
  const deleteEditor = async (editor: NonNullable<BlockEditor>): Promise<boolean> => {
    if (
      !editor.block ||
      !window.confirm(
        t('deleteBlockConfirm'),
      )
    )
      return false;
    const ok = await applyMutation(
      (revision, confirm) => api.deleteBlock(editor.block!.id, revision, confirm),
      m('timeDeleted'),
      editor.id,
    );
    if (ok) setBlockEditor((current) => (current === editor ? null : current));
    return ok;
  };
  const setWeekStatus = async () => {
    if (!closed) {
      replaceQuickCreate(null);
      setWeekCloseEditor({ id: ++nextSessionId.current, week });
      return;
    }
    await applyMutation(
      (revision, confirm) => api.setWeek(week, closed ? 'open' : 'closed', revision, confirm),
      closed ? m('weekReopened') : m('weekClosed'),
    );
  };
  const confirmWeekClose = async (editor: NonNullable<WeekCloseEditor>, expectedRevision: number, reviewKey: string) => {
    const ok = await applyMutation(
      () => api.setWeek(editor.week, 'closed', expectedRevision, true, true, reviewKey),
      m('weekClosed'),
      editor.id,
    );
    if (ok) setWeekCloseEditor((current) => current === editor ? null : current);
    return ok;
  };
  const saveVacationEditor = async (editor: NonNullable<VacationEditor>, days: VacationChange[]) => {
    const ok = await applyMutation(
      (revision, confirmed) => api.saveVacations(days, revision, confirmed),
      m('vacationSaved'),
      editor.id,
    );
    if (ok) setVacationEditor((current) => current === editor ? null : current);
    return ok;
  };
  const saveVacationAllowance = (sessionId: number, input: VacationAllowance) => applyMutation(
    (revision) => api.saveVacationAllowance(input, revision),
    m('allowanceSaved'),
    sessionId,
  );
  const saveTemplate = (sessionId: number, input: ReusableInput, id?: string) =>
    applyMutation((revision) => api.saveTemplate(input, revision, id), m('templateSaved'), sessionId);
  const deleteTemplate = (sessionId: number, id: string) =>
    applyMutation((revision) => api.deleteTemplate(id, revision), m('templateDeleted'), sessionId);
  const createDataSource = async (sessionId: number, type: Source, name: string): Promise<string | null> => {
    if (!state) return null;
    const priorIds = new Set(state.dataSources.map(source => source.id));
    let createdId: string | null = null;
    let issue: unknown;
    const ok = await applyMutation(async revision => {
      try {
        const next = await api.createDataSource(type, name, revision);
        createdId = next.dataSources.find(source => !priorIds.has(source.id))?.id ?? null;
        return next;
      } catch (error) { issue = error; throw error; }
    }, m('sourceCreated'), sessionId);
    if (!ok && issue) throw issue;
    return ok ? createdId : null;
  };
  const renameDataSource = (sessionId: number, id: string, name: string, expectedRevision: number) =>
    applyMutation(() => api.renameDataSource(id, name, expectedRevision), m('sourceRenamed'), sessionId);
  const deleteDataSource = (sessionId: number, id: string, expectedRevision: number) =>
    applyMutation(() => api.deleteDataSource(id, expectedRevision), m('sourceDeleted'), sessionId);
  const saveNoteEditor = async (editor: NonNullable<NoteEditor>, text: string): Promise<boolean> => {
    if (!state || busy || isRequestInFlight()) return false;
    const currentText = noteText(state.notes, editor.scope, editor.date);
    if (
      currentText !== editor.initialText &&
      currentText !== text &&
      !window.confirm(
        t('noteOverwrite'),
      )
    )
      return false;
    const ok = await applyMutation(
      (revision) => api.saveNote(editor.scope, editor.date, text, revision),
      m(editor.scope === 'day' ? text.trim() ? 'dayNoteSaved' : 'dayNoteRemoved' : text.trim() ? 'weekNoteSaved' : 'weekNoteRemoved'),
      editor.id,
    );
    if (ok) setNoteEditor((current) => (current === editor ? null : current));
    return ok;
  };
  const toggleSource = (source: string) =>
    setSources((selected) =>
      selected.includes(source) ? selected.filter((s) => s !== source) : [...selected, source],
    );
  const navigate = (date: string, selectDay = false) => {
    replaceQuickCreate(null);
    invalidateFocusOrigin();
    const nextWeek = weekStartFor(date);
    const nextDay = selectDay ? date : nextWeek === currentWeek ? currentDay : nextWeek;
    setAnchorDate(date);
    setWeekFocusDate(selectDay ? date : undefined);
    setActivityFocus(undefined);
    setReviewDate((current) => (current ? nextDay : undefined));
  };
  const movePeriod = (step: number) =>
    navigate(
      view === 'week'
        ? addDays(anchorDate, step * 7)
        : Temporal.PlainDate.from(anchorDate).with({ day: 1 }).add({ months: step }).toString(),
    );
  const openDay = (date: string) => {
    internalNavigation.current = true;
    try { if (!navigatePage('calendar')) return; } finally { internalNavigation.current = false; }
    replaceQuickCreate(null);
    invalidateFocusOrigin();
    setAnchorDate(date);
    setWeekFocusDate(date);
    setActivityFocus(undefined);
    setView('week');
    setReviewDate((current) => (current ? date : undefined));
  };
  const openReview = (date: string) => {
    openDay(date);
    setReviewDate(date);
  };
  const closeReview = () => {
    setReviewDate(undefined);
    setActivityFocus(undefined);
    reviewToggle.current?.focus();
  };
  const showActivity = (activity: Activity) => {
    if (!reviewDate) return;
    setWeekFocusDate(reviewDate);
    setActivityFocus({
      dataSourceId: activityDataSourceId(activity),
      date: reviewDate,
      source: activity.source,
      id: activity.id,
      requestId: ++nextFocusId.current,
    });
  };

return (
    <div className={`app-shell${focused ? ' calendar-focused' : ''}`}>
      <AppHeader page={page} onNavigate={goToPage} onOpenDialog={openDialog} reportsRef={reportsToggle} />
      <main className="site-inner" ref={mainRef}>
        {error && <div className="app-alert" role="alert"><span>{error}</span><button onClick={clearFailure} aria-label={t('hideError')}>×</button></div>}
        {message && dialog?.kind !== 'settings' && <div className="app-toast" role="status">{displayText(message)}</div>}
        {loading ? <div className="loading-state" role="status"><span className="spinner" />{t('loading')}</div> : !state ? <div className="loading-state"><span>{t('localLoadFailed')}</span><button className="button secondary" onClick={() => void retryLoad()}>{t('retry')}</button></div> : <>
          <CalendarWorkspace
            anchorDate={anchorDate} view={view} currentDay={currentDay}
            entryDate={entryDate} reviewDate={reviewDate} closed={closed} focused={focused}
            gestureActive={gestureActive} reviewToggle={reviewToggle} vacationToggle={vacationToggle} focusToggle={focusToggle}
            calendar={{
              active: page === 'calendar', state, weekStart: week, focusDate: weekFocusDate,
              preserveFocus: Boolean(reviewDate), activityFocus, enabledSources: sources,
              onReviewDay: openReview, onNote: date => openNote('day', date), onVacation: openVacation,
              onGestureChange, onCreate: createBlock, quickDraft: quickCreate, onUpdate: updateBlock,
              onEdit: block => openEditor(week, block), onNew: date => openEditor(date), busy,
            }}
            actions={{
              navigate, movePeriod, setView: next => { if (next === 'month') { replaceQuickCreate(null); leaveFocus(); } setView(next); },
              openReuse: () => { replaceQuickCreate(null); setReuseDialog({ id: ++nextSessionId.current, date: entryDate }); },
              toggleFocus: () => focused ? leaveFocus() : enterFocus(), openReportsMonth, undoLastChange,
              toggleSource, openNote, openTimesheet, setWeekStatus, closeReview, showActivity, openDay,
            }}
          />
          {(page === 'reports' || accountVisited) && <div hidden={page !== 'reports'} className="workspace-page-panel"><ReportsPage key={`${accountSeed.id}:${accountAnchor}`} state={state} anchor={accountAnchor} busy={busy} requestError={failure?.sessionId === pageSessions.reports ? error : ''} onSaveAllowance={input => saveVacationAllowance(pageSessions.reports, input)} onOpenVacation={openVacation} onTimesheet={openTimesheet} onNavigateWeek={openDay} onLeaveGuardChange={registerReportsGuard} /></div>}
          <div hidden={page !== 'templates'} className="workspace-page-panel"><TemplatesPage active={page === 'templates'} state={state} date={entryDate} busy={busy} requestError={failure?.sessionId === pageSessions.templates ? error : ''} onSelect={input => setBlockEditor({ id: ++nextSessionId.current, date: entryDate, initialReuse: input })} onSaveTemplate={(input,id) => saveTemplate(pageSessions.templates,input,id)} onDeleteTemplate={id => deleteTemplate(pageSessions.templates,id)} onBack={() => goToPage('calendar')} onLeaveGuardChange={registerTemplatesGuard} /></div>
        </>}
      </main>
      {state && quickCreate && (
        <QuickCreateMenu
          key={quickCreate.id}
          draft={quickCreate}
          state={state}
          busy={busy}
          requestError={failure?.sessionId === quickCreate.id ? error : ''}
          onSave={(input) => saveQuickCreate(quickCreate, input)}
          onDetails={(input) => quickDetails(quickCreate, input)}
          onClose={(restoreFocus) => closeQuickCreate(quickCreate, restoreFocus)}
        />
      )}
      {state && dialog?.kind === 'import' && (
        <ImportDialog
          key={dialog.id}
          busy={busy}
          timezone={state.settings.timezone}
          enabledSources={sources}
          dataSources={state.dataSources}
          onAnalyze={handleAnalyze}
          onCreateSource={(type, name) => createDataSource(dialog.id, type, name)}
          onClose={() => setDialog((current) => (current === dialog ? null : current))}
          onPreview={handlePreview}
          onCommit={importCommit}
          onOpenPeriod={(date) => {
            openDay(date);
            setDialog((current) => (current === dialog ? null : current));
          }}
        />
      )}
      {state && dialog?.kind === 'settings' && (
        <SettingsDialog
          key={dialog.id}
          state={state}
          busy={busy}
          requestError={failure?.sessionId === dialog.id ? error : ''}
          enabledSources={sources}
          onAnalyze={handleAnalyze}
          onPreview={handlePreview}
          onCommit={importCommit}
          onCreateSource={(type, name) => createDataSource(dialog.id, type, name)}
          onRenameSource={(id, name, revision) => renameDataSource(dialog.id, id, name, revision)}
          onDeleteSource={(id, revision) => deleteDataSource(dialog.id, id, revision)}
          onOpenPeriod={(date, revealSourceId) => {
            if (revealSourceId && state.dataSources.some(source => source.id === revealSourceId))
              setSources(current => current.includes(revealSourceId) ? current : [...current, revealSourceId]);
            openDay(date);
            setDialog(current => current === dialog ? null : current);
          }}
          onClose={() => setDialog((current) => (current === dialog ? null : current))}
          onTimezone={(zone) =>
            applyMutation(
              (revision, confirm) => api.settings(zone, revision, confirm),
              m('zoneSaved'),
              dialog.id,
            )
          }
          onProfile={(from, minutes, days) =>
            applyMutation(
              (revision, confirm) => api.profile(from, minutes, days, revision, confirm),
              m('profileSaved'),
              dialog.id,
            )
          }
        />
      )}
      {dialog?.kind === 'timesheet' && (
        <TimesheetDialog key={dialog.id} anchor={anchorDate} preset={dialog.preset} onLoad={api.timesheet} onClose={() => setDialog((current) => current === dialog ? null : current)} />
      )}
      {state && vacationEditor && (
        <VacationDialog
          key={vacationEditor.id}
          state={state}
          date={vacationEditor.date}
          busy={busy}
          requestError={failure?.sessionId === vacationEditor.id ? error : ''}
          onSave={(days) => saveVacationEditor(vacationEditor, days)}
          onClose={() => setVacationEditor((current) => current === vacationEditor ? null : current)}
        />
      )}
      {state && weekCloseEditor && (
        <WeekCloseDialog
          key={weekCloseEditor.id}
          weekStart={weekCloseEditor.week}
          revision={state.revision}
          onLoad={api.weekReview}
          busy={busy}
          requestError={failure?.sessionId === weekCloseEditor.id ? error : ''}
          onConfirm={(revision, reviewKey) => confirmWeekClose(weekCloseEditor, revision, reviewKey)}
          onReviewDay={(date) => { setWeekCloseEditor(null); openReview(date); }}
          onClose={() => setWeekCloseEditor((current) => current === weekCloseEditor ? null : current)}
        />
      )}
      {state && blockEditor && (
        <BlockDialog
          key={blockEditor.id}
          date={blockEditor.date}
          block={blockEditor.block}
          initialInput={blockEditor.initialInput}
          initialZone={blockEditor.initialZone}
          initialReuse={blockEditor.initialReuse}
          templates={state.templates}
          recentEntries={state.recentEntries}
          blocks={state.blocks}
          hasUndo={Boolean(state.undo)}
          zone={state.settings.timezone}
          busy={busy}
          requestError={failure?.sessionId === blockEditor.id ? error : ''}
          onClose={() => setBlockEditor((current) => (current === blockEditor ? null : current))}
          onSave={(input) => saveEditor(blockEditor, input)}
          onDelete={() => deleteEditor(blockEditor)}
          onSaveTemplate={(input, id) => saveTemplate(blockEditor.id, input, id)}
          onDeleteTemplate={(id) => deleteTemplate(blockEditor.id, id)}
        />
      )}
      {state && reuseDialog && (
        <ReuseDialog
          key={reuseDialog.id}
          state={state}
          date={reuseDialog.date}
          busy={busy}
          requestError={failure?.sessionId === reuseDialog.id ? error : ''}
          onClose={() => setReuseDialog((current) => current === reuseDialog ? null : current)}
          onSelect={(input) => {
            setReuseDialog((current) => current === reuseDialog ? null : current);
            setBlockEditor({ id: ++nextSessionId.current, date: reuseDialog.date, initialReuse: input });
          }}
          onSaveTemplate={(input, id) => saveTemplate(reuseDialog.id, input, id)}
          onDeleteTemplate={(id) => deleteTemplate(reuseDialog.id, id)}
        />
      )}
      {state && noteEditor && (
        <NoteDialog
          key={noteEditor.id}
          scope={noteEditor.scope}
          date={noteEditor.date}
          initialText={noteEditor.initialText}
          hasUndo={Boolean(state.undo)}
          busy={busy}
          requestError={failure?.sessionId === noteEditor.id ? error : ''}
          onSave={(text) => saveNoteEditor(noteEditor, text)}
          onClose={() => setNoteEditor((current) => (current === noteEditor ? null : current))}
        />
      )}
    </div>
  );
}
