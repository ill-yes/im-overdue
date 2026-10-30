import { registerAccountingRoutes } from './accounting.js';
import { serverProblem } from '../shared/server-messages.js';
import express from 'express';
import { backup, type DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bumpRevision, readState, transaction } from './db.js';
import { analyzeImport, previewImport } from './import.js';
import { commitImport, registerDataSourceRoutes } from './data-sources.js';
import { IMPORT_MAX_BYTES } from '../shared/import-contract.js';
import { bad, body, errorHandler, HttpError, route } from './http.js';
import { requestSecurity } from './loopback-security.js';
import type { Authentication } from './auth.js';
import { allowanceDays, bool, monday, parseImportInput, reusableForBlock, validBlock, validDate, validReusable, validVacationChanges, validZone } from './validation.js';
import { checkReopen, insertTemplateIfNew, mutate, noOverlap, pushRecent, reopen, revision, segments, touchWeeks, weekKeys } from './state-changes.js';
import { NOTE_MAX_LENGTH, noteText } from '../shared/notes.js';
import { reusableKey } from '../shared/reuse.js';
import { applyBlockUndo, clearUndo, readUndo, saveBlockUndo, saveVacationUndo } from './undo.js';
import { targetForDay } from '../shared/calculations.js';
import { weekReview, weekReviewKey } from '../shared/week-review.js';
import { createTimesheetSnapshot } from '../shared/timesheet.js';
import { Temporal, minutesBetween, weekStartFor } from '../shared/time.js';

