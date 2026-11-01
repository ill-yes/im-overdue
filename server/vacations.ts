import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { bumpRevision, readState, transaction } from './db.js';
import { bad, body, route } from './http.js';
import { allowanceDays, bool, validVacationChanges } from './validation.js';
import { checkReopen, mutate, reopen, revision, UNCHANGED } from './state-changes.js';
import { clearUndo, saveVacationUndo } from './undo.js';
import { targetForDay } from '../shared/calculations.js';
import { weekStartFor } from '../shared/time.js';

/** Vacation days and yearly allowances. */
export function registerVacationRoutes(app: Express, db: DatabaseSync): void {
  app.put('/api/vacations', route((req, res) => {
    const b = body(req);
    const days = validVacationChanges(b.days);
    const confirmed = bool(b.confirmReopen, 'confirmReopen');
    const state = transaction(db, () => {
      revision(db, b);
      const before = readState(db);
      const existing = new Map(before.vacations.map(day => [day.date, day.fraction]));
      for (const day of days) {
        if (day.fraction !== null && existing.get(day.date) !== day.fraction && targetForDay(day.date, before.profiles) === 0) throw bad('error.vacation.target');
      }
      const changes = days.filter(day => (existing.get(day.date) ?? null) !== day.fraction);
      if (!changes.length) return before;
      reopen(db, checkReopen(before, changes.map(day => weekStartFor(day.date)), confirmed));
      const upsert = db.prepare('INSERT INTO vacations(date,fraction) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET fraction=excluded.fraction');
      const remove = db.prepare('DELETE FROM vacations WHERE date=?');
      changes.forEach(day => { if (day.fraction === null) remove.run(day.date); else upsert.run(day.date, day.fraction); });
      bumpRevision(db);
      clearUndo(db);
      const label = changes.every(day => day.fraction === null) ? 'Urlaub entfernt' : changes.every(day => !existing.has(day.date)) ? 'Urlaub eingetragen' : 'Urlaub geändert';
      saveVacationUndo(db, before, readState(db), label);
      return readState(db);
    });
    res.json(state);
  }));
  app.put('/api/vacation-allowances/:year', route((req, res) => {
    const b = body(req);
    if (typeof req.params.year !== 'string' || !/^[0-9]{4}$/.test(req.params.year) || Number(req.params.year) < 1) throw bad('error.vacation.year');
    const year = Number(req.params.year);
    const entitlementDays = allowanceDays(b.entitlementDays);
    const carryoverDays = allowanceDays(b.carryoverDays);
    const state = mutate(db, b, before => {
      const existing = before.vacationAllowances.find(allowance => allowance.year === year);
      if (existing?.entitlementDays === entitlementDays && existing.carryoverDays === carryoverDays) return UNCHANGED;
      db.prepare('INSERT INTO vacation_allowances(year,entitlement_days,carryover_days) VALUES (?,?,?) ON CONFLICT(year) DO UPDATE SET entitlement_days=excluded.entitlement_days,carryover_days=excluded.carryover_days')
        .run(year, entitlementDays, carryoverDays);
    });
    res.json(state);
  }));
}
