import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { openDatabase, readState } from '../server/db.js';
import { noteText, NOTE_MAX_LENGTH } from '../shared/notes.js';
import { weekTotals } from '../shared/calculations.js';
import type { AppState } from '../shared/types.js';

let dir: string;
let db: DatabaseSync;
let server: Server;
let origin: string;

async function listen(): Promise<void> {
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No port');
  origin = `http://127.0.0.1:${address.port}`;
}
async function api(path: string, method = 'GET', data?: object, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { Origin: origin } : {}), ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
async function save(scope: string, date: string, text: unknown, expectedRevision: number): Promise<Response> {
  return api(`/api/notes/${scope}/${date}`, 'PUT', { text, expectedRevision });
}
async function state(): Promise<AppState> { return await (await api('/api/state')).json() as AppState; }
async function rawPut(host: string, requestOrigin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(origin);
    const data = JSON.stringify({ text: 'blocked', expectedRevision: 0 });
    const req = httpRequest({ hostname: '127.0.0.1', port: Number(url.port), method: 'PUT', path: '/api/notes/day/2026-09-28',
      headers: { Host: host, Origin: requestOrigin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject); req.end(data);
  });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'overdue-notes-test-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  await listen();
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('calendar notes', () => {
  it('creates, updates and removes day and week notes independently, preserving exact text', async () => {
    expect((await state()).notes).toEqual([]);
    const escaped = '  A <script> & "quoted"\\path\nsecond line  ';
    expect((await save('day', '2026-09-28', escaped, 0)).status).toBe(200);
    expect((await save('week', '2026-09-28', 'Weekly', 1)).status).toBe(200);
    let current = await state();
    expect(noteText(current.notes, 'day', '2026-09-28')).toBe(escaped);
    expect(noteText(current.notes, 'week', '2026-09-28')).toBe('Weekly');
    expect(noteText(current.notes, 'day', '2026-09-29')).toBe('');
    expect((await save('day', '2026-09-28', 'revised', 2)).status).toBe(200);
    expect((await save('day', '2026-09-28', ' \n\t ', 3)).status).toBe(200);
    current = await state();
    expect(current.notes).toEqual([{ scope: 'week', date: '2026-09-28', text: 'Weekly' }]);
    expect(current.revision).toBe(4);
  });

  it('rejects invalid scope, calendar dates, non-Mondays and invalid text without changes', async () => {
    for (const [scope, date] of [['month', '2026-09-28'], ['day', '2026-02-30'], ['day', '2026-9-28'], ['week', '2026-09-29']]) {
      expect((await save(scope, date, 'x', 0)).status).toBe(400);
    }
    for (const text of [null, 123, {}, 'x'.repeat(NOTE_MAX_LENGTH + 1)]) {
      expect((await save('day', '2026-09-28', text, 0)).status).toBe(400);
    }
    expect((await state()).revision).toBe(0);
    expect((await state()).notes).toEqual([]);
    expect((await save('day', '2026-09-28', 'x'.repeat(NOTE_MAX_LENGTH), 0)).status).toBe(200);
    expect(noteText((await state()).notes, 'day', '2026-09-28')).toHaveLength(NOTE_MAX_LENGTH);
  });

  it('keeps stale writes atomic and does not disturb Undo on errors or no-ops', async () => {
    const created = await api('/api/blocks', 'POST', { expectedRevision: 0, start: '2026-09-28T08:00:00+02:00', end: '2026-09-28T09:00:00+02:00', note: '' });
    expect(created.status).toBe(200);
    const undo = (await created.json() as AppState).undo;
    expect(undo).not.toBeNull();
    expect((await save('day', '2026-09-28', '', 1)).status).toBe(200);
    expect((await save('day', '2026-09-28', '  ', 1)).status).toBe(200);
    expect((await state()).undo).toEqual(undo);
    expect((await state()).revision).toBe(1);
    expect((await save('day', '2026-09-28', 'x', 0)).status).toBe(409);
    expect((await save('day', '2026-09-28', 'x'.repeat(NOTE_MAX_LENGTH + 1), 1)).status).toBe(400);
    expect((await state()).undo).toEqual(undo);
    const saved = await save('day', '2026-09-28', 'x', 1);
    expect(saved.status).toBe(200);
    expect((await saved.json() as AppState).undo).toBeNull();
    expect((await save('day', '2026-09-28', 'x', 1)).status).toBe(409);
    expect((await save('day', '2026-09-28', 'x', 2)).status).toBe(200);
    expect((await state()).revision).toBe(2);
    expect((await state()).notes).toEqual([{ scope: 'day', date: '2026-09-28', text: 'x' }]);
  });

  it('leaves closed weeks and time totals unchanged, including after timezone changes', async () => {
    const closed = await api('/api/weeks/2026-09-28', 'POST', { expectedRevision: 0, status: 'closed', confirmCurrent: true, confirmWarnings: true });
    expect(closed.status).toBe(200);
    const before = await state();
    const totals = weekTotals(before, '2026-09-28');
    expect((await save('day', '2026-10-01', 'Date anchor', 1)).status).toBe(200);
    expect((await save('week', '2026-09-28', 'Closed week note', 2)).status).toBe(200);
    const noted = await state();
    expect(noted.weeks).toEqual(before.weeks);
    expect(noted.activities).toEqual(before.activities);
    expect(noted.blocks).toEqual(before.blocks);
    expect(weekTotals(noted, '2026-09-28')).toEqual(totals);
    const zone = await api('/api/settings', 'PUT', { expectedRevision: 3, timezone: 'Pacific/Auckland', confirmReopen: true });
    expect(zone.status).toBe(200);
    expect((await state()).notes).toEqual(noted.notes);
  });

  it('protects note writes with Host and Origin checks', async () => {
    expect(await rawPut('evil.example', origin)).toBe(403);
    expect(await rawPut(new URL(origin).host, 'https://evil.example')).toBe(403);
    expect((await state()).revision).toBe(0);
    expect((await state()).notes).toEqual([]);
  });

  it('adds notes to an existing schema and keeps them through restart and backup restore', async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    const legacy = join(dir, 'legacy.sqlite');
    const old = new DatabaseSync(legacy);
    old.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE activities (source TEXT NOT NULL, id TEXT NOT NULL, start TEXT NOT NULL, end TEXT, title TEXT NOT NULL, url TEXT, PRIMARY KEY(source,id));
      CREATE TABLE blocks (id TEXT PRIMARY KEY, start TEXT NOT NULL, end TEXT NOT NULL, note TEXT NOT NULL);
      CREATE TABLE profiles (id TEXT PRIMARY KEY, effective_from TEXT UNIQUE, weekly_minutes INTEGER NOT NULL, workdays TEXT NOT NULL);
      CREATE TABLE weeks (week_start TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('open','closed')));
      INSERT INTO meta(key,value) VALUES ('revision','7'),('timezone','Europe/Berlin');
      INSERT INTO profiles(id,effective_from,weekly_minutes,workdays) VALUES ('old',NULL,2400,'[1,2,3,4,5]');`);
    old.close();
    db = openDatabase(legacy);
    expect(readState(db).revision).toBe(7);
    expect(readState(db).notes).toEqual([]);
    await listen();
    expect((await save('week', '2026-09-28', 'Persisted', 7)).status).toBe(200);
    const backup = Buffer.from(await (await api('/api/backup')).arrayBuffer());
    const restorePath = join(dir, 'restore.sqlite');
    writeFileSync(restorePath, backup);
    const restored = openDatabase(restorePath);
    expect(readState(restored).notes).toEqual([{ scope: 'week', date: '2026-09-28', text: 'Persisted' }]);
    restored.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    db = openDatabase(legacy);
    await listen();
    expect((await state()).notes).toEqual([{ scope: 'week', date: '2026-09-28', text: 'Persisted' }]);
  });
});
