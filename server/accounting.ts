import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { dayAccounting, targetForDay } from '../shared/calculations.js';
import { addDays, Temporal, weekStartFor } from '../shared/time.js';
import { GERMAN_STATES, type AbsenceChange, type AccountEntryInput, type AppState, type HolidayProfile } from '../shared/types.js';
import { bumpRevision, readState, transaction, writeAbsence } from './db.js';
import { bad, body, HttpError, route } from './http.js';
import { bool, validDate } from './validation.js';
import { checkReopen, mutate, reopen, revision, UNCHANGED } from './state-changes.js';
import { clearUndo, saveAbsenceUndo } from './undo.js';

function minutes(value: unknown): number {
  if (!Number.isInteger(value) || Math.abs(Number(value)) > 1e9) throw bad('Ungültige Minuten.', 'error.account.minutes');
  return value as number;
}
function entryInput(b: Record<string, unknown>): AccountEntryInput {
  const date = validDate(b.date), amount = minutes(b.minutes);
  if (amount === 0) throw bad('Kontobuchungen benötigen eine Dauer ungleich null.', 'error.account.zero');
  if ((b.kind !== 'payout' && b.kind !== 'correction') || (b.kind === 'payout' && amount >= 0)) throw bad('Ungültige Buchungsart.', 'error.account.kind');
  if (typeof b.reason !== 'string' || !b.reason.trim() || b.reason.trim().length > 500) throw bad('Ungültige Begründung.', 'error.account.reason');
  return { date, minutes: amount, kind: b.kind, reason: b.reason.trim() };
}
function absenceInput(value: unknown): AbsenceChange[] {
  if (!Array.isArray(value) || !value.length || value.length > 366) throw bad('Ungültiger Abwesenheitsbereich.', 'error.absence.days');
  const dates = new Set<string>();
  const days = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw bad('Ungültige Abwesenheit.', 'error.absence.value');
    const date = validDate(item.date);
    if (dates.has(date)) throw bad('Doppelte Abwesenheit.', 'error.absence.days');
    dates.add(date);
    if (typeof item.sickness !== 'boolean' || ![0, 0.5, 1].includes(item.vacationFraction)) throw bad('Ungültige Abwesenheit.', 'error.absence.value');
    const c = item.compensation;
    if (c !== null && (!c || typeof c !== 'object' || Array.isArray(c) ||
      !(c.mode === 'fraction' && (c.value === 0.5 || c.value === 1) || c.mode === 'minutes' && Number.isInteger(c.value) && c.value > 0 && c.value <= 10080)))
      throw bad('Ungültiger Freizeitausgleich.', 'error.absence.value');
    return { date, sickness: item.sickness, vacationFraction: item.vacationFraction, compensation: c === null ? null : { mode: c.mode, value: c.value } } as AbsenceChange;
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (Temporal.PlainDate.from(days[0].date).until(Temporal.PlainDate.from(days[days.length - 1].date)).days >= 366) throw bad('Ungültiger Abwesenheitsbereich.', 'error.absence.days');
  return days;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only effective numerical changes invalidate a closed week's accounting. */
function holidayWeeks(before: AppState, after: AppState): string[] {
  return before.weeks.filter(week => week.status === 'closed' && Array.from({ length: 7 }, (_, index) => addDays(week.weekStart, index)).some(date => {
    const first = dayAccounting(before, date), second = dayAccounting(after, date);
    return (['actualMinutes', 'vacationMinutes', 'targetMinutes', 'balanceMinutes', 'holidayMinutes', 'sicknessMinutes',
      'compensationRequestedMinutes', 'compensationMinutes', 'uncoveredMinutes'] as const).some(key => first[key] !== second[key]);
  })).map(week => week.weekStart);
}

export function registerAccountingRoutes(app: Express, db: DatabaseSync): void {
  app.put('/api/account/opening', route((req, res) => {
    const b = body(req), input = { date: validDate(b.date), minutes: minutes(b.minutes) };
    res.json(mutate(db, b, before => {
      if (same(before.accountOpening, input)) return UNCHANGED;
      db.prepare('INSERT INTO account_opening(singleton,date,minutes) VALUES (1,?,?) ON CONFLICT(singleton) DO UPDATE SET date=excluded.date,minutes=excluded.minutes').run(input.date, input.minutes);
    }));
  }));
  for (const method of ['post', 'put'] as const) app[method](method === 'post' ? '/api/account/entries' : '/api/account/entries/:id', route((req, res) => {
    const b = body(req), input = entryInput(b);
    res.json(mutate(db, b, before => {
      const existing = method === 'put' ? before.accountEntries?.find(item => item.id === req.params.id) : undefined;
      if (method === 'put' && !existing) throw new HttpError(404, 'Buchung nicht gefunden.', 'error.account.notFound');
      if (existing && same(entryInput(existing as unknown as Record<string, unknown>), input)) return UNCHANGED;
      if (!before.accountOpening || input.date < before.accountOpening.date) throw bad('Buchung liegt vor dem Anfangssaldo.', 'error.account.opening');
      db.prepare('INSERT INTO account_entries(id,date,kind,minutes,reason) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,kind=excluded.kind,minutes=excluded.minutes,reason=excluded.reason')
        .run(existing?.id ?? randomUUID(), input.date, input.kind, input.minutes, input.reason);
    }));
  }));
  app.delete('/api/account/entries/:id', route((req, res) => {
    const b = body(req);
    res.json(mutate(db, b, before => {
      if (!before.accountEntries?.some(item => item.id === req.params.id)) throw new HttpError(404, 'Buchung nicht gefunden.', 'error.account.notFound');
      db.prepare('DELETE FROM account_entries WHERE id=?').run(req.params.id as string);
    }));
  }));
  app.put('/api/absences', route((req, res) => {
    const b = body(req), days = absenceInput(b.days), confirmed = bool(b.confirmReopen, 'confirmReopen');
    res.json(transaction(db, () => {
      revision(db, b);
      const before = readState(db);
      const existing = new Map((before.absences ?? []).map(day => [day.date, day]));
      const vacations = new Map(before.vacations.map(day => [day.date, day.fraction]));
      const changes = days.filter(day => {
        const prior = { date: day.date, sickness: existing.get(day.date)?.sickness ?? false, vacationFraction: vacations.get(day.date) ?? 0, compensation: existing.get(day.date)?.compensation ?? null };
        if (same(prior, day)) return false;
        if (targetForDay(day.date, before.profiles) === 0 && (
          day.vacationFraction > prior.vacationFraction || day.sickness && !prior.sickness || day.compensation !== null && !same(day.compensation, prior.compensation)))
          throw bad('Abwesenheit benötigt positives Soll.', 'error.absence.target');
        return true;
      });
      if (!changes.length) return before;
      reopen(db, checkReopen(before, changes.map(day => weekStartFor(day.date)), confirmed));
      const save = db.prepare('INSERT INTO vacations(date,fraction) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET fraction=excluded.fraction');
      for (const day of changes) {
        if (day.vacationFraction) save.run(day.date, day.vacationFraction);
        else db.prepare('DELETE FROM vacations WHERE date=?').run(day.date);
        writeAbsence(db, day);
      }
      bumpRevision(db);
      clearUndo(db);
      saveAbsenceUndo(db, before, readState(db));
      return readState(db);
    }));
  }));
  app.post('/api/holiday-profiles', route((req, res) => {
    const b = body(req), effectiveFrom = validDate(b.effectiveFrom), confirmed = bool(b.confirmReopen, 'confirmReopen');
    if (b.region !== null && !GERMAN_STATES.includes(b.region as never)) throw bad('Ungültiges Bundesland.', 'error.holiday.region');
    if (b.ruleVersion !== undefined && b.ruleVersion !== 1) throw bad('Ungültige Feiertagsregel.', 'error.holiday.region');
    res.json(mutate(db, b, before => {
      const existing = before.holidayProfiles?.find(profile => profile.effectiveFrom === effectiveFrom);
      if (existing && existing.region === b.region) return UNCHANGED;
      const input: HolidayProfile = { id: existing?.id ?? randomUUID(), effectiveFrom, region: b.region as HolidayProfile['region'], ruleVersion: 1 };
      const after = { ...before, holidayProfiles: [...(before.holidayProfiles ?? []).filter(profile => profile.id !== input.id), input].sort((a, z) => a.effectiveFrom.localeCompare(z.effectiveFrom)) };
      reopen(db, checkReopen(before, holidayWeeks(before, after), confirmed));
      db.prepare('INSERT INTO holiday_profiles(id,effective_from,region,rule_version) VALUES (?,?,?,1) ON CONFLICT(effective_from) DO UPDATE SET region=excluded.region,rule_version=1').run(input.id, effectiveFrom, input.region);
    }));
  }));
  app.delete('/api/holiday-profiles/:id', route((req, res) => {
    const b = body(req), confirmed = bool(b.confirmReopen, 'confirmReopen');
    res.json(mutate(db, b, before => {
      if (!before.holidayProfiles?.some(profile => profile.id === req.params.id)) throw new HttpError(404, 'Feiertagsprofil nicht gefunden.', 'error.holiday.notFound');
      const after = { ...before, holidayProfiles: before.holidayProfiles.filter(profile => profile.id !== req.params.id) };
      reopen(db, checkReopen(before, holidayWeeks(before, after), confirmed));
      db.prepare('DELETE FROM holiday_profiles WHERE id=?').run(req.params.id as string);
    }));
  }));
  for (const method of ['put', 'delete'] as const) app[method]('/api/holiday-overrides/:date', route((req, res) => {
    const b = body(req), date = validDate(req.params.date), confirmed = bool(b.confirmReopen, 'confirmReopen');
    if (method === 'put' && b.name !== null && (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 160)) throw bad('Ungültiger Feiertagsname.', 'error.holiday.name');
    const name = typeof b.name === 'string' ? b.name.trim() : null;
    res.json(mutate(db, b, before => {
      const existing = before.holidayOverrides?.find(item => item.date === date);
      if (method === 'delete' && !existing || method === 'put' && existing?.name === name) return UNCHANGED;
      const after = { ...before, holidayOverrides: [...(before.holidayOverrides ?? []).filter(item => item.date !== date), ...(method === 'put' ? [{ date, name }] : [])] };
      reopen(db, checkReopen(before, holidayWeeks(before, after), confirmed));
      if (method === 'delete') db.prepare('DELETE FROM holiday_overrides WHERE date=?').run(date);
      else db.prepare('INSERT INTO holiday_overrides(date,name) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET name=excluded.name').run(date, name);
    }));
  }));
}
