import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { bumpRevision, readState, transaction } from './db.js';
import { bad, body, HttpError, route } from './http.js';
import { bool, reusableForBlock, validBlock } from './validation.js';
import { checkReopen, insertTemplateIfNew, mutate, noOverlap, pushRecent, reopen, revision, segments, touchWeeks, weekKeys } from './state-changes.js';
import { reusableKey } from '../shared/reuse.js';
import { applyBlockUndo, clearUndo, readUndo, saveBlockUndo } from './undo.js';
import { Temporal, minutesBetween } from '../shared/time.js';

/** Work blocks and their Undo. */
export function registerBlockRoutes(app: Express, db: DatabaseSync): void {
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
}
