import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import type { Activity, AppState, DataPage, DataSource, ImportAnalysis, ImportInput, ImportPackage, ImportPackagePage, ImportPreview, Source } from '../../../shared/types.js';
import { SOURCES } from '../../../shared/types.js';
import { localDate } from '../../../shared/time.js';
import { api } from '../../api';
import { downloadBlob } from '../../download';
import { formatActivityDateTime, sourceLabel } from '../../format';
import { ImportFlow } from '../ImportDialog';
import { formatPackageCounts } from './format';
import { errorText, useMessages, type TextValue } from '../../i18n';
import { dataSourceMessages } from '../../locales/data-sources';

export interface SourcesPanelHandle { canLeave: () => boolean; escape: () => boolean }
type View = { kind: 'list' } | { kind: 'create' } | { kind: 'detail'; id: string } | { kind: 'rename'; id: string; originalName: string } | { kind: 'delete'; id: string; revision: number; source: DataSource } | { kind: 'import'; id: string } | { kind: 'package'; id: string; package: ImportPackage };
type BrowseState = { query: string; page: number };
type BrowseContent =
  | { kind: 'packages'; data: DataPage<ImportPackage> | null }
  | { kind: 'activities'; data: DataPage<Activity> | null }
  | { kind: 'snapshot'; data: ImportPackagePage | null };
type BrowseResult = BrowseContent & { loading: boolean; error: TextValue };
const emptyBrowse = (): BrowseState => ({ query: '', page: 0 });
const packagePeriod = (packet: ImportPackage, timezone: string): string => {
  const first = formatActivityDateTime(packet.firstStart, timezone);
  const last = formatActivityDateTime(packet.lastEnd, timezone);
  return first === last ? first : `${first} – ${last}`;
};

interface Props {
  state: AppState;
  busy: boolean;
  active: boolean;
  enabledSources: string[];
  onClose: () => void;
  onAnalyze: (input: ImportInput) => Promise<ImportAnalysis>;
  onPreview: (input: ImportInput) => Promise<ImportPreview>;
  onCommit: (input: ImportInput, revision: number) => Promise<void>;
  onCreateSource: (type: Source, name: string) => Promise<string | null>;
  onRenameSource: (id: string, name: string, expectedRevision: number) => Promise<boolean>;
  onDeleteSource: (id: string, revision: number) => Promise<boolean>;
  onOpenPeriod: (date: string, revealSourceId?: string) => void;
}

