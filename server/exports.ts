import type { Express } from 'express';
import { backup, type DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState } from './db.js';
import { bad, route } from './http.js';
import { validDate } from './validation.js';
import { createTimesheetSnapshot } from '../shared/timesheet.js';
import { Temporal } from '../shared/time.js';

/** Timesheet snapshots and SQLite backups. */
export function registerExportRoutes(app: Express, db: DatabaseSync): void {
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
}
