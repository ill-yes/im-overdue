import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { DataSource, ImportAnalysis, ImportInput, ImportPreview, Source } from '../../../shared/types.js';
import { IMPORT_MAX_BYTES } from '../../../shared/import-contract.js';
import { activityIsVisible } from '../../../shared/data-sources.js';
import { sourceLabel } from '../../format';
import { periodOf, sourceCountsOf } from './preview-model';
import { assignmentsComplete, canSkipAssignments, initialAssignments, type Assignments } from './assignments';
import type { ImportFlowProps, Step } from './types';
import { errorText, localized, text as renderText, useMessages, type TextValue } from '../../i18n';
import { importMessages } from '../../locales/import';

export function useImportFlow({
  busy,
  timezone,
  enabledSources,
  dataSources,
  initialDataSourceId,
  onClose,
  onBack,
  onGuardChange,
  onAnalyze,
  onCreateSource,
  onPreview,
  onCommit,
  onOpenPeriod,
}: ImportFlowProps) {
  const { m } = useMessages(importMessages);
  const [step, setStep] = useState<Step>('input');
  const [inputMode, setInputMode] = useState<'file' | 'paste'>('file');
  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [pasteFormat, setPasteFormat] = useState<'json' | 'csv'>('json');
  const [pasteText, setPasteText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [assignments, setAssignments] = useState<Assignments>({});
  const [creatingType, setCreatingType] = useState<Source | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdSources, setCreatedSources] = useState<DataSource[]>([]);
  const [error, setError] = useState<TextValue>('');
  const [reading, setReading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [page, setPage] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [previewZone, setPreviewZone] = useState(timezone);
  const version = useRef(0);
  const mounted = useRef(true);
  const previewInFlight = useRef(false);
  const commitInFlight = useRef(false);
  const createInFlight = useRef(false);
  const previewInput = useRef<ImportInput | null>(null);
  const analyzedInput = useRef<ImportInput | null>(null);
  const timezoneRef = useRef(timezone);
  timezoneRef.current = timezone;
  const availableSources = useMemo(() => [
    ...dataSources,
    ...createdSources.filter((created) => !dataSources.some((entry) => entry.id === created.id)),
  ], [dataSources, createdSources]);
  const availableSourcesRef = useRef(availableSources);
  availableSourcesRef.current = availableSources;
  useEffect(() => {
    setCreatedSources((current) => current.filter((entry) => !dataSources.some((source) => source.id === entry.id)));
  }, [dataSources]);
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty = step !== 'result' && Boolean(fileName || text || pasteText || reading || analysis || preview);
  const leaveState = useRef({ creating, creatingType, sourceName, dirty });
  leaveState.current = { creating, creatingType, sourceName, dirty };
  const canLeave = () => {
    const current = leaveState.current;
    if (current.creating || createInFlight.current) return false;
    // A submitted commit continues independently of this view. Keeping its
    // version lets a temporarily hidden flow still receive the result.
    if (commitInFlight.current) return true;
    if (current.dirty || (current.creatingType && current.sourceName.trim())) {
      if (!window.confirm(renderText(localized(importMessages, 'discardImport')))) return false;
      // Parent navigation may call this guard again before React renders. Consume the
      // draft synchronously and invalidate pending reads even when we only get hidden.
      leaveState.current = { creating: false, creatingType: null, sourceName: '', dirty: false };
      invalidatePreview();
      setText('');
      setFileName('');
      setPasteText('');
      setSourceName('');
      setPreviewing(false);
    }
    return true;
  };
  const cancelSourceDraft = () => {
    if (createInFlight.current) return false;
    if (leaveState.current.creatingType && leaveState.current.sourceName.trim() && !window.confirm(renderText(localized(importMessages, 'discardSourceDraft')))) return false;
    setCreatingType(null);
    setSourceName('');
    leaveState.current = { ...leaveState.current, creatingType: null, sourceName: '' };
    return true;
  };
  const leave = (next: () => void) => { if (canLeave()) next(); };
  useEffect(() => {
    onGuardChange?.(canLeave);
    return () => onGuardChange?.(null);
  }, [onGuardChange]);
  const invalidatePreview = (message: TextValue = '') => {
    const nextVersion = ++version.current;
    previewInput.current = null;
    analyzedInput.current = null;
    setAnalysis(null);
    setAssignments({});
    setCreatingType(null);
    setPreview(null);
    setPage(0);
    setExpandedRow(undefined);
    setReading(false);
    setStep('input');
    setError(message);
    return nextVersion;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      version.current++;
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  useEffect(() => {
    if (timezone === previewZone || step === 'result' || committing) return;
    invalidatePreview(
      m('timezoneChanged'),
    );
    setPreviewZone(timezone);
  }, [timezone, previewZone, step, committing]);

  const rows = preview?.rows ?? [];
  const period = useMemo(
    () => periodOf(rows, step === 'result' ? timezone : previewZone),
    [rows, previewZone, timezone, step],
  );
  const sources = useMemo(() => sourceCountsOf(rows), [rows]);
  const hiddenSources = sources.filter(([source]) => rows.some(({ activity }) =>
    activity.source === source && !activityIsVisible(activity, enabledSources),
  ));
  const sourceNames = Object.fromEntries(sources.map(([source]) => {
    const target = availableSources.find((entry) => entry.id === assignments[source]);
    return [source, target ? `${target.name} (${sourceLabel(source)})` : sourceLabel(source)];
  }));
  const canOpen = Boolean(period && preview && preview.errors.length === 0);
  const isBusy = busy || reading || previewing || committing || creating;
  const selectedText = inputMode === 'file' ? text : pasteText;
  const selectedFormat = inputMode === 'file' ? format : pasteFormat;
  const selectedSource = inputMode === 'file' ? fileName : '';
  const chooseInputMode = (mode: 'file' | 'paste') => {
    if (isBusy || mode === inputMode) return;
    invalidatePreview();
    setInputMode(mode);
  };

  const enterFile = async (files: FileList | File[]) => {
    const readVersion = invalidatePreview();
    setText('');
    setFileName('');
    if (files.length !== 1) {
      setReading(false);
      setError(m('oneFile'));
      return;
    }
    const file = files[0];
    setFileName(file.name);
    if (file.size > IMPORT_MAX_BYTES) {
      setReading(false);
      setError(m('fileTooLarge'));
      return;
    }
    const detected = file.name.toLowerCase().endsWith('.csv')
      ? 'csv'
      : file.name.toLowerCase().endsWith('.json')
        ? 'json'
        : null;
    if (!detected) {
      setReading(false);
      setError(m('chooseFormat'));
      return;
    }
    setReading(true);
    try {
      const content = await file.text();
      if (!mounted.current || readVersion !== version.current) return;
      setFormat(detected);
      setText(content);
    } catch {
      if (mounted.current && readVersion === version.current)
        setError(m('readFailed'));
    } finally {
      if (mounted.current && readVersion === version.current) setReading(false);
    }
  };
  const fileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) void enterFile(event.target.files);
    event.target.value = '';
  };
  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!isBusy) void enterFile(event.dataTransfer.files);
  };
  const runAnalysis = async () => {
    if (isBusy || !selectedText.trim() || previewInFlight.current) return;
    setError('');
    setPreview(null);
    if (new Blob([selectedText]).size > IMPORT_MAX_BYTES) {
      setError(m('importTooLarge'));
      return;
    }
    const input: ImportInput = Object.freeze({ format: selectedFormat, text: selectedText, ...(selectedSource ? { fileName: selectedSource } : {}) });
    const requestedVersion = version.current;
    const requestedZone = timezone;
    previewInFlight.current = true;
    setPreviewing(true);
    let analyzing = true;
    try {
      const result = await onAnalyze(input);
      if (!mounted.current || requestedVersion !== version.current || requestedZone !== timezoneRef.current) return;
      const targets = availableSourcesRef.current;
      const nextAssignments = initialAssignments(result, targets, initialDataSourceId);
      analyzedInput.current = Object.freeze({ ...input });
      setAnalysis(result);
      setAssignments(nextAssignments);
      setPreviewZone(requestedZone);
      setPage(0);
      setStep('assign');
      if (canSkipAssignments(result, targets, initialDataSourceId)) {
        analyzing = false;
        // onAnalyze releases its request lock before resolving. Keep this flow's
        // lock and use the exact analyzed input, independent of stale busy props.
        await loadPreview(Object.freeze({ ...input, assignments: Object.freeze({ ...nextAssignments }) }), requestedVersion, requestedZone);
      }
    } catch (issue) {
      if (mounted.current && requestedVersion === version.current && requestedZone === timezoneRef.current)
        setError(errorText(issue, m(analyzing ? 'analysisFailed' : 'previewFailed')));
    } finally {
      previewInFlight.current = false;
      if (mounted.current) setPreviewing(false);
    }
  };
  const loadPreview = async (input: ImportInput, requestedVersion: number, requestedZone: string) => {
    const result = await onPreview(input);
    if (!mounted.current || requestedVersion !== version.current || requestedZone !== timezoneRef.current) return;
    previewInput.current = input;
    setPreview(result);
    setPreviewZone(requestedZone);
    setPage(0);
    setExpandedRow(undefined);
    setStep('preview');
  };
  const changeAssignment = (source: Source, id: string) => {
    version.current++;
    previewInput.current = null;
    setPreview(null);
    setError('');
    setAssignments((current) => ({ ...current, [source]: id }));
  };
  const runPreview = async () => {
    if (isBusy || previewInFlight.current || !analysis || !analyzedInput.current ||
      !assignmentsComplete(analysis, assignments, availableSources)) return;
    const input = Object.freeze({ ...analyzedInput.current, assignments: Object.freeze({ ...assignments }) });
    const requestedVersion = version.current;
    const requestedZone = timezone;
    previewInFlight.current = true;
    setPreviewing(true);
    setError('');
    try {
      await loadPreview(input, requestedVersion, requestedZone);
    } catch (issue) {
      if (mounted.current && requestedVersion === version.current && requestedZone === timezoneRef.current)
        setError(errorText(issue, m('previewFailed')));
    } finally {
      previewInFlight.current = false;
      if (mounted.current) setPreviewing(false);
    }
  };
  const createSource = async () => {
    if (isBusy || createInFlight.current || !creatingType || !sourceName.trim()) return;
    const type = creatingType;
    const name = sourceName.trim();
    const requestedVersion = version.current;
    createInFlight.current = true;
    setCreating(true);
    setError('');
    try {
      const id = await onCreateSource(type, name);
      if (!mounted.current || requestedVersion !== version.current) return;
      if (!id) { setError(m('createSourceRetry')); return; }
      setCreatedSources((current) => [...current, { id, type, name, activityCount: 0,
        packageCount: 0, lastImportedAt: null, firstActivityStart: null, legacyCount: 0 }]);
      changeAssignment(type, id);
      setCreatingType(null);
      setSourceName('');
    } catch (issue) {
      if (mounted.current && requestedVersion === version.current)
        setError(errorText(issue, m('createSourceFailed')));
    } finally {
      createInFlight.current = false;
      if (mounted.current) setCreating(false);
    }
  };
  const commit = async () => {
    if (
      isBusy ||
      commitInFlight.current ||
      !preview ||
      !previewInput.current ||
      previewZone !== timezone ||
      !analysis || !assignmentsComplete(analysis, assignments, availableSources) ||
      preview.errors.length ||
      preview.counts.new + preview.counts.updated === 0
    )
      return;
    const requestedVersion = version.current;
    const input = previewInput.current;
    commitInFlight.current = true;
    setCommitting(true);
    setError('');
    try {
      await onCommit(input, preview.revision);
      if (!mounted.current || requestedVersion !== version.current) return;
      setStep('result');
    } catch (issue) {
      if (!mounted.current || requestedVersion !== version.current) return;
      if (issue && typeof issue === 'object' && 'code' in issue && issue.code === 'REVISION_CONFLICT')
        invalidatePreview();
      setError(errorText(issue, m('importFailed')));
    } finally {
      commitInFlight.current = false;
      if (mounted.current) setCommitting(false);
    }
  };

  const changePasteFormat = (nextFormat: 'json' | 'csv') => {
    invalidatePreview();
    setPasteFormat(nextFormat);
  };
  const changePasteText = (nextText: string) => {
    invalidatePreview();
    setPasteText(nextText);
  };
  const beginSourceDraft = (source: Source) => {
    setCreatingType(source);
    setSourceName('');
    setError('');
  };
  const editInput = () => {
    if (cancelSourceDraft()) invalidatePreview();
  };
  const editAssignments = () => {
    version.current++;
    previewInput.current = null;
    setPreview(null);
    setStep('assign');
    setError('');
  };

  return {
    step,
    heading,
    inputMode,
    fileName,
    pasteFormat,
    pasteText,
    reading,
    previewing,
    committing,
    creating,
    creatingType,
    sourceName,
    dragging,
    error,
    analysis,
    assignments,
    availableSources,
    preview,
    previewZone,
    rows,
    period,
    sources,
    hiddenSources,
    sourceNames,
    canOpen,
    isBusy,
    selectedText,
    selectedSource,
    timezone,
    onClose,
    onBack,
    onOpenPeriod,
    chooseInputMode,
    setDragging,
    drop,
    fileChange,
    leave,
    runAnalysis,
    changePasteFormat,
    changePasteText,
    changeAssignment,
    beginSourceDraft,
    setSourceName,
    cancelSourceDraft,
    createSource,
    editInput,
    runPreview,
    editAssignments,
    page,
    expandedRow,
    setPage,
    setExpandedRow,
    commit,
    setStep,
    analyzedFileName: analyzedInput.current?.fileName,
  };
}

export type ImportFlowController = ReturnType<typeof useImportFlow>;
