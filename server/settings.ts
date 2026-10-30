import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { bad, body, route } from './http.js';
import { bool, monday, validZone } from './validation.js';
import { checkReopen, mutate, reopen, segments, touchWeeks, weekKeys } from './state-changes.js';

/** Time zone and working-time profiles. */
export function registerSettingsRoutes(app: Express, db: DatabaseSync): void {
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
}
