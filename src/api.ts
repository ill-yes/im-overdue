import type { AbsenceChange, AccountEntryInput, AccountOpening, Activity, AppState, BlockInput, DataPage, GermanState, ImportAnalysis, ImportInput, ImportPackage, ImportPackagePage, ImportPreview, NoteScope, ReusableInput, Source, TimesheetSnapshot, VacationAllowance, WeekReview } from '../shared/types.js';
import { localized, type MessageParams, type Messages } from '../shared/i18n.js';

const networkMessages = {
  sessionChanged: { en: 'Your session has changed. Please sign in again.', de: 'Die Sitzung hat sich geändert. Bitte erneut anmelden.' },
  unavailable: { en: 'The app is unreachable. Please check your connection.', de: 'Die App ist nicht erreichbar. Bitte die Verbindung prüfen.' },
  failed: { en: 'Request failed ({status}).', de: 'Anfrage fehlgeschlagen ({status}).' },
} satisfies Messages;

export class ApiError extends Error {
  constructor(message: string, public readonly code?: string, public readonly weeks?: string[], public readonly review?: WeekReview, public readonly messageKey?: string, public readonly messageParams?: MessageParams) {
    super(message);
  }
}

export type AuthSession = { required: boolean; authenticated: boolean };
let sessionGeneration = 0;
let requestsAllowed = true;
const pendingRequests = new Set<AbortController>();
let onSessionExpired: (() => void) | undefined;

// A new session must never receive a result that was requested by the old one.
export function resetSessionRequests(allowed: boolean) {
  sessionGeneration += 1;
  requestsAllowed = allowed;
  for (const controller of pendingRequests) controller.abort();
  pendingRequests.clear();
  return sessionGeneration;
}

export function watchSessionExpiry(listener: () => void) {
  onSessionExpired = listener;
  return () => { if (onSessionExpired === listener) onSessionExpired = undefined; };
}

