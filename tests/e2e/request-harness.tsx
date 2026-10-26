import { StrictMode, useCallback, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../../src/api';
import { useAppRequests } from '../../src/hooks/useAppRequests';
import type { ImportInput } from '../../shared/types.js';

const importInput: ImportInput = { format: 'json', text: '[]' };

type RequestHarness = Pick<ReturnType<typeof useAppRequests>, 'refresh' | 'isRequestInFlight'> & {
  mutate: () => Promise<boolean>;
  analyze: () => ReturnType<typeof api.analyze>;
  preview: () => ReturnType<typeof api.preview>;
  commit: (revision: number) => Promise<void>;
};

declare global {
  interface Window {
    requestStateHarness: RequestHarness;
  }
}

function Harness() {
  const [initializations, setInitializations] = useState(0);
  const [initialTimezone, setInitialTimezone] = useState('');
  const [outcome, setOutcome] = useState('');
  const initializeTimezone = useCallback((timezone: string) => {
    setInitializations(count => count + 1);
    setInitialTimezone(timezone);
  }, []);
  const requests = useAppRequests(initializeTimezone);
  useLayoutEffect(() => {
    window.requestStateHarness = {
      refresh: requests.refresh,
      isRequestInFlight: requests.isRequestInFlight,
      mutate: async () => {
        const result = await requests.applyMutation(
          (revision, confirmed) => api.setWeek('2026-09-28', 'closed', revision, confirmed),
          'Woche gespeichert.',
          17,
        );
        setOutcome(String(result));
        return result;
      },
      analyze: () => requests.handleAnalyze(importInput),
      preview: () => requests.handlePreview(importInput),
      commit: revision => requests.importCommit(importInput, revision),
    };
  }, [requests]);

  return <main>
    <output data-testid="revision">{requests.state?.revision ?? 'none'}</output>
    <output data-testid="undo">{requests.state?.undo?.token ?? 'none'}</output>
    <output data-testid="timezone">{requests.state?.settings.timezone ?? 'none'}</output>
    <output data-testid="initializations">{initializations}</output>
    <output data-testid="initial-timezone">{initialTimezone}</output>
    <output data-testid="loading">{String(requests.loading)}</output>
    <output data-testid="busy">{String(requests.busy)}</output>
    <output data-testid="failure">{requests.failure?.message ?? ''}</output>
    <output data-testid="failure-session">{requests.failure?.sessionId ?? 'none'}</output>
    <output data-testid="message">{requests.message}</output>
    <output data-testid="outcome">{outcome}</output>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
