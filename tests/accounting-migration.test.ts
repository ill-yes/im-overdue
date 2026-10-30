import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, readState } from '../server/db.js';
import { applyBlockUndo, readUndo } from '../server/undo.js';

describe('additive accounting migration', () => {
  for (const version of [1, 2, 3]) it(`preserves data, revision and exact v${version} undo through repeated opens`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'accounting-migration-')), path = join(dir, 'db.sqlite');
    const block = { id: 'block', start: '2026-09-28T08:00:00Z', end: '2026-09-28T09:00:00Z', note: 'Note', title: 'Title', createdAt: null };
    const journal = {
      version, token: '12345678-1234-1234-1234-123456789abc', revision: 7,
      label: version === 3 ? 'Urlaub eingetragen' : 'Arbeitszeit hinzugefügt',
      blocks: version === 3 ? [] : [{ key: 'block', before: null, after: block }], weeks: [],
      ...(version === 2 ? { templates: [], recentEntries: { before: [], after: [] } } : {}),
      ...(version === 3 ? { vacations: [{ key: '2026-09-28', before: null, after: { date: '2026-09-28', fraction: 1 } }] } : {}),
    };
    const raw = JSON.stringify(journal, null, 2);
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT INTO meta VALUES ('revision','7'),('timezone','Europe/Berlin');
      CREATE TABLE blocks(id TEXT PRIMARY KEY,start TEXT NOT NULL,end TEXT NOT NULL,note TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',created_at TEXT);
      INSERT INTO blocks VALUES ('block','2026-09-28T08:00:00Z','2026-09-28T09:00:00Z','Note','Title',NULL);
      CREATE TABLE vacations(date TEXT PRIMARY KEY,fraction REAL NOT NULL);
      INSERT INTO vacations VALUES ('2026-09-28',1);`);
    legacy.prepare('INSERT INTO meta VALUES (?,?)').run('block_undo', raw); legacy.close();
    try {
      for (let i = 0; i < 2; i++) {
        const db = openDatabase(path);
        try {
          expect((db.prepare("SELECT value FROM meta WHERE key='block_undo'").get() as { value: string }).value).toBe(raw);
          const state = readState(db); expect(state.revision).toBe(7); expect(state.blocks).toEqual([block]); expect(state.vacations).toEqual([{ date: '2026-09-28', fraction: 1 }]);
          expect(state.accountOpening).toBeNull(); expect(state.accountEntries).toEqual([]); expect(state.absences).toEqual([]); expect(state.holidayProfiles).toEqual([]); expect(state.holidayOverrides).toEqual([]);
          expect(readUndo(db)?.version).toBe(version);
        } finally { db.close(); }
      }
      const db = openDatabase(path);
      try { expect(applyBlockUndo(db, readState(db), readUndo(db)!)).toBe(true); expect(version === 3 ? readState(db).vacations : readState(db).blocks).toEqual([]); }
      finally { db.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