async function request<T>(path: string, method = 'GET', body?: unknown, binary = false): Promise<T> {
  const generation = sessionGeneration;
  const authRequest = path.startsWith('/api/auth/');
  const stale = () => Object.assign(new ApiError('Die Sitzung hat sich geändert. Bitte erneut anmelden.', 'SESSION_CHANGED'), localized(networkMessages, 'sessionChanged'));
  if (!authRequest && !requestsAllowed) throw stale();
  const controller = new AbortController();
  pendingRequests.add(controller);
  try {
    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        signal: controller.signal,
      });
    } catch {
      if (generation !== sessionGeneration) throw stale();
      throw Object.assign(new ApiError('Die App ist nicht erreichbar. Bitte die Verbindung prüfen.'), localized(networkMessages, 'unavailable'));
    }
    if (generation !== sessionGeneration) throw stale();
    if (binary && response.ok) {
      const data = await response.blob();
      if (generation !== sessionGeneration) throw stale();
      return data as T;
    }
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (generation !== sessionGeneration) throw stale();
    if (!response.ok) {
      if (!authRequest && response.status === 401 && data?.code === 'AUTH_REQUIRED') {
        resetSessionRequests(false);
        onSessionExpired?.();
      }
      const problem = new ApiError(
        typeof data?.message === 'string' ? data.message : `Anfrage fehlgeschlagen (${response.status}).`,
        typeof data?.code === 'string' ? data.code : undefined,
        Array.isArray(data?.weeks) ? data.weeks.filter((v): v is string => typeof v === 'string') : undefined,
        data?.review as WeekReview | undefined,
        typeof data?.messageKey === 'string' ? data.messageKey : undefined,
        data?.messageParams && typeof data.messageParams === 'object' && !Array.isArray(data.messageParams)
          ? Object.fromEntries(Object.entries(data.messageParams).filter((entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number'))
          : undefined,
      );
      if (typeof data?.message !== 'string') Object.assign(problem, localized(networkMessages, 'failed', { status: response.status }));
      throw problem;
    }
    return data as T;
  } finally {
    pendingRequests.delete(controller);
  }
}

export const api = {
  createDataSource: (type: Source, name: string, revision: number) => request<AppState>('/api/data-sources', 'POST', { type, name, expectedRevision: revision }),
  renameDataSource: (id: string, name: string, revision: number) => request<AppState>(`/api/data-sources/${encodeURIComponent(id)}`, 'PUT', { name, expectedRevision: revision }),
  deleteDataSource: (id: string, revision: number) => request<AppState>(`/api/data-sources/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision: revision }),
  sourceActivities: (id: string, page = 0, q = '') => request<DataPage<Activity>>(`/api/data-sources/${encodeURIComponent(id)}/activities?${new URLSearchParams({ page: String(page), q })}`),
  sourcePackages: (id: string, page = 0, q = '') => request<DataPage<ImportPackage>>(`/api/data-sources/${encodeURIComponent(id)}/packages?${new URLSearchParams({ page: String(page), q })}`),
  packageActivities: (id: string, page = 0, q = '') => request<ImportPackagePage>(`/api/import-packages/${encodeURIComponent(id)}?${new URLSearchParams({ page: String(page), q })}`),
  analyze: (input: ImportInput) => request<ImportAnalysis>('/api/import/analyze', 'POST', input),
  session: () => request<AuthSession>('/api/auth/session'),
  login: (password: string) => request<AuthSession>('/api/auth/login', 'POST', { password }),
  logout: () => request<void>('/api/auth/logout', 'POST'),
  backup: () => request<Blob>('/api/backup', 'GET', undefined, true),
  state: () => request<AppState>('/api/state'),
  createBlock: (input: BlockInput, revision: number, confirmReopen = false) => request<AppState>('/api/blocks', 'POST', { ...input, expectedRevision: revision, confirmReopen }),
  updateBlock: (id: string, input: BlockInput, revision: number, confirmReopen = false) => request<AppState>(`/api/blocks/${encodeURIComponent(id)}`, 'PUT', { ...input, expectedRevision: revision, confirmReopen }),
  deleteBlock: (id: string, revision: number, confirmReopen = false) => request<AppState>(`/api/blocks/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision: revision, confirmReopen }),
  undoBlock: (token: string, revision: number) => request<AppState>('/api/blocks/undo', 'POST', { token, expectedRevision: revision }),
  setWeek: (weekStart: string, status: 'open' | 'closed', revision: number, confirmCurrent = false, confirmWarnings = false, reviewKey?: string) => request<AppState>(`/api/weeks/${weekStart}`, 'POST', { status, expectedRevision: revision, confirmCurrent, confirmWarnings, reviewKey }),
  weekReview: (weekStart: string) => request<WeekReview>(`/api/weeks/${weekStart}/review`),
  saveAbsences: (days: AbsenceChange[], revision: number, confirmReopen = false) => request<AppState>('/api/absences', 'PUT', { days, expectedRevision: revision, confirmReopen }),
  saveAccountOpening: (input: AccountOpening, revision: number) => request<AppState>('/api/account/opening', 'PUT', { ...input, expectedRevision: revision }),
  saveAccountEntry: (id: string | null, input: AccountEntryInput, revision: number) => request<AppState>(id ? `/api/account/entries/${encodeURIComponent(id)}` : '/api/account/entries', id ? 'PUT' : 'POST', { ...input, expectedRevision: revision }),
  deleteAccountEntry: (id: string, revision: number) => request<AppState>(`/api/account/entries/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision: revision }),
  saveHolidayProfile: (input: { effectiveFrom: string; region: GermanState | null }, revision: number, confirmReopen = false) => request<AppState>('/api/holiday-profiles', 'POST', { ...input, expectedRevision: revision, confirmReopen }),
  deleteHolidayProfile: (id: string, revision: number, confirmReopen = false) => request<AppState>(`/api/holiday-profiles/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision: revision, confirmReopen }),
  saveHolidayOverride: (input: { date: string; name: string | null }, revision: number, confirmReopen = false) => request<AppState>(`/api/holiday-overrides/${input.date}`, 'PUT', { name: input.name, expectedRevision: revision, confirmReopen }),
  deleteHolidayOverride: (date: string, revision: number, confirmReopen = false) => request<AppState>(`/api/holiday-overrides/${date}`, 'DELETE', { expectedRevision: revision, confirmReopen }),
  saveVacationAllowance: (input: VacationAllowance, revision: number) => request<AppState>(`/api/vacation-allowances/${String(input.year).padStart(4, '0')}`, 'PUT', { entitlementDays: input.entitlementDays, carryoverDays: input.carryoverDays, expectedRevision: revision }),
  timesheet: (from: string, to: string) => request<TimesheetSnapshot>(`/api/timesheet?${new URLSearchParams({ from, to })}`),
  saveNote: (scope: NoteScope, date: string, text: string, revision: number) => request<AppState>(`/api/notes/${scope}/${encodeURIComponent(date)}`, 'PUT', { text, expectedRevision: revision }),
  saveTemplate: (input: ReusableInput, revision: number, id?: string) => request<AppState>(id ? `/api/templates/${encodeURIComponent(id)}` : '/api/templates', id ? 'PUT' : 'POST', { ...input, expectedRevision: revision }),
  deleteTemplate: (id: string, revision: number) => request<AppState>(`/api/templates/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision: revision }),
  settings: (timezone: string, revision: number, confirmReopen = false) => request<AppState>('/api/settings', 'PUT', { timezone, expectedRevision: revision, confirmReopen }),
  profile: (effectiveFrom: string | null, weeklyMinutes: number, workdays: number[], revision: number, confirmReopen = false) => request<AppState>('/api/profiles', 'POST', { effectiveFrom, weeklyMinutes, workdays, expectedRevision: revision, confirmReopen }),
  preview: (input: ImportInput) => request<ImportPreview>('/api/import/preview', 'POST', input),
  commit: (input: ImportInput, revision: number) => request<AppState>('/api/import/commit', 'POST', { ...input, expectedRevision: revision }),
};
