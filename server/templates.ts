import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { body, HttpError, route } from './http.js';
import { validReusable } from './validation.js';
import { mutate, UNCHANGED } from './state-changes.js';
import { reusableKey } from '../shared/reuse.js';

/** Reusable work templates. */
export function registerTemplateRoutes(app: Express, db: DatabaseSync): void {
  app.post('/api/templates', route((req, res) => {
    const b = body(req);
    const input = validReusable(b);
    const state = mutate(db, b, before => {
      if (before.templates.some(template => reusableKey(template) === reusableKey(input))) return UNCHANGED;
      db.prepare('INSERT INTO templates(id,title,note,duration_minutes) VALUES (?,?,?,?)')
        .run(randomUUID(), input.title, input.note, input.durationMinutes);
    });
    res.json(state);
  }));
  app.put('/api/templates/:id', route((req, res) => {
    const b = body(req);
    const input = validReusable(b);
    const state = mutate(db, b, before => {
      const existing = before.templates.find(template => template.id === req.params.id);
      if (!existing) throw new HttpError(404, 'error.template.notFound');
      if (reusableKey(existing) === reusableKey(input)) return UNCHANGED;
      if (before.templates.some(template => template.id !== existing.id && reusableKey(template) === reusableKey(input)))
        throw new HttpError(409, 'error.template.duplicate', 'TEMPLATE_DUPLICATE');
      db.prepare('UPDATE templates SET title=?,note=?,duration_minutes=? WHERE id=?')
        .run(input.title, input.note, input.durationMinutes, existing.id);
    });
    res.json(state);
  }));
  app.delete('/api/templates/:id', route((req, res) => {
    const b = body(req);
    const state = mutate(db, b, before => {
      if (!before.templates.some(template => template.id === req.params.id)) throw new HttpError(404, 'error.template.notFound');
      db.prepare('DELETE FROM templates WHERE id=?').run(req.params.id as string);
    });
    res.json(state);
  }));
}
