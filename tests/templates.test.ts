import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { openDatabase, readState } from '../server/db.js';
import { Temporal, minutesBetween } from '../shared/time.js';
import { REUSABLE_DURATION_MAX_MINUTES, REUSABLE_NOTE_MAX_LENGTH } from '../shared/reuse.js';
import type { AppState } from '../shared/types.js';

let dir: string;
let db: DatabaseSync;
let server: Server;
let base: string;
async function serve() {
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No address');
  base = `http://127.0.0.1:${address.port}`;
}
async function api(path: string, method = 'GET', data?: object, origin = base) {
  return fetch(`${base}${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
}
async function state(): Promise<AppState> { return await (await api('/api/state')).json() as AppState; }
const entry = { title: '  Projekt A  ', note: '  Planung  ', durationMinutes: 90 };
const block = (expectedRevision: number, extra: object = {}) => ({ expectedRevision,
  start: '2026-09-28T08:00:00+02:00', end: '2026-09-28T09:30:00+02:00', note: 'Planung', ...extra });
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'overdue-templates-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  await serve();
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('templates and recent work', () => {
  it('normalizes, deduplicates, renames and deletes templates with revision and origin guards', async () => {
    expect((await api('/api/templates', 'POST', { expectedRevision: 0, ...entry }, 'http://evil.example')).status).toBe(403);
    expect((await api('/api/templates', 'POST', { expectedRevision: 0, title: '', note: '', durationMinutes: 90 })).status).toBe(400);
    const first = await api('/api/templates', 'POST', { expectedRevision: 0, ...entry });
    expect(first.status).toBe(200);
    const created = await first.json() as AppState;
    expect(created.templates).toMatchObject([{ title: 'Projekt A', note: 'Planung', durationMinutes: 90 }]);
    const id = created.templates[0].id;
    expect((await api('/api/templates', 'POST', { expectedRevision: 1, title: 'Projekt A', note: 'Planung', durationMinutes: 90 })).status).toBe(200);
    expect((await state()).revision).toBe(1);
    expect((await api('/api/templates', 'POST', { expectedRevision: 0, ...entry })).status).toBe(409);
    const second = await api('/api/templates', 'POST', { expectedRevision: 1, title: 'Projekt B', note: 'Planung', durationMinutes: 90 });
    expect(second.status).toBe(200);
    const other = (await second.json() as AppState).templates[1].id;
    const duplicate = await api(`/api/templates/${other}`, 'PUT', { expectedRevision: 2, title: 'Projekt A', note: 'Planung', durationMinutes: 90 });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).code).toBe('TEMPLATE_DUPLICATE');
    expect((await state()).revision).toBe(2);
    const renamed = await api(`/api/templates/${id}`, 'PUT', { expectedRevision: 2, title: 'Projekt C', note: 'Planung', durationMinutes: 90 });
    expect(renamed.status).toBe(200);
    expect((await renamed.json() as AppState).templates[0].id).toBe(id);
    expect((await api(`/api/templates/${id}`, 'DELETE', { expectedRevision: 3 })).status).toBe(200);
    expect((await state()).templates.map(x => x.id)).toEqual([other]);
  });

  it('enforces the shared 2000-character note limit on template create and update', async () => {
    const valid = 'n'.repeat(REUSABLE_NOTE_MAX_LENGTH);
    const invalid = `${valid}n`;
    expect((await api('/api/templates', 'POST', { expectedRevision: 0, title: 'Too long', note: invalid, durationMinutes: 60 })).status).toBe(400);
    const created = await api('/api/templates', 'POST', { expectedRevision: 0, title: 'Accepted', note: valid, durationMinutes: 60 });
    expect(created.status).toBe(200);
    const id = (await created.json() as AppState).templates[0].id;
    expect((await api(`/api/templates/${id}`, 'PUT', { expectedRevision: 1, title: 'Rejected', note: invalid, durationMinutes: 60 })).status).toBe(400);
    const updated = await api(`/api/templates/${id}`, 'PUT', { expectedRevision: 1, title: 'Updated', note: valid, durationMinutes: 60 });
    expect(updated.status).toBe(200);
    expect((await updated.json() as AppState).templates[0]).toMatchObject({ title: 'Updated', note: valid });
  });

  it('accepts seven local days across the Troll offset shift and retains an undoable ordinary save', async () => {
    expect(REUSABLE_DURATION_MAX_MINUTES).toBeGreaterThanOrEqual(10200);
    expect((await api('/api/settings', 'PUT', { expectedRevision: 0, timezone: 'Antarctica/Troll' })).status).toBe(200);
    const start = Temporal.PlainDateTime.from('2026-10-22T12:00').toZonedDateTime('Antarctica/Troll').toInstant().toString();
    const end = Temporal.PlainDateTime.from('2026-10-29T12:00').toZonedDateTime('Antarctica/Troll').toInstant().toString();
    expect(minutesBetween(start, end)).toBe(10200);
    const longResponse = await api('/api/blocks', 'POST', {
      expectedRevision: 1, start, end, title: 'Troll shift', note: 'Seven local days', rememberTemplate: true,
    });
    expect(longResponse.status).toBe(200);
    const long = await longResponse.json() as AppState;
    expect(long.templates).toMatchObject([{ durationMinutes: 10200 }]);
    expect(long.recentEntries).toMatchObject([{ durationMinutes: 10200 }]);
    expect(long.undo).not.toBeNull();
    const ordinary = await api('/api/blocks', 'POST', {
      expectedRevision: 2, start: '2026-11-05T12:00:00Z', end: '2026-11-05T13:00:00Z', note: 'Other', title: 'Other',
    });
    expect(ordinary.status).toBe(200);
    const after = await ordinary.json() as AppState;
    expect(after.undo).not.toBeNull();
    const undone = await api('/api/blocks/undo', 'POST', { expectedRevision: 3, token: after.undo!.token });
    expect(undone.status).toBe(200);
    const restored = await undone.json() as AppState;
    expect(restored.blocks).toEqual(long.blocks);
    expect(restored.templates).toEqual(long.templates);
    expect(restored.recentEntries).toEqual(long.recentEntries);
  });

  it('combines overnight creation, reusable whole duration, recents, and undo in one revision', async () => {
    const input = { expectedRevision: 0, start: '2026-10-04T22:00:00+02:00', end: '2026-10-05T02:00:00+02:00',
      note: '  Planung  ', title: '  Projekt A  ', rememberTemplate: true };
    const createdResponse = await api('/api/blocks', 'POST', input);
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json() as AppState;
    expect(created.revision).toBe(1);
    expect(created.blocks).toHaveLength(2);
    expect(new Set(created.blocks.map(x => x.createdAt)).size).toBe(1);
    expect(created.blocks.every(x => x.title === 'Projekt A')).toBe(true);
    expect(created.templates).toMatchObject([{ title: 'Projekt A', note: 'Planung', durationMinutes: 240 }]);
    expect(created.recentEntries).toMatchObject([{ title: 'Projekt A', note: 'Planung', durationMinutes: 240 }]);
    expect(created.undo).not.toBeNull();
    const undone = await api('/api/blocks/undo', 'POST', { expectedRevision: 1, token: created.undo!.token });
    expect(undone.status).toBe(200);
    const restored = await undone.json() as AppState;
    expect(restored.blocks).toEqual([]);
    expect(restored.templates).toEqual([]);
    expect(restored.recentEntries).toEqual([]);
    expect(restored.weeks).toEqual([]);
    expect(restored.revision).toBe(2);
  });

  it('checks library after-state before undo and keeps undo on template no-op', async () => {
    const created = await (await api('/api/blocks', 'POST', block(0, { title: 'Remember', rememberTemplate: true }))).json() as AppState;
    const same = await api('/api/templates', 'POST', { expectedRevision: 1, title: 'Remember', note: 'Planung', durationMinutes: 90 });
    expect(same.status).toBe(200);
    expect((await same.json() as AppState).undo).toEqual(created.undo);
    db.prepare('UPDATE templates SET note=? WHERE id=?').run('external', created.templates[0].id);
    const failed = await api('/api/blocks/undo', 'POST', { expectedRevision: 1, token: created.undo!.token });
    expect(failed.status).toBe(409);
    expect((await state()).revision).toBe(1);
    expect((await state()).blocks).toEqual(created.blocks);
  });

  it('keeps failed combined creation atomic and existing block name on legacy update', async () => {
    const first = await api('/api/blocks', 'POST', block(0, { title: 'Original' }));
    const created = await first.json() as AppState;
    const id = created.blocks[0].id;
    const overlap = await api('/api/blocks', 'POST', block(1, { title: 'Other', rememberTemplate: true }));
    expect(overlap.status).toBe(409);
    expect((await state()).templates).toEqual([]);
    expect((await state()).recentEntries).toHaveLength(1);
    const updated = await api(`/api/blocks/${id}`, 'PUT', block(1, { note: 'Changed' }));
    expect(updated.status).toBe(200);
    const after = await updated.json() as AppState;
    expect(after.blocks[0].title).toBe('Original');
    expect(after.blocks[0].createdAt).toBe(created.blocks[0].createdAt);
    expect(after.recentEntries).toEqual(created.recentEntries);
  });

  it('preserves name and creation time during timezone resplit and leaves recents unchanged on edit', async () => {
    const created = await (await api('/api/blocks', 'POST', {
      expectedRevision: 0, start: '2026-09-28T23:00:00Z', end: '2026-09-29T01:00:00Z', note: 'Night', title: 'Night work',
    })).json() as AppState;
    expect(created.blocks).toHaveLength(1);
    const zone = await api('/api/settings', 'PUT', { expectedRevision: 1, timezone: 'UTC' });
    expect(zone.status).toBe(200);
    const after = await zone.json() as AppState;
    expect(after.blocks).toHaveLength(2);
    expect(after.blocks.every(x => x.title === 'Night work' && x.createdAt === created.blocks[0].createdAt)).toBe(true);
    expect(after.recentEntries).toEqual(created.recentEntries);
  });

  it('clears block undo only for an actual standalone template change', async () => {
    const created = await (await api('/api/blocks', 'POST', block(0))).json() as AppState;
    const template = await api('/api/templates', 'POST', { expectedRevision: 1, ...entry });
    expect(template.status).toBe(200);
    const after = await template.json() as AppState;
    expect(after.undo).toBeNull();
    const same = await api('/api/templates', 'POST', { expectedRevision: 2, ...entry });
    expect((await same.json() as AppState).revision).toBe(2);
    expect((await api('/api/blocks/undo', 'POST', { expectedRevision: 2, token: created.undo!.token })).status).toBe(409);
  });

  it('persists template and recent data through backup and process restart', async () => {
    const created = await api('/api/blocks', 'POST', block(0, { title: 'Backup', rememberTemplate: true }));
    expect(created.status).toBe(200);
    const original = await state();
    writeFileSync(join(dir, 'backup.sqlite'), Buffer.from(await (await api('/api/backup')).arrayBuffer()));
    const backupDb = openDatabase(join(dir, 'backup.sqlite'));
    expect(readState(backupDb)).toEqual(original);
    backupDb.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    db = openDatabase(join(dir, 'db.sqlite'));
    await serve();
    expect(await state()).toEqual(original);
  });

  it('roundtrips an undo journal larger than 512 KiB with maximally escaped notes', async () => {
    const note = '\u0000'.repeat(REUSABLE_NOTE_MAX_LENGTH);
    for (let index = 0; index < 19; index++) {
      const date = new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10);
      const result = await api('/api/blocks', 'POST', {
        expectedRevision: index, start: `${date}T08:00:00Z`, end: `${date}T09:00:00Z`, title: `Entry ${index}`, note,
      });
      expect(result.status).toBe(200);
    }
    const long = await api('/api/blocks', 'POST', {
      expectedRevision: 19, start: '2026-10-22T12:00:00Z', end: '2026-10-29T12:00:00Z',
      title: 'Long escaped', note, rememberTemplate: true,
    });
    expect(long.status).toBe(200);
    const after = await long.json() as AppState;
    const journal = db.prepare("SELECT value FROM meta WHERE key='block_undo'").get() as { value: string };
    expect(journal.value.length).toBeGreaterThan(512 * 1024);
    expect(after.undo).not.toBeNull();
    const result = await api('/api/blocks/undo', 'POST', { expectedRevision: 20, token: after.undo!.token });
    expect(result.status).toBe(200);
    const restored = await result.json() as AppState;
    expect(restored.blocks).toHaveLength(19);
    expect(restored.templates).toEqual([]);
    expect(restored.recentEntries).toHaveLength(19);
  });

  it('keeps only twenty distinct recent entries, ordered by successful creation', async () => {
    for (let index = 0; index < 21; index++) {
      const date = new Date(Date.UTC(2026, 8, 28 + index)).toISOString().slice(0, 10);
      const response = await api('/api/blocks', 'POST', {
        expectedRevision: index, start: `${date}T08:00:00Z`, end: `${date}T09:00:00Z`,
        title: `Entry ${index}`, note: `Note ${index}`,
      });
      expect(response.status).toBe(200);
    }
    const current = await state();
    expect(current.recentEntries).toHaveLength(20);
    expect(current.recentEntries.map(x => x.title)).toEqual(Array.from({ length: 20 }, (_, i) => `Entry ${20 - i}`));
    const repeated = await api('/api/blocks', 'POST', {
      expectedRevision: 21, start: '2026-10-19T08:00:00Z', end: '2026-10-19T09:00:00Z',
      title: ' Entry 1 ', note: ' Note 1 ',
    });
    expect(repeated.status).toBe(200);
    const after = await repeated.json() as AppState;
    expect(after.recentEntries).toHaveLength(20);
    expect(after.recentEntries[0]).toMatchObject({ title: 'Entry 1', note: 'Note 1', durationMinutes: 60 });
    expect(after.recentEntries.filter(x => x.title === 'Entry 1')).toHaveLength(1);
  });

  it('migrates legacy blocks and retains a version-one undo journal', async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    const path = join(dir, 'legacy.sqlite');
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE blocks (id TEXT PRIMARY KEY, start TEXT NOT NULL, end TEXT NOT NULL, note TEXT NOT NULL)");
    legacy.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run('revision', '1');
    legacy.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run('timezone', 'Europe/Berlin');
    const oldBlock = { id: 'legacy-id', start: '2026-09-28T06:00:00Z', end: '2026-09-28T07:00:00Z', note: 'Originaltext' };
    legacy.prepare('INSERT INTO blocks(id,start,end,note) VALUES (?,?,?,?)').run(oldBlock.id, oldBlock.start, oldBlock.end, oldBlock.note);
    legacy.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run('block_undo', JSON.stringify({
      version: 1, token: '00000000-0000-4000-8000-000000000001', label: 'Arbeitszeit hinzugefügt', revision: 1,
      blocks: [{ key: oldBlock.id, before: null, after: oldBlock }], weeks: [],
    }));
    legacy.close();
    db = openDatabase(path);
    await serve();
    const migrated = await state();
    expect(migrated.blocks).toEqual([{ ...oldBlock, title: '', createdAt: null }]);
    expect(migrated.undo?.token).toBe('00000000-0000-4000-8000-000000000001');
    const undone = await api('/api/blocks/undo', 'POST', { expectedRevision: 1, token: migrated.undo?.token });
    expect(undone.status).toBe(200);
    expect((await undone.json() as AppState).blocks).toEqual([]);
  });
});
