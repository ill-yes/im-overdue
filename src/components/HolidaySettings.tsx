import { useEffect, useRef, useState, type FormEvent } from 'react';
import { GERMAN_STATES, type AppState, type GermanState } from '../../shared/types.js';
import { holidayForDate, holidayProfileForDate, holidayReviewRequired } from '../../shared/holidays.js';
import { Temporal, today } from '../../shared/time.js';
import { shortDate } from '../format';
import { errorText, useMessages, type TextValue } from '../i18n';
import { accountingMessages, regionNames } from '../locales/accounting';
import './holiday-settings.css';

function validDate(date: string) { try { return Temporal.PlainDate.from(date).toString() === date; } catch { return false; } }

export function HolidaySettings({ state, busy, onProfile, onDeleteProfile, onOverride, onDeleteOverride, onDirtyChange, onPendingChange }: {
  state: AppState; busy: boolean;
  onProfile: (input: { effectiveFrom: string; region: GermanState | null }, expectedRevision: number) => Promise<boolean>;
  onDeleteProfile: (id: string, expectedRevision: number) => Promise<boolean>;
  onOverride: (input: { date: string; name: string | null }, expectedRevision: number) => Promise<boolean>;
  onDeleteOverride: (date: string, expectedRevision: number) => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void; onPendingChange?: (pending: boolean) => void;
}) {
  const { t, m, text, language } = useMessages(accountingMessages);
  const { t: regionLabel } = useMessages(regionNames);
  const [initialDate] = useState(() => !state.holidayProfiles?.length && state.accountOpening ? state.accountOpening.date : today(state.settings.timezone));
  const [profile, setProfile] = useState(() => ({ effectiveFrom: initialDate, region: holidayProfileForDate(state.holidayProfiles ?? [], initialDate)?.region ?? null }));
  const [profileBase, setProfileBase] = useState(() => JSON.stringify(profile));
  const [override, setOverride] = useState({ date: initialDate, mode: 'add' as 'add' | 'exclude', name: '' });
  const [overrideBase, setOverrideBase] = useState(() => JSON.stringify(override));
  // null: adopt the revision rendered with this component's own saved change.
  const [revision, setRevision] = useState<number | null>(state.revision);
  const [profileSnapshots, setProfileSnapshots] = useState<Record<string, string>>(() => Object.fromEntries((state.holidayProfiles ?? []).map(item => [item.effectiveFrom, JSON.stringify({ effectiveFrom: item.effectiveFrom, region: item.region })])));
  const [overrideSnapshots, setOverrideSnapshots] = useState<Record<string, string>>(() => Object.fromEntries((state.holidayOverrides ?? []).map(item => [item.date, JSON.stringify({ date: item.date, name: item.name })])));
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<TextValue>('');
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const profileDirty = JSON.stringify(profile) !== profileBase;
  const overrideDirty = JSON.stringify(override) !== overrideBase;
  const locked = busy || pending;
  useEffect(() => { onDirtyChange?.(profileDirty || overrideDirty); }, [profileDirty, overrideDirty, onDirtyChange]);
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (revision === null) setRevision(state.revision); }, [revision, state.revision]);
  const currentHoliday = validDate(override.date) ? holidayForDate(state, override.date) : null;
  const existingProfile = state.holidayProfiles?.find(item => item.effectiveFrom === profile.effectiveFrom);
  const profileUnchanged = !!existingProfile && existingProfile.region === profile.region;
  const existingOverride = state.holidayOverrides?.find(item => item.date === override.date);
  const historicalReview = holidayReviewRequired(state, '1992-06-07') || (
    profile.region === 'ST' && profile.effectiveFrom <= '1992-06-07' && !state.holidayOverrides?.some(item => item.date === '1992-06-07'));
  const profileChanged = (profileSnapshots[profile.effectiveFrom] ?? '') !== (existingProfile ? JSON.stringify({ effectiveFrom: existingProfile.effectiveFrom, region: existingProfile.region }) : '');
  const overrideChanged = (overrideSnapshots[override.date] ?? '') !== (existingOverride ? JSON.stringify({ date: existingOverride.date, name: existingOverride.name }) : '');
  const overrideName = override.mode === 'exclude' ? null : override.name.trim();
  const overrideUnchanged = !!existingOverride && existingOverride.name === overrideName;
  const run = async (action: () => Promise<boolean>, done?: () => void) => {
    if (pendingRef.current || busy) return;
    pendingRef.current = true; setPending(true); setError(''); setSaved(false);
    try {
      const ok = await action();
      if (mounted.current && ok) { done?.(); setSaved(true); setRevision(null); }
      else if (mounted.current) setError(m('saveFailed'));
    } catch (issue) { if (mounted.current) setError(errorText(issue, m('saveFailed'))); }
    finally { pendingRef.current = false; if (mounted.current) setPending(false); }
  };
  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    if (locked || profileUnchanged) return;
    if (!validDate(profile.effectiveFrom)) { setError(m('rangeInvalid')); return; }
    if (profileChanged && !window.confirm(t('replaceRecordChanged'))) return;
    if (!window.confirm(t('profileConfirm'))) return;
    void run(() => onProfile(profile, state.revision), () => { setProfileBase(JSON.stringify(profile)); setProfileSnapshots(value => ({ ...value, [profile.effectiveFrom]: JSON.stringify(profile) })); });
  };
  const saveOverride = (event: FormEvent) => {
    event.preventDefault();
    if (locked || overrideUnchanged) return;
    if (!validDate(override.date) || (overrideName !== null && (!overrideName || overrideName.length > 160))) { setError(m('invalidHoliday')); return; }
    if (overrideChanged && !window.confirm(t('replaceRecordChanged'))) return;
    if (!window.confirm(t('overrideConfirm'))) return;
    void run(() => onOverride({ date: override.date, name: overrideName }, state.revision), () => { setOverrideBase(JSON.stringify(override)); setOverrideSnapshots(value => ({ ...value, [override.date]: JSON.stringify({ date: override.date, name: overrideName }) })); });
  };
  return <section className="holiday-settings" aria-label={t('holidays')}>
    <h3>{t('holidays')}</h3><p className="muted small">{t('holidayHelp')}</p>
    <form onSubmit={saveProfile}><fieldset disabled={locked}><div className="holiday-profile-fields"><label className="field">{t('effectiveFrom')}<input type="date" required value={profile.effectiveFrom} onChange={e => { setProfile({ ...profile, effectiveFrom: e.target.value }); setSaved(false); }} /></label><label className="field">{t('region')}<select value={profile.region ?? ''} onChange={e => { setProfile({ ...profile, region: e.target.value ? e.target.value as GermanState : null }); setSaved(false); }}><option value="">{t('disabled')}</option>{GERMAN_STATES.map(region => <option key={region} value={region}>{regionLabel(region)}</option>)}</select></label></div><div className="dialog-actions compact"><button type="submit" className="button secondary" disabled={profileUnchanged}>{t('saveProfile')}</button></div></fieldset></form>
    <p className="muted small">{t('holidayLocal')}</p>
    <ul className="holiday-rules">{[...(state.holidayProfiles ?? [])].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)).map(item => <li key={item.id}><span><strong>{shortDate(item.effectiveFrom)}</strong><small>{item.region ? regionLabel(item.region) : t('disabled')}</small></span><div><button type="button" className="button quiet" disabled={locked} onClick={() => { if (!profileDirty || window.confirm(t('discard'))) { const value = { effectiveFrom: item.effectiveFrom, region: item.region }; setProfile(value); setProfileBase(JSON.stringify(value)); setError(''); } }}>{t('edit')}</button><button type="button" className="button quiet danger-text" disabled={locked} onClick={() => { if (window.confirm(t('deleteProfileConfirm'))) void run(() => onDeleteProfile(item.id, state.revision)); }}>{t('delete')}</button></div></li>)}</ul>
    {!state.holidayProfiles?.length && <p className="muted small">{t('rulesEmpty')}</p>}
    {historicalReview && <div className="hours-account-notice" role="status"><p>{t('historicalHolidayReview')}</p>
      <button type="button" className="button secondary" disabled={locked} onClick={() => {
        if (overrideDirty && !window.confirm(t('discard'))) return;
        setOverride({ date: '1992-06-07', mode: 'add', name: language === 'de' ? 'Pfingstsonntag' : 'Whit Sunday' });
        window.setTimeout(() => document.querySelector<HTMLInputElement>('.holiday-name input')?.focus(), 0);
      }}>{t('reviewHistoricalHoliday')}</button></div>}
    <div className="holiday-exceptions"><h4>{t('exceptions')}</h4><form onSubmit={saveOverride}><fieldset disabled={locked}><div className="holiday-profile-fields"><label className="field">{t('date')}<input type="date" required value={override.date} onChange={e => { setOverride({ ...override, date: e.target.value }); setSaved(false); }} /></label><label className="field">{t('overrideAction')}<select value={override.mode} onChange={e => { setOverride({ ...override, mode: e.target.value as 'add' | 'exclude' }); setSaved(false); }}><option value="add">{t('addHoliday')}</option><option value="exclude">{t('excludeHoliday')}</option></select></label></div>
      {override.mode === 'add' && <label className="field holiday-name">{t('holidayName')}<input required maxLength={160} value={override.name} onChange={e => { setOverride({ ...override, name: e.target.value }); setSaved(false); }} /></label>}
      <p className="muted small">{t('currentHoliday', { name: currentHoliday ? language === 'en' ? currentHoliday.nameEn : currentHoliday.name : t('noHoliday') })}</p>
      <div className="dialog-actions compact"><button type="submit" className="button secondary" disabled={overrideUnchanged}>{t('saveOverride')}</button>{existingOverride && <button type="button" className="button quiet" onClick={() => { if (window.confirm(t('resetConfirm'))) void run(() => onDeleteOverride(override.date, state.revision)); }}>{t('reset')}</button>}</div>
    </fieldset></form>
    <ul className="holiday-rules">{[...(state.holidayOverrides ?? [])].sort((a, b) => a.date.localeCompare(b.date)).map(item => <li key={item.date}><span><strong>{shortDate(item.date)}</strong><small>{item.name ?? t('excludedHoliday')}</small></span><div><button type="button" className="button quiet" disabled={locked} onClick={() => { if (!overrideDirty || window.confirm(t('discard'))) { const value = { date: item.date, mode: item.name === null ? 'exclude' as const : 'add' as const, name: item.name ?? '' }; setOverride(value); setOverrideBase(JSON.stringify(value)); setError(''); } }}>{t('edit')}</button><button type="button" className="button quiet danger-text" disabled={locked} onClick={() => { if (window.confirm(t('resetConfirm'))) void run(() => onDeleteOverride(item.date, state.revision)); }}>{t('reset')}</button></div></li>)}</ul>
    {!state.holidayOverrides?.length && <p className="muted small">{t('overridesEmpty')}</p>}</div>
    {((profileDirty && profileChanged) || (overrideDirty && overrideChanged) || ((profileDirty || overrideDirty) && revision !== null && state.revision !== revision)) && <p className="holiday-settings-notice" role="status">{t('changed')}</p>}
    {pending && <p className="muted small" role="status">{t('saving')}</p>}{saved && <p className="positive small" role="status">{t('saved')}</p>}{error && <p className="form-error" role="alert">{text(error)}</p>}
  </section>;
}