export function createApp(db: DatabaseSync, options: { origin?: string; auth?: Authentication } = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('case sensitive routing', true);
  app.set('strict routing', true);
  app.set('trust proxy', false);
  app.use(requestSecurity(options.origin));
  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  if (options.auth) {
    app.use('/api/auth', options.auth.routes);
    app.use('/api', options.auth.requireSession);
  } else {
    app.get('/api/auth/session', (_req, res) => { res.json({ required: false, authenticated: true }); });
  }
  // The JSON envelope can encode one input byte as six ASCII bytes (for example
  // a control character becomes \\u0000). Apply the larger cap only to imports.
  app.use('/api/import', express.json({ limit: IMPORT_MAX_BYTES * 6 + 64 * 1024, strict: true }));
  app.use('/api', express.json({ limit: '6mb', strict: true }));
  app.get('/api/state', (_req, res) => { res.json(readState(db)); });
  registerDataSourceRoutes(app, db);
  registerAccountingRoutes(app, db);
  app.get('/api/timesheet', route((req, res) => {
    const from = validDate(req.query.from);
    const to = validDate(req.query.to);
    const length = Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to)).days;
    if (length < 1 || length > 366) throw bad('Exportbereich muss 1 bis 366 Kalendertage umfassen.', 'error.timesheet.range');
    db.exec('BEGIN');
    try {
      const snapshot = createTimesheetSnapshot(readState(db), from, to);
      db.exec('COMMIT');
      res.json(snapshot);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }));
  app.put('/api/vacations', route((req, res) => {
    const b = body(req);
    const days = validVacationChanges(b.days);
    const confirmed = bool(b.confirmReopen, 'confirmReopen');
    const state = transaction(db, () => {
      revision(db, b);
      const before = readState(db);
      const existing = new Map(before.vacations.map(day => [day.date, day.fraction]));
      for (const day of days) {
        if (day.fraction !== null && existing.get(day.date) !== day.fraction && targetForDay(day.date, before.profiles) === 0) throw bad('Urlaub ist nur an Tagen mit positivem Soll moeglich.', 'error.vacation.target');
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
    if (typeof req.params.year !== 'string' || !/^[0-9]{4}$/.test(req.params.year) || Number(req.params.year) < 1) throw bad('Ungueltiges Urlaubsjahr.', 'error.vacation.year');
    const year = Number(req.params.year);
    const entitlementDays = allowanceDays(b.entitlementDays);
    const carryoverDays = allowanceDays(b.carryoverDays);
    const state = transaction(db, () => {
      revision(db, b);
      const before = readState(db);
      const existing = before.vacationAllowances.find(allowance => allowance.year === year);
      if (existing?.entitlementDays === entitlementDays && existing.carryoverDays === carryoverDays) return before;
      db.prepare('INSERT INTO vacation_allowances(year,entitlement_days,carryover_days) VALUES (?,?,?) ON CONFLICT(year) DO UPDATE SET entitlement_days=excluded.entitlement_days,carryover_days=excluded.carryover_days')
        .run(year, entitlementDays, carryoverDays);
      bumpRevision(db);
      clearUndo(db);
      return readState(db);
    });
    res.json(state);
  }));
  app.post('/api/templates', route((req, res) => {
    const b = body(req);
    const input = validReusable(b);
    const state = transaction(db, () => {
      revision(db, b);
      const before = readState(db);
      if (before.templates.some(template => reusableKey(template) === reusableKey(input))) return before;
      db.prepare('INSERT INTO templates(id,title,note,duration_minutes) VALUES (?,?,?,?)')
        .run(randomUUID(), input.title, input.note, input.durationMinutes);
      bumpRevision(db);
      clearUndo(db);
      return readState(db);
    });
    res.json(state);
  }));
  app.put('/api/templates/:id', route((req, res) => {
    const b = body(req);
    const input = validReusable(b);
    const state = transaction(db, () => {
      revision(db, b);
      const before = readState(db);
      const existing = before.templates.find(template => template.id === req.params.id);
      if (!existing) throw new HttpError(404, 'Vorlage nicht gefunden.', 'error.template.notFound');
      if (reusableKey(existing) === reusableKey(input)) return before;
      if (before.templates.some(template => template.id !== existing.id && reusableKey(template) === reusableKey(input)))
        throw new HttpError(409, 'Vorlage existiert bereits.', 'error.template.duplicate', 'TEMPLATE_DUPLICATE');
      db.prepare('UPDATE templates SET title=?,note=?,duration_minutes=? WHERE id=?')
        .run(input.title, input.note, input.durationMinutes, existing.id);
      bumpRevision(db);
      clearUndo(db);
      return readState(db);
    });
    res.json(state);
  }));
  app.delete('/api/templates/:id', route((req, res) => {
    const b = body(req);
    const state = transaction(db, () => {
      revision(db, b);
      const before = readState(db);
      if (!before.templates.some(template => template.id === req.params.id)) throw new HttpError(404, 'Vorlage nicht gefunden.', 'error.template.notFound');
      db.prepare('DELETE FROM templates WHERE id=?').run(req.params.id as string);
      bumpRevision(db);
      clearUndo(db);
      return readState(db);
    });
    res.json(state);
  }));
  app.put('/api/notes/:scope/:date', route((req, res) => {
    const b = body(req);
    const scope = req.params.scope;
    if (scope !== 'day' && scope !== 'week') throw bad('Notizbereich muss day oder week sein.', 'error.note.scope');
    const date = scope === 'week' ? monday(req.params.date) : validDate(req.params.date);
    if (typeof b.text !== 'string' || b.text.length > NOTE_MAX_LENGTH) throw bad(`Notiz muss Text mit maximal ${NOTE_MAX_LENGTH} Zeichen sein.`, 'error.validation.note', { max: NOTE_MAX_LENGTH });
    const text = b.text;
    const state = transaction(db, () => {
      revision(db, b);
      const before = readState(db);
      const previous = noteText(before.notes, scope, date);
      if ((!text.trim() && !previous) || (text.trim() && previous === text)) return before;
      if (text.trim()) {
        db.prepare('INSERT INTO notes(scope,date,text) VALUES (?,?,?) ON CONFLICT(scope,date) DO UPDATE SET text=excluded.text').run(scope, date, text);
      } else {
        db.prepare('DELETE FROM notes WHERE scope=? AND date=?').run(scope, date);
      }
      bumpRevision(db);
      clearUndo(db);
      return readState(db);
    });
    res.json(state);
  }));
  app.get('/api/backup', route(async (_req, res) => {
    const dir = await mkdtemp(join(tmpdir(), 'im-overdue-backup-'));
    const path = join(dir, 'im-overdue.sqlite');
    try {
      await backup(db, path);
      const bytes = await readFile(path);
      res.setHeader('Content-Type', 'application/vnd.sqlite3');
      res.setHeader('Content-Disposition', 'attachment; filename="im-overdue.sqlite"');
      res.setHeader('Cache-Control', 'no-store');
      res.send(bytes);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }));
  app.post('/api/blocks', route((req, res) => {
    const b = body(req);
    const input = validBlock(b);
    const state = mutate(db, b, old => {
      const title = input.title ?? '';
      const pieces = segments(input, old.settings.timezone);
      const reusable = input.rememberTemplate ? reusableForBlock(input, title) : null;
      noOverlap(old, pieces);
      const weeks = pieces.flatMap(p => weekKeys(p, old.settings.timezone));
      reopen(db, checkReopen(old, weeks, bool(b.confirmReopen, 'confirmReopen')));
      const createdAt = new Date().toISOString();
      const stmt = db.prepare('INSERT INTO blocks(id,start,end,note,title,created_at) VALUES (?,?,?,?,?,?)');
      pieces.forEach(p => stmt.run(randomUUID(), p.start, p.end, p.note, title, createdAt));
      touchWeeks(db, weeks);
      pushRecent(db, old, { title, note: input.note, durationMinutes: minutesBetween(input.start, input.end) }, createdAt);
      if (reusable) insertTemplateIfNew(db, old, reusable);
    }, 'Arbeitszeit hinzugefügt');
    res.json(state);
  }));
  app.put('/api/blocks/:id', route((req, res) => {
    const b = body(req);
    const input = validBlock(b);
    const state = transaction(db, () => {
      revision(db, b);
      const old = readState(db);
      const before = old.blocks.find(x => x.id === req.params.id);
      if (!before) throw new HttpError(404, 'Arbeitsblock nicht gefunden.', 'error.block.notFound');
      const title = input.title ?? before.title;
      const reusable = input.rememberTemplate ? reusableForBlock(input, title) : null;
      if (Temporal.Instant.compare(input.start, before.start) === 0 && Temporal.Instant.compare(input.end, before.end) === 0 &&
        title === before.title && input.note === before.note) {
        if (!reusable || old.templates.some(template => reusableKey(template) === reusableKey(reusable))) return old;
        insertTemplateIfNew(db, old, reusable);
        bumpRevision(db);
        clearUndo(db);
        return readState(db);
      }
      const pieces = segments(input, old.settings.timezone);
      noOverlap(old, pieces, before.id);
      const weeks = [...weekKeys(before, old.settings.timezone), ...pieces.flatMap(p => weekKeys(p, old.settings.timezone))];
      reopen(db, checkReopen(old, weeks, bool(b.confirmReopen, 'confirmReopen')));
      db.prepare('DELETE FROM blocks WHERE id=?').run(before.id);
      const stmt = db.prepare('INSERT INTO blocks(id,start,end,note,title,created_at) VALUES (?,?,?,?,?,?)');
      pieces.forEach((p, i) => stmt.run(i === 0 ? before.id : randomUUID(), p.start, p.end, p.note, title, before.createdAt));
      touchWeeks(db, weeks);
      if (reusable) insertTemplateIfNew(db, old, reusable);
      bumpRevision(db);
      clearUndo(db);
      saveBlockUndo(db, old, readState(db), 'Arbeitszeit geändert');
      return readState(db);
    });
    res.json(state);
  }));
  app.delete('/api/blocks/:id', route((req, res) => {
    const b = body(req);
    const state = mutate(db, b, old => {
      const before = old.blocks.find(x => x.id === req.params.id);
      if (!before) throw new HttpError(404, 'Arbeitsblock nicht gefunden.', 'error.block.notFound');
      const weeks = weekKeys(before, old.settings.timezone);
      reopen(db, checkReopen(old, weeks, bool(b.confirmReopen, 'confirmReopen')));
      db.prepare('DELETE FROM blocks WHERE id=?').run(before.id);
      touchWeeks(db, weeks);
    }, 'Arbeitszeit gelöscht');
    res.json(state);
  }));
  app.post('/api/blocks/undo', route((req, res) => {
    const b = body(req);
    if (typeof b.token !== 'string' || !b.token) throw bad('Undo-Token fehlt.', 'error.undo.token');
    const state = transaction(db, () => {
      revision(db, b);
      const entry = readUndo(db);
      if (!entry || entry.token !== b.token) throw new HttpError(409, 'Rückgängig ist nicht mehr verfügbar.', 'error.undo.unavailable', 'UNDO_CONFLICT');
      if (!applyBlockUndo(db, readState(db), entry)) throw new HttpError(409, 'Der gespeicherte Stand hat sich geändert.', 'error.undo.changed', 'UNDO_CONFLICT');
      clearUndo(db);
      bumpRevision(db);
      return readState(db);
    });
    res.json(state);
  }));
  app.get('/api/weeks/:weekStart/review', route((req, res) => {
    res.json(weekReview(readState(db), monday(req.params.weekStart)));
  }));
  app.post('/api/weeks/:weekStart', route((req, res) => {
    const b = body(req);
    const week = monday(req.params.weekStart);
    if (!['open', 'closed'].includes(String(b.status))) throw bad('status muss open oder closed sein.', 'error.week.status');
    const confirmWarnings = bool(b.confirmWarnings, 'confirmWarnings');
    if (b.reviewKey !== undefined && (typeof b.reviewKey !== 'string' || !b.reviewKey.length || b.reviewKey.length > 20_000))
      throw bad('reviewKey muss Text mit 1 bis 20000 Zeichen sein.', 'error.week.reviewKey');
    const state = mutate(db, b, old => {
      if (b.status === 'closed') {
        const review = weekReview(old, week);
        if (b.reviewKey !== undefined && b.reviewKey !== weekReviewKey(review))
          throw new HttpError(409, 'Die Wochenpruefung hat sich geaendert. Bitte erneut pruefen.', 'error.week.reviewChanged', 'WEEK_REVIEW_REQUIRED', undefined, review);
        const current = weekStartFor(review.today);
        if (week > current) throw bad('Zukuenftige Wochen koennen nicht abgeschlossen werden.', 'error.week.future');
        if (week === current && !bool(b.confirmCurrent, 'confirmCurrent'))
          throw new HttpError(409, 'Laufende Woche mit vollem Soll abschliessen?', 'error.week.current', 'CURRENT_WEEK_CONFIRM_REQUIRED');
        if (review.warnings.length && !confirmWarnings)
          throw new HttpError(409, 'Bitte Hinweise vor dem Wochenabschluss bestaetigen.', 'error.week.warnings', 'WEEK_REVIEW_REQUIRED', undefined, review);
      }
      db.prepare('INSERT INTO weeks(week_start,status) VALUES (?,?) ON CONFLICT(week_start) DO UPDATE SET status=excluded.status').run(week, b.status as string);
    });
    res.json(state);
  }));
  app.put('/api/settings', route((req, res) => {
    const b = body(req);
    const zone = validZone(b.timezone);
    const state = mutate(db, b, old => {
      if (zone === old.settings.timezone) return;
      const touched = [...old.weeks.map(w => w.weekStart), ...old.blocks.flatMap(x => [...weekKeys(x, old.settings.timezone), ...weekKeys(x, zone)])];
      reopen(db, checkReopen(old, touched, bool(b.confirmReopen, 'confirmReopen')));
      db.prepare("UPDATE meta SET value=? WHERE key='timezone'").run(zone);
      const insert = db.prepare('INSERT INTO blocks(id,start,end,note,title,created_at) VALUES (?,?,?,?,?,?)');
      for (const block of old.blocks) {
        const parts = segments(block, zone);
        if (parts.length === 1) continue;
        db.prepare('DELETE FROM blocks WHERE id=?').run(block.id);
        parts.forEach((part, i) => insert.run(i === 0 ? block.id : randomUUID(), part.start, part.end, part.note, block.title, block.createdAt));
      }
      touchWeeks(db, touched);
    });
    res.json(state);
  }));
  app.post('/api/profiles', route((req, res) => {
    const b = body(req);
    const effective = b.effectiveFrom === null ? null : monday(b.effectiveFrom);
    if (!Number.isInteger(b.weeklyMinutes) || (b.weeklyMinutes as number) < 0 || (b.weeklyMinutes as number) > 10080) throw bad('weeklyMinutes muss zwischen 0 und 10080 liegen.', 'error.validation.weeklyMinutes');
    if (!Array.isArray(b.workdays) || b.workdays.length < 1 || b.workdays.length > 7 ||
      b.workdays.some(x => !Number.isInteger(x) || x < 1 || x > 7) || new Set(b.workdays).size !== b.workdays.length) throw bad('workdays muss eindeutige Wochentage 1 bis 7 enthalten.', 'error.validation.workdays');
    const state = mutate(db, b, old => {
      const next = old.profiles.filter(p => p.effectiveFrom !== null && (effective === null || p.effectiveFrom > effective))
        .sort((a, z) => a.effectiveFrom!.localeCompare(z.effectiveFrom!))[0]?.effectiveFrom;
      const affected = old.weeks.filter(w => (effective === null || w.weekStart >= effective) && (!next || w.weekStart < next)).map(w => w.weekStart);
      reopen(db, checkReopen(old, affected, bool(b.confirmReopen, 'confirmReopen')));
      const existing = old.profiles.find(p => p.effectiveFrom === effective);
      if (existing) db.prepare('UPDATE profiles SET weekly_minutes=?,workdays=? WHERE id=?').run(b.weeklyMinutes as number, JSON.stringify(b.workdays), existing.id);
      else db.prepare('INSERT INTO profiles(id,effective_from,weekly_minutes,workdays) VALUES (?,?,?,?)').run(randomUUID(), effective, b.weeklyMinutes as number, JSON.stringify(b.workdays));
    });
    res.json(state);
  }));
  app.post('/api/import/analyze', route((req, res) => {
    res.json(analyzeImport(parseImportInput(body(req))));
  }));
  app.post('/api/import/preview', route((req, res) => {
    const input = parseImportInput(body(req));
    const old = readState(db);
    res.json(previewImport(input, old.activities, old.revision, old.dataSources));
  }));
  app.post('/api/import/commit', route((req, res) => {
    const b = body(req);
    const input = parseImportInput(b);
    const state = transaction(db, () => {
      revision(db, b);
      return commitImport(db, input);
    });
    res.json(state);
  }));
  app.use('/api', (_req, res) => { res.status(404).json(serverProblem('API-Endpunkt nicht gefunden.', 'error.http.notFound')); });
  app.use(errorHandler);
  return app;
}