export const SourcesPanel = forwardRef<SourcesPanelHandle, Props>(function SourcesPanel({ state, busy, active, enabledSources, onClose, onAnalyze, onPreview, onCommit, onCreateSource, onRenameSource, onDeleteSource, onOpenPeriod }, ref) {
  const { t, m, text, language, locale } = useMessages(dataSourceMessages);
  const number = (value: number) => value.toLocaleString(locale);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [name, setName] = useState('');
  const [type, setType] = useState<Source>('google_calendar');
  const [detailTab, setDetailTab] = useState<'packages' | 'activities'>('packages');
  const [browsing, setBrowsing] = useState<Record<string, BrowseState>>({});
  const [browseResult, setBrowseResult] = useState<BrowseResult>({ kind: 'packages', data: null, loading: false, error: '' });
  const [error, setError] = useState<TextValue>('');
  const [notice, setNotice] = useState<TextValue>('');
  const [pending, setPending] = useState(false);
  const [backupPending, setBackupPending] = useState(false);
  const pendingRef = useRef(false);
  const backupInFlight = useRef(false);
  const backupVersion = useRef(0);
  const mounted = useRef(true);
  const version = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const importGuard = useRef<(() => boolean) | null>(null);
  const source = 'id' in view ? state.dataSources.find(item => item.id === view.id) : undefined;
  const dirty = view.kind === 'create' ? name !== '' || type !== 'google_calendar' : view.kind === 'rename' ? name !== view.originalName : false;
  const browseKey = view.kind === 'package' ? `package:${view.package.id}` : `source:${source?.id}:${detailTab}`;
  const browse = browsing[browseKey] ?? emptyBrowse();
  const invalidateBackup = () => {
    backupVersion.current++;
    backupInFlight.current = false;
    setBackupPending(false);
  };
  const move = (next: View) => {
    version.current++;
    invalidateBackup();
    setView(next);
    setError('');
    setBrowseResult(current => ({ ...current, error: '' }));
    setNotice('');
  };
  const canLeave = () => {
    if (pendingRef.current) return false;
    if (view.kind === 'import' && importGuard.current && !importGuard.current()) return false;
    if (dirty && !window.confirm(view.kind === 'create' ? t('discardCreate') : t('discardRename'))) return false;
    if (dirty) {
      setName('');
      move(source ? { kind: 'detail', id: source.id } : { kind: 'list' });
    }
    // Leaving also invalidates a pending download before another view can reuse this panel.
    version.current++;
    invalidateBackup();
    return true;
  };
  useImperativeHandle(ref, () => ({ canLeave, escape: () => {
    if (view.kind === 'list') return false;
    back();
    return true;
  } }));
  useEffect(() => {
    mounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bumping the live versions invalidates pending requests on unmount.
    return () => { mounted.current = false; version.current++; backupVersion.current++; };
  }, []);
  const viewId = 'id' in view ? view.id : '';
  const packageId = view.kind === 'package' ? view.package.id : '';
  useEffect(() => {
    if (active) heading.current?.focus();
  }, [active, view.kind, viewId]);
  useEffect(() => {
    if (view.kind !== 'list' && view.kind !== 'create' && !source && !pending) move({ kind: 'list' });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- move is recreated every render; the effect reacts to data changes only.
  }, [state.dataSources, view, source, pending]);
  useEffect(() => {
    if (!active || !source || (view.kind !== 'detail' && view.kind !== 'package')) return;
    let cancelled = false;
    const operation = version.current;
    setBrowseResult({ kind: view.kind === 'package' ? 'snapshot' : detailTab, data: null, loading: true, error: '' });
    const accept = (result: BrowseContent) => {
      if (cancelled || operation !== version.current) return;
      setBrowseResult({ ...result, loading: true, error: '' });
    };
    const read = view.kind === 'package'
      ? api.packageActivities(packageId, browse.page, browse.query).then(data => accept({ kind: 'snapshot', data }))
      : detailTab === 'packages'
        ? api.sourcePackages(source.id, browse.page, browse.query).then(data => accept({ kind: 'packages', data }))
        : api.sourceActivities(source.id, browse.page, browse.query).then(data => accept({ kind: 'activities', data }));
    void read.catch(issue => {
      if (!cancelled && operation === version.current)
        setBrowseResult(current => ({ ...current, error: errorText(issue, m('loadFailed')) }));
    }).finally(() => { if (!cancelled && operation === version.current) setBrowseResult(current => ({ ...current, loading: false })); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- source is tracked by id, and a language switch must not reload.
  }, [active, source?.id, view.kind, packageId, detailTab, browse.page, browse.query, state.revision]);
  const back = () => {
    if (!canLeave()) return;
    move(view.kind === 'package' || view.kind === 'rename' || view.kind === 'delete' || view.kind === 'import'
      ? { kind: 'detail', id: view.id } : { kind: 'list' });
  };
  const saveName = async () => {
    if (pendingRef.current || busy || !name.trim()) return;
    if (view.kind !== 'create' && view.kind !== 'rename') return;
    if (view.kind === 'rename') {
      if (!source || name.trim() === view.originalName || name.trim() === source.name) return;
      if (source.name !== view.originalName && !window.confirm(
        t('renameConflict', { current: source.name, next: name.trim() }),
      )) return;
    }
    const expectedRevision = state.revision;
    const operation = ++version.current;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      if (view.kind === 'create') {
        const id = await onCreateSource(type, name.trim());
        if (mounted.current && operation === version.current) {
          if (id) { setName(''); move({ kind: 'detail', id }); }
          else setError(m('createFailed'));
        }
      } else if (view.kind === 'rename') {
        const success = await onRenameSource(view.id, name.trim(), expectedRevision);
        if (mounted.current && operation === version.current) {
          if (success) { setName(''); move({ kind: 'detail', id: view.id }); }
          else setError(m('renameFailed'));
        }
      }
    } catch (issue) {
      if (mounted.current && operation === version.current) setError(errorText(issue, m('saveFailed')));
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const deleteSource = async () => {
    if (view.kind !== 'delete' || pendingRef.current || backupInFlight.current || busy) return;
    if (view.revision !== state.revision) {
      move({ kind: 'detail', id: view.id });
      setError(m('deleteChanged'));
      return;
    }
    const operation = ++version.current;
    pendingRef.current = true;
    setPending(true);
    try {
      const success = await onDeleteSource(view.id, view.revision);
      if (!mounted.current || operation !== version.current) return;
      move(success ? { kind: 'list' } : { kind: 'detail', id: view.id });
      if (success) setNotice(m('deleted'));
      else setError(m('deleteRejected'));
    } catch (issue) {
      if (mounted.current && operation === version.current) {
        move({ kind: 'detail', id: view.id });
        setError(errorText(issue, m('deleteFailed')));
      }
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const downloadBackup = async () => {
    if (backupInFlight.current) return;
    const request = ++backupVersion.current;
    const operation = version.current;
    backupInFlight.current = true;
    setBackupPending(true);
    setError('');
    try {
      const blob = await api.backup();
      if (!mounted.current || operation !== version.current || request !== backupVersion.current) return;
      downloadBlob(blob, 'im-overdue-backup.sqlite');
    } catch (issue) {
      if (mounted.current && operation === version.current && request === backupVersion.current)
        setError(errorText(issue, m('backupFailed')));
    } finally {
      if (request === backupVersion.current) {
        backupInFlight.current = false;
        if (mounted.current) setBackupPending(false);
      }
    }
  };
  const changeBrowse = (patch: Partial<BrowseState>) => setBrowsing(current => ({ ...current, [browseKey]: { ...browse, ...patch } }));
  const sourceHidden = Boolean(source && !enabledSources.includes(source.id));
  const calendarAction = sourceHidden ? t('revealCalendar') : t('openCalendar');
  const hiddenSourceHint = sourceHidden
    ? <p className="sources-visibility-note" role="status">{t('hidden')}</p>
    : null;
  const openCalendar = (instant: string | null) => {
    if (instant && source && canLeave())
      onOpenPeriod(localDate(instant, state.settings.timezone), sourceHidden ? source.id : undefined);
  };
  const packages = browseResult.kind === 'packages' ? browseResult.data : null;
  const activities = browseResult.kind === 'activities' || browseResult.kind === 'snapshot' ? browseResult.data : null;
  const result = browseResult.data;
  const { loading, error: readError } = browseResult;
  const packet = view.kind === 'package' ? view.package : null;
  const searchingPackages = view.kind === 'detail' && detailTab === 'packages';
  const disabled = pending || busy;
  return <div className="sources-panel" hidden={!active}>
    {view.kind === 'import' && source ? <ImportFlow
      busy={busy}
      timezone={state.settings.timezone}
      enabledSources={enabledSources}
      dataSources={state.dataSources}
      initialDataSourceId={source.id}
      onAnalyze={onAnalyze}
      onPreview={onPreview}
      onCommit={onCommit}
      onCreateSource={onCreateSource}
      onOpenPeriod={onOpenPeriod}
      onClose={onClose}
      onBack={back}
      onGuardChange={guard => { importGuard.current = guard; }}
    /> : <>
      <div className="sources-scroll">
        <div className="sources-heading">
          <div>
            {view.kind !== 'list' && <button className="sources-back" onClick={back} disabled={disabled}><ArrowLeft size={14} /> {view.kind === 'package' || view.kind === 'rename' || view.kind === 'delete' ? t('backToSource') : t('allSources')}</button>}
            <h3 ref={heading} tabIndex={-1}>{view.kind === 'list' ? t('yourSources') : view.kind === 'create' ? t('createTitle') : view.kind === 'rename' ? t('renameTitle') : view.kind === 'delete' ? t('deleteTitle') : packet ? t('snapshotTitle') : source?.name}</h3>
            {source && <p className="muted small">{sourceLabel(source.type)}{packet ? ` · ${source.name}` : ''}</p>}
          </div>
          {view.kind === 'list' && <button className="button primary" onClick={() => { setName(''); setType('google_calendar'); move({ kind: 'create' }); }} disabled={disabled}><Plus size={15} /> {t('newSource')}</button>}
        </div>

        {view.kind === 'list' && <>
          <p className="muted small sources-intro">{t('intro')}</p>
          {state.dataSources.length ? <div className="sources-list">{state.dataSources.map(item => <button className="source-list-item" key={item.id} onClick={() => move({ kind: 'detail', id: item.id })}>
            <span className="source-list-title"><strong>{item.name}</strong><span className="muted small">{sourceLabel(item.type)}</span></span>
            <span className="source-list-meta"><span>{t('evidenceCount', { count: number(item.activityCount) })}</span><span>{t('packageCount', { count: number(item.packageCount) })}</span><small>{item.lastImportedAt ? t('lastImport', { date: formatActivityDateTime(item.lastImportedAt, state.settings.timezone) }) : t('noImport')}</small>{item.legacyCount > 0 && <small>{t('legacyCount', { count: number(item.legacyCount) })}</small>}</span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>)}</div> : <div className="sources-empty"><p>{t('empty')}</p><p className="muted small">{t('emptyHint')}</p></div>}
        </>}

        {(view.kind === 'create' || view.kind === 'rename') && <form id="source-name-form" onSubmit={event => { event.preventDefault(); void saveName(); }} className="sources-name-form">
          <label className="field">{t('name')}<input autoFocus value={name} maxLength={160} onChange={event => setName(event.target.value)} disabled={disabled} required placeholder={t('namePlaceholder')} /></label>
          {view.kind === 'create' ? <label className="field">{t('type')}<select value={type} onChange={event => setType(event.target.value as Source)} disabled={disabled}>{SOURCES.map(value => <option key={value} value={value}>{sourceLabel(value)}</option>)}</select></label> : <p className="muted small">{t('renameType', { type: source ? sourceLabel(source.type) : '' })}</p>}
          {view.kind === 'rename' && source && source.name !== view.originalName && <p className="sources-legacy small" role="status">{t('renameChanged', { name: source.name })}</p>}
        </form>}

        {view.kind === 'delete' && <div className="sources-delete-warning">
          <p><strong>{view.source.name}</strong> {t('deleteIntro')}</p>
          <ul><li>{t('deleteEvidence', { count: number(view.source.activityCount) })}</li><li>{t('deletePackages', { count: number(view.source.packageCount) })}</li></ul>
          <p>{t('deleteUndo')}</p>
          <p className="small">{t('deletePreserved')}</p>
          <button className="sources-backup-link" onClick={() => void downloadBackup()} disabled={backupPending}>{backupPending ? t('backupLoading') : t('backupFirst')}</button>
          {view.revision !== state.revision && <p role="alert">{t('deleteChangedView')}</p>}
        </div>}

        {view.kind === 'detail' && source && <>
          <div className="sources-summary"><span><strong>{number(source.activityCount)}</strong> {t('currentEvidence')}</span><span><strong>{number(source.packageCount)}</strong> {t('packages')}</span></div>
          <p className="muted small">{source.lastImportedAt ? t('lastAccepted', { date: formatActivityDateTime(source.lastImportedAt, state.settings.timezone) }) : t('noAccepted')}</p>
          {source.legacyCount > 0 && <p className="sources-legacy small">{t('legacyDescription', { count: number(source.legacyCount) })}</p>}
          {hiddenSourceHint}
          <div className="sources-tools"><button className="button primary" onClick={() => move({ kind: 'import', id: source.id })} disabled={disabled}><Upload size={15} /> {t('importHere')}</button><button className="button secondary" onClick={() => { setName(source.name); move({ kind: 'rename', id: source.id, originalName: source.name }); }} disabled={disabled}><Pencil size={14} /> {t('rename')}</button><button className="button secondary" onClick={() => openCalendar(source.firstActivityStart)} disabled={!source.firstActivityStart || disabled}><CalendarDays size={15} /> {calendarAction}</button></div>
          <div className="sources-tabs" role="tablist" aria-label={t('content')}><button role="tab" aria-selected={detailTab === 'packages'} onClick={() => setDetailTab('packages')}>{t('packages')}</button><button role="tab" aria-selected={detailTab === 'activities'} onClick={() => setDetailTab('activities')}>{t('currentEvidenceTab')}</button></div>
        </>}

        {packet && <div className="source-package-info"><strong>{packet.fileName || t('pasted')}</strong><p className="muted small">{t('acceptedAt', { date: formatActivityDateTime(packet.createdAt, state.settings.timezone) })}</p><p className="source-package-period small">{t('period', { period: packagePeriod(packet, state.settings.timezone) })}</p><p className="small">{formatPackageCounts(packet.counts, language)}</p><p className="muted small">{t('snapshotDescription')}</p>{hiddenSourceHint}<button className="button secondary" onClick={() => openCalendar(packet.firstStart)}><CalendarDays size={15} /> {calendarAction}</button></div>}

        {(view.kind === 'detail' || view.kind === 'package') && <>
          <label className="field sources-search">{searchingPackages ? t('searchFile') : t('searchTitle')}<input type="search" value={browse.query} maxLength={500} onChange={event => changeBrowse({ query: event.target.value, page: 0 })} placeholder={searchingPackages ? t('filePlaceholder') : t('titlePlaceholder')} /></label>
          {loading && <p className="muted small" role="status">{t('loading')}</p>}
          {!loading && packages && <div className="sources-list">{packages.items.map(item => <button className="source-list-item source-package-row" key={item.id} onClick={() => move({ kind: 'package', id: source!.id, package: item })}><span><strong>{item.fileName || t('pasted')}</strong><small>{formatActivityDateTime(item.createdAt, state.settings.timezone)}</small><small className="source-package-period">{t('period', { period: packagePeriod(item, state.settings.timezone) })}</small><small>{formatPackageCounts(item.counts, language)}</small></span><ArrowRight size={16} aria-hidden="true" /></button>)}</div>}
          {!loading && activities && <div className="source-activities">{activities.items.map(item => <article key={`${item.dataSourceId}:${item.id}`}><strong>{item.title}</strong><span>{formatActivityDateTime(item.start, state.settings.timezone)}{item.end ? ` – ${formatActivityDateTime(item.end, state.settings.timezone)}` : ''}</span>{item.url && <a href={item.url} target="_blank" rel="noreferrer">{t('openOriginal')}</a>}</article>)}</div>}
          {!loading && result?.total === 0 && <p className="sources-empty muted small">{browse.query ? searchingPackages ? t('noMatchingFile') : t('noMatchingTitle') : searchingPackages ? t('noPackages') : t('noEvidence')}</p>}
          {result && result.total > 0 && <div className="sources-pagination"><span>{t('range', { first: number(result.page * result.pageSize + 1), last: number(Math.min((result.page + 1) * result.pageSize, result.total)), count: number(result.total) })}</span><div><button className="button secondary" aria-label={t('previousPage')} disabled={loading || browse.page <= 0} onClick={() => changeBrowse({ page: browse.page - 1 })}><ArrowLeft size={14} /></button><button className="button secondary" aria-label={t('nextPage')} disabled={loading || (browse.page + 1) * result.pageSize >= result.total} onClick={() => changeBrowse({ page: browse.page + 1 })}><ArrowRight size={14} /></button></div></div>}
        </>}
        {notice && <p className="muted small" role="status">{text(notice)}</p>}
        {readError && <p className="form-error" role="alert">{text(readError)}</p>}
        {error && <p className="form-error" role="alert">{text(error)}</p>}
      </div>
      <div className="sources-footer dialog-actions">
        {view.kind === 'detail' && source && <button className="button secondary source-delete-action" onClick={() => move({ kind: 'delete', id: source.id, revision: state.revision, source: { ...source } })} disabled={disabled}><Trash2 size={14} /> {t('deleteSource')}</button>}
        {view.kind === 'create' || view.kind === 'rename' ? <><button className="button secondary" onClick={back} disabled={disabled}>{t('cancel')}</button><button className="button primary" type="submit" form="source-name-form" disabled={disabled || !name.trim() || (view.kind === 'rename' && (name.trim() === view.originalName || name.trim() === source?.name))}>{pending ? t('saving') : view.kind === 'create' ? t('createTitle') : t('saveName')}</button></> : view.kind === 'delete' ? <><button className="button secondary" onClick={back} disabled={disabled}>{t('cancel')}</button><button className="button source-confirm-delete" onClick={() => void deleteSource()} disabled={disabled || backupPending || view.revision !== state.revision}>{pending ? t('deleting') : t('deleteConfirm')}</button></> : <button className="button secondary" onClick={onClose} disabled={pending}>{t('close')}</button>}
      </div>
    </>}
  </div>;
});
