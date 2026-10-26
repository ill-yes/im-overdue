import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { AppState, ImportAnalysis, ImportInput, ImportPreview } from '../../shared/types.js';
import { errorText, localized, text, useLanguage, type TextValue } from '../i18n';
import { shellMessages } from '../locales/shell';
const m = (key: keyof typeof shellMessages, params?: Record<string, string | number>) => localized(shellMessages, key, params);

type RequestFailure = { message: TextValue; sessionId?: number };
type Mutation = (revision: number, confirmed: boolean) => Promise<AppState>;
type MutationMessage = TextValue | ((result: AppState) => TextValue);

export function useAppRequests(onInitialTimezone: (timezone: string) => void) {
  const language = useLanguage();
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RequestFailure | null>(null);
  const [message, setMessage] = useState<TextValue>('');
  const currentState = useRef<AppState | null>(null);
  const requestInFlight = useRef(false);
  const initialTimezoneSet = useRef(false);

  const acceptState = useCallback((next: AppState) => {
    if (currentState.current && next.revision < currentState.current.revision) return false;
    currentState.current = next;
    setState(next);
    return true;
  }, []);
  const isRequestInFlight = useCallback(() => requestInFlight.current, []);
  const getCurrentState = useCallback(() => currentState.current, []);
  const beginRequest = useCallback(() => {
    if (requestInFlight.current) return false;
    requestInFlight.current = true;
    setBusy(true);
    return true;
  }, []);
  const finishRequest = useCallback(() => {
    requestInFlight.current = false;
    setBusy(false);
  }, []);
  const clearFailure = useCallback(() => setFailure(null), []);

  const refresh = useCallback(async () => {
    setFailure(null);
    try {
      const loaded = await api.state();
      if (acceptState(loaded) && !initialTimezoneSet.current) {
        initialTimezoneSet.current = true;
        onInitialTimezone(loaded.settings.timezone);
      }
    } catch (issue) {
      setFailure({ message: errorText(issue, m('loadFailed')) });
    } finally {
      setLoading(false);
    }
  }, [acceptState, onInitialTimezone]);
  const retryLoad = useCallback(async () => {
    setLoading(true);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(''), 6000);
    return () => window.clearTimeout(id);
  }, [message]);

  const applyMutation = useCallback(async (
    operation: Mutation,
    success: MutationMessage,
    sessionId?: number,
    expectedRevision?: number,
  ): Promise<boolean> => {
    const revision = expectedRevision ?? currentState.current?.revision;
    if (revision === undefined || !beginRequest()) return false;
    setFailure(null);
    try {
      let result: AppState;
      try {
        result = await operation(revision, false);
      } catch (issue) {
        if (
          issue instanceof ApiError &&
          (issue.code === 'REOPEN_REQUIRED' || issue.code === 'CURRENT_WEEK_CONFIRM_REQUIRED')
        ) {
          const ask = issue.code === 'REOPEN_REQUIRED'
            ? issue.weeks?.length ? text(m('reopenWeeks', { weeks: issue.weeks.join(', ') })) : text(m('reopenAffected'))
            : text(m('closeCurrent'));
          if (!window.confirm(ask)) return false;
          result = await operation(revision, true);
        } else throw issue;
      }
      acceptState(result);
      setMessage(typeof success === 'function' ? success(result) : success);
      return true;
    } catch (issue) {
      if (
        issue instanceof ApiError &&
        (issue.code === 'REVISION_CONFLICT' || issue.code === 'UNDO_CONFLICT' || issue.code === 'WEEK_REVIEW_REQUIRED')
      ) {
        await refresh();
        setFailure({
          sessionId,
          message:
            issue.code === 'WEEK_REVIEW_REQUIRED'
              ? m('reviewChanged')
              : issue.code === 'UNDO_CONFLICT'
              ? m('undoConflict')
              : m('revisionConflict'),
        });
      } else {
        setFailure({
          sessionId,
          message: errorText(issue, m('changeFailed')),
        });
      }
      return false;
    } finally {
      finishRequest();
    }
  }, [acceptState, beginRequest, finishRequest, refresh]);

  const importCommit = useCallback(async (input: ImportInput, revision: number) => {
    if (!currentState.current || !beginRequest())
      throw { message: text(m('waitRequest')), ...m('waitRequest') };
    setFailure(null);
    try {
      const next = await api.commit(input, revision);
      acceptState(next);
      setMessage(m('imported'));
    } catch (issue) {
      if (issue instanceof ApiError && issue.code === 'REVISION_CONFLICT') await refresh();
      throw issue;
    } finally {
      finishRequest();
    }
  }, [acceptState, beginRequest, finishRequest, refresh]);

  const handlePreview = useCallback(async (input: ImportInput): Promise<ImportPreview> => {
    if (!beginRequest()) throw { message: text(m('waitRequest')), ...m('waitRequest') };
    try {
      return await api.preview(input);
    } finally {
      finishRequest();
    }
  }, [beginRequest, finishRequest]);

  const handleAnalyze = useCallback(async (input: ImportInput): Promise<ImportAnalysis> => {
    if (!beginRequest()) throw { message: text(m('waitRequest')), ...m('waitRequest') };
    try { return await api.analyze(input); }
    finally { finishRequest(); }
  }, [beginRequest, finishRequest]);

  return { state, loading, busy, failure: failure ? { ...failure, message: text(failure.message, language) } : null, message: text(message, language), clearFailure, refresh, retryLoad, applyMutation, importCommit, handlePreview, handleAnalyze, isRequestInFlight, getCurrentState };
}
