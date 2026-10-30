import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Download } from 'lucide-react';
import type { AppState, ImportAnalysis, ImportInput, ImportPreview, Source } from '../../shared/types.js';
import { profileFor } from '../../shared/calculations.js';
import { addDays, today, weekStartFor } from '../../shared/time.js';
import { duration, shortDate } from '../format';
import { Modal } from './Modal';
import { SourcesPanel, type SourcesPanelHandle } from './data-sources/SourcesPanel';
import { api } from '../api';
import { downloadBlob } from '../download';
import './settings-dialog.css';
import { errorText, LanguageSelector, useMessages, type TextValue } from '../i18n';
import { shellMessages } from '../locales/shell';
import { dataSourceMessages } from '../locales/data-sources';
import { accountingMessages } from '../locales/accounting';
import { HolidaySettings } from './HolidaySettings';

export function SettingsDialog({
  state,
  busy,
  requestError,
  onClose,
  onTimezone,
  onProfile,
  enabledSources,
  onAnalyze,
  onPreview,
  onCommit,
  onCreateSource,
  onRenameSource,
  onDeleteSource,
  onOpenPeriod,
  holidayActions,
}: {
  state: AppState;
  busy: boolean;
  requestError: TextValue;
  onClose: () => void;
  onTimezone: (zone: string) => Promise<boolean>;
  onProfile: (effectiveFrom: string | null, weeklyMinutes: number, workdays: number[]) => Promise<boolean>;
  enabledSources: string[];
  onAnalyze: (input: ImportInput) => Promise<ImportAnalysis>;
  onPreview: (input: ImportInput) => Promise<ImportPreview>;
  onCommit: (input: ImportInput, revision: number) => Promise<void>;
  onCreateSource: (type: Source, name: string) => Promise<string | null>;
  onRenameSource: (id: string, name: string, expectedRevision: number) => Promise<boolean>;
  onDeleteSource: (id: string, expectedRevision: number) => Promise<boolean>;
  onOpenPeriod: (date: string, revealSourceId?: string) => void;
  holidayActions: Pick<Parameters<typeof HolidaySettings>[0], 'onProfile' | 'onDeleteProfile' | 'onOverride' | 'onDeleteOverride'>;
}) {
  const { t: sourceT } = useMessages(dataSourceMessages);
  const { t, m, text, language } = useMessages(shellMessages);
  const { t: a } = useMessages(accountingMessages);
  const dayNames = language === 'de' ? ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const [tab, setTab] = useState<'general' | 'sources' | 'holidays'>('general');
  const sourcesPanel = useRef<SourcesPanelHandle>(null);
  const holidayDirty = useRef(false);
  const holidayPending = useRef(false);
  const [holidayReset, setHolidayReset] = useState(0);
  const canLeaveHolidays = () => {
    if (holidayPending.current) return false;
    if (holidayDirty.current && !window.confirm(a('discard'))) return false;
    if (holidayDirty.current) { holidayDirty.current = false; setHolidayReset(value => value + 1); }
    return true;
  };
  const close = () => {
    if (tab === 'holidays' && !canLeaveHolidays()) return;
    if (sourcesPanel.current && !sourcesPanel.current.canLeave()) return;
    onClose();
  };
  const escape = () => {
    if (tab === 'sources' && sourcesPanel.current?.escape()) return;
    close();
  };
  const chooseTab = (next: 'general' | 'sources' | 'holidays') => {
    if (next === tab || pendingRef.current || (tab === 'sources' && !sourcesPanel.current?.canLeave())) return;
    if (tab === 'holidays' && !canLeaveHolidays()) return;
    setTab(next);
  };

  const initial = state.profiles.find((p) => p.effectiveFrom === null) ?? state.profiles[0];
  const currentProfile = profileFor(today(state.settings.timezone), state.profiles);
  const [timezone, setTimezone] = useState(state.settings.timezone);
  const [mode, setMode] = useState<'initial' | 'new'>('new');
  const [weeklyHours, setWeeklyHours] = useState(String(currentProfile.weeklyMinutes / 60));
  const [days, setDays] = useState<number[]>(currentProfile.workdays);
  const [effectiveFrom, setEffectiveFrom] = useState(
    addDays(weekStartFor(today(state.settings.timezone)), 7),
  );
  const [error, setError] = useState<TextValue>('');
  const [backupPending, setBackupPending] = useState(false);
  const downloadBackup = async () => {
    if (backupPending) return;
    setBackupPending(true);
    setError('');
    try {
      const blob = await api.backup();
      if (!mounted.current) return;
      downloadBlob(blob, 'im-overdue-backup.sqlite');
    } catch (issue) {
      if (mounted.current) setError(errorText(issue, m('backupFailed')));
    } finally { if (mounted.current) setBackupPending(false); }
  };
  const [pending, setPending] = useState<'zone' | 'profile' | null>(null);
  const [saved, setSaved] = useState({ zone: false, profile: false });
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const zoneListId = useId();
  const timezoneOptions = useMemo(() => {
    const supportedValuesOf = (Intl as typeof Intl & {
      supportedValuesOf?: (key: 'timeZone') => string[];
    }).supportedValuesOf;
    return [...new Set([state.settings.timezone, 'UTC', ...(supportedValuesOf?.('timeZone') ?? [])])].sort();
  }, [state.settings.timezone]);
  const profileDrafts = useRef({
    initial: { hours: String(initial.weeklyMinutes / 60), days: initial.workdays },
    new: { hours: String(currentProfile.weeklyMinutes / 60), days: currentProfile.workdays },
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const minutes = Math.round(Number(weeklyHours) * 60);
  const profileDate = mode === 'initial' ? null : effectiveFrom;
  const existing = state.profiles.find((profile) => profile.effectiveFrom === profileDate);
  const sameDays = (left: number[], right: number[]) =>
    left.length === right.length &&
    [...left].sort((a, b) => a - b).join(',') === [...right].sort((a, b) => a - b).join(',');
  const profileUnchanged =
    !!existing && minutes === existing.weeklyMinutes && sameDays(days, existing.workdays);
  const timezoneUnchanged = timezone.trim() === state.settings.timezone;
  const chooseMode = (next: 'initial' | 'new') => {
    if (pendingRef.current || next === mode) return;
    profileDrafts.current[mode] = { hours: weeklyHours, days };
    setMode(next);
    setError('');
    setSaved((current) => ({ ...current, profile: false }));
    setWeeklyHours(profileDrafts.current[next].hours);
    setDays(profileDrafts.current[next].days);
  };
  const profileSave = async (event: FormEvent) => {
    event.preventDefault();
    if (pendingRef.current || busy || profileUnchanged) return;
    setError('');
    setSaved((current) => ({ ...current, profile: false }));
    if (
      !weeklyHours.trim() ||
      !Number.isFinite(minutes) ||
      minutes < 0 ||
      minutes > 7 * 24 * 60 ||
      days.length === 0
    ) {
      setError(m('invalidHours'));
      return;
    }
    if (mode === 'new' && weekStartFor(effectiveFrom) !== effectiveFrom) {
      setError(m('mondayRequired'));
      return;
    }
    const hasHistory = state.blocks.length > 0 || state.weeks.length > 0 || state.vacations.length > 0;
    const nextMonday = addDays(weekStartFor(today(state.settings.timezone)), 7);
    if (
      hasHistory &&
      (mode === 'initial' || effectiveFrom < nextMonday) &&
      !window.confirm(
        t('profileHistoryConfirm'),
      )
    )
      return;
    pendingRef.current = true;
    setPending('profile');
    try {
      if (
        (await onProfile(
          profileDate,
          minutes,
          [...days].sort((a, b) => a - b),
        )) &&
        mounted.current
      )
        setSaved((current) => ({ ...current, profile: true }));
    } catch (issue) {
      if (mounted.current)
        setError(errorText(issue, m('profileFailed')));
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(null);
    }
  };
  const zoneSave = async () => {
    if (pendingRef.current || busy || timezoneUnchanged || !timezone.trim()) return;
    setError('');
    setSaved((current) => ({ ...current, zone: false }));
    try {
      new Intl.DateTimeFormat('de-DE', { timeZone: timezone.trim() });
    } catch {
      setError(m('invalidZone'));
      return;
    }
    pendingRef.current = true;
    setPending('zone');
    try {
      if ((await onTimezone(timezone.trim())) && mounted.current)
        setSaved((current) => ({ ...current, zone: true }));
    } catch (issue) {
      if (mounted.current)
        setError(errorText(issue, m('zoneFailed')));
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(null);
    }
  };
  return (
    <Modal title={t('settings')} onClose={close} onEscape={escape} className="modal-wide settings-dialog">
      <div className="settings-tabs"><LanguageSelector /></div>
      <div className="settings-tabs" role="tablist" aria-label={t('settings')}>
        <button role="tab" aria-selected={tab === 'general'} aria-controls="settings-general" id="settings-general-tab" onClick={() => chooseTab('general')}>{sourceT('general')}</button>
        <button role="tab" aria-selected={tab === 'sources'} aria-controls="settings-sources" id="settings-sources-tab" onClick={() => chooseTab('sources')}>{sourceT('dataSources')}</button>
        <button role="tab" aria-selected={tab === 'holidays'} aria-controls="settings-holidays" id="settings-holidays-tab" onClick={() => chooseTab('holidays')}>{a('holidays')}</button>
      </div>
      <div className="dialog-content settings-general" role="tabpanel" aria-labelledby="settings-general-tab" id="settings-general" hidden={tab !== 'general'}>
        <section className="settings-section">
          <h3>{t('zone')}</h3>
          <p className="muted small">
            {t('zoneDescription')}
          </p>
          <div className="inline-form">
            <label className="field grow">
              {t('searchZone')}
              <input
                type="text"
                list={zoneListId}
                value={timezone}
                onChange={(e) => {
                  setTimezone(e.target.value);
                  setSaved((current) => ({ ...current, zone: false }));
                }}
                placeholder="Europe/Berlin"
                spellCheck={false}
                disabled={pending !== null}
              />
              <datalist id={zoneListId}>
                {timezoneOptions.map((zone) => <option key={zone} value={zone} />)}
              </datalist>
            </label>
            <button
              className="button secondary align-end"
              disabled={busy || pending !== null || timezoneUnchanged || !timezone.trim()}
              onClick={zoneSave}
            >
              {pending === 'zone' ? t('saving') : t('save')}
            </button>
          </div>
          {saved.zone && (
            <p className="muted small" role="status">
              {t('zoneSaved')}
            </p>
          )}
        </section>
        <section className="settings-section">
          <h3>{t('weeklyTarget')}</h3>
          <div className="settings-current-profile" aria-label={t('currentProfile')}>
            <span>{t('current')}</span>
            <strong>{t('perWeek', { hours: duration(currentProfile.weeklyMinutes) })}</strong>
            <span>{[...currentProfile.workdays].sort((a, b) => a - b).map((day) => dayNames[day - 1]).join(', ')}</span>
            <small>{currentProfile.effectiveFrom ? t('since', { date: shortDate(currentProfile.effectiveFrom) }) : t('sinceBeginning')}</small>
          </div>
          <p className="muted small">
            {t('targetDescription')}
          </p>
          <div className="segmented settings-profile-modes" aria-label={t('changeTarget')}>
            <button
              className={mode === 'new' ? 'selected' : ''}
              onClick={() => chooseMode('new')}
              disabled={pending !== null}
              aria-pressed={mode === 'new'}
            >
              {t('futureTarget')}
            </button>
            <button
              className={mode === 'initial' ? 'selected' : ''}
              onClick={() => chooseMode('initial')}
              disabled={pending !== null}
              aria-pressed={mode === 'initial'}
            >
              {t('pastTarget')}
            </button>
          </div>
          {mode === 'initial' && <p className="settings-history-warning small">{t('historyWarning')}</p>}
          <form onSubmit={profileSave}>
            <div className="form-grid">
              <label className="field">
                {t('weeklyHours')}
                <input
                  type="number"
                  min="0"
                  max="168"
                  step="any"
                  value={weeklyHours}
                  onChange={(e) => {
                    setWeeklyHours(e.target.value);
                    setSaved((current) => ({ ...current, profile: false }));
                  }}
                  required
                  disabled={pending !== null}
                />
              </label>
              {mode === 'new' && (
                <label className="field">
                  {t('validMonday')}
                  <input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => {
                      setEffectiveFrom(e.target.value);
                      setSaved((current) => ({ ...current, profile: false }));
                    }}
                    required
                    disabled={pending !== null}
                  />
                </label>
              )}
              <fieldset className="weekday-field full" disabled={pending !== null}>
                <legend>{t('workingDays')}</legend>
                <div className="weekday-grid">
                  {dayNames.map((day, i) => (
                    <label key={i} className={days.includes(i + 1) ? 'chosen' : ''}>
                      <input
                        type="checkbox"
                        checked={days.includes(i + 1)}
                        disabled={pending !== null}
                        onChange={() => {
                          setDays((current) =>
                            current.includes(i + 1)
                              ? current.filter((d) => d !== i + 1)
                              : [...current, i + 1],
                          );
                          setSaved((current) => ({ ...current, profile: false }));
                        }}
                      />
                      {day}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="dialog-actions compact">
              <button
                className="button primary"
                type="submit"
                disabled={busy || pending !== null || profileUnchanged}
              >
                {pending === 'profile' ? t('saving') : t('saveProfile')}
              </button>
            </div>
            {saved.profile && (
              <p className="muted small" role="status">
                {t('profileSaved')}
              </p>
            )}
          </form>
          <div className="profile-history">
            <strong>{t('profileHistory')}</strong>
            {state.profiles.map((profile) => (
              <div className="profile-row" key={profile.id}>
                <span>
                  {profile.effectiveFrom
                    ? t('from', { date: shortDate(profile.effectiveFrom) })
                    : t('baseProfile')}
                </span>
                <span>
                  {duration(profile.weeklyMinutes)} ·{' '}
                  {[...profile.workdays]
                    .sort((a, b) => a - b)
                    .map((day) => dayNames[day - 1])
                    .join(', ')}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="settings-section backup-section">
          <h3>{t('backup')}</h3>
          <p className="muted small">
            {t('backupDescription')}
          </p>
          <a className="button secondary" href="/api/backup" download="im-overdue-backup.sqlite" aria-disabled={backupPending} onClick={event => { event.preventDefault(); void downloadBackup(); }}>
            <Download size={15} /> {backupPending ? t('backupLoading') : t('backupDownload')}
          </a>
        </section>
        {error && (
          <p className="form-error" role="alert">
            {text(error)}
          </p>
        )}
        {requestError && (
          <p className="form-error" role="alert">
            {text(requestError)}
          </p>
        )}
        <div className="dialog-actions">
          <button className="button secondary" onClick={close}>
            {t('close')}
          </button>
        </div>
      </div>
      <div className="settings-sources" role="tabpanel" aria-labelledby="settings-sources-tab" id="settings-sources" hidden={tab !== 'sources'}>
        <SourcesPanel ref={sourcesPanel} state={state} busy={busy} active={tab === 'sources'} enabledSources={enabledSources} onClose={close} onAnalyze={onAnalyze} onPreview={onPreview} onCommit={onCommit} onCreateSource={onCreateSource} onRenameSource={onRenameSource} onDeleteSource={onDeleteSource} onOpenPeriod={onOpenPeriod} />
        {tab === 'sources' && requestError && <p className="settings-source-error form-error" role="alert">{text(requestError)}</p>}
      </div>
      <div className="dialog-content" role="tabpanel" aria-labelledby="settings-holidays-tab" id="settings-holidays" hidden={tab !== 'holidays'}>
        <HolidaySettings key={holidayReset} state={state} busy={busy} {...holidayActions}
          onDirtyChange={value => { holidayDirty.current = value; }} onPendingChange={value => { holidayPending.current = value; }} />
        {tab === 'holidays' && requestError && <p className="form-error" role="alert">{text(requestError)}</p>}
        <div className="dialog-actions"><button className="button secondary" onClick={close}>{t('close')}</button></div>
      </div>
    </Modal>
  );
}
