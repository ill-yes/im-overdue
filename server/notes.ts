import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { bad, body, route } from './http.js';
import { monday, validDate } from './validation.js';
import { mutate, UNCHANGED } from './state-changes.js';
import { NOTE_MAX_LENGTH, noteText } from '../shared/notes.js';

/** Day and week notes. */
export function registerNoteRoutes(app: Express, db: DatabaseSync): void {
  app.put('/api/notes/:scope/:date', route((req, res) => {
    const b = body(req);
    const scope = req.params.scope;
    if (scope !== 'day' && scope !== 'week') throw bad('Notizbereich muss day oder week sein.', 'error.note.scope');
    const date = scope === 'week' ? monday(req.params.date) : validDate(req.params.date);
    if (typeof b.text !== 'string' || b.text.length > NOTE_MAX_LENGTH) throw bad(`Notiz muss Text mit maximal ${NOTE_MAX_LENGTH} Zeichen sein.`, 'error.validation.note', { max: NOTE_MAX_LENGTH });
    const text = b.text;
    const state = mutate(db, b, before => {
      const previous = noteText(before.notes, scope, date);
      if ((!text.trim() && !previous) || (text.trim() && previous === text)) return UNCHANGED;
      if (text.trim()) {
        db.prepare('INSERT INTO notes(scope,date,text) VALUES (?,?,?) ON CONFLICT(scope,date) DO UPDATE SET text=excluded.text').run(scope, date, text);
      } else {
        db.prepare('DELETE FROM notes WHERE scope=? AND date=?').run(scope, date);
      }
    });
    res.json(state);
  }));
}
