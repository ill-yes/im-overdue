import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { openDatabase, readState } from '../server/db.js';
import type { AppState } from '../shared/types.js';

let dir: string;
let db: DatabaseSync;
let server: Server;
let base: string;
async function startServer() {
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No port');
  base = `http://127.0.0.1:${address.port}`;
}
async function api(path: string, method = 'GET', data?: object, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: data ? JSON.stringify(data) : undefined });
}
async function current(): Promise<AppState> { return (await (await api('/api/state')).json()) as AppState; }
async function block(start: string, end: string, expectedRevision: number, extra: object = {}) {
  return api('/api/blocks', 'POST', { start, end, note: '', expectedRevision, ...extra });
}
async function undo(state: AppState, token = state.undo?.token ?? '') {
  return api('/api/blocks/undo', 'POST', { expectedRevision: state.revision, token });
}
function rawStatus(path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(base);
    const req = httpRequest({ hostname: '127.0.0.1', port: url.port, method: 'POST', path,
      headers: { Host: host, Origin: base, 'Content-Type': 'application/json' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ expectedRevision: 1, token: 'x' }));
  });
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'overdue-undo-test-'));
  db = openDatabase(join(dir, 'data.sqlite'));
  await startServer();
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('single step block undo', () => {
  it('removes all created midnight segments and newly touched week rows, exactly once', async () => {
    const created = await block('2026-10-04T22:00:00+02:00', '2026-10-05T02:00:00+02:00', 0);
    expect(created.status).toBe(200);
    const after = await created.json() as AppState;
    expect(after.blocks).toHaveLength(2);
    expect(after.weeks.map(w => w.weekStart)).toEqual(['2026-09-28', '2026-10-05']);
    expect(after.undo).toMatchObject({ label: 'Arbeitszeit hinzugefügt' });
    const undone = await undo(after);
    expect(undone.status).toBe(200);
    const restored = await undone.json() as AppState;
    expect(restored.blocks).toEqual([]);
    expect(restored.weeks).toEqual([]);
    expect(restored.undo).toBeNull();
    expect(restored.revision).toBe(2);
    const again = await undo(restored, after.undo!.token);
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe('UNDO_CONFLICT');
  });

  it('restores original ID and closed status after cross-week update, deleting new week rows', async () => {
    const original = await (await block('2026-09-28T08:00:00+02:00', '2026-09-28T09:00:00+02:00', 0)).json() as AppState;
    const originalId = original.blocks[0].id;
    const closed = await api('/api/weeks/2026-09-28', 'POST', { status: 'closed', expectedRevision: 1, confirmCurrent: true, confirmWarnings: true });
    expect(closed.status).toBe(200);
    const moved = await api(`/api/blocks/${originalId}`, 'PUT', {
      start: '2026-10-04T23:00:00+02:00', end: '2026-10-05T02:00:00+02:00', note: 'Moved', expectedRevision: 2, confirmReopen: true,
    });
    expect(moved.status).toBe(200);
    const after = await moved.json() as AppState;
    expect(after.blocks).toHaveLength(2);
    expect(after.weeks).toEqual([{ weekStart: '2026-09-28', status: 'open' }, { weekStart: '2026-10-05', status: 'open' }]);
    const result = await undo(after);
    expect(result.status).toBe(200);
    const restored = await result.json() as AppState;
    expect(restored.blocks).toEqual(original.blocks);
    expect(restored.weeks).toEqual([{ weekStart: '2026-09-28', status: 'closed' }]);
  });

  it('restores deleted block under the same ID and keeps unrelated data', async () => {
    const first = await (await block('2026-09-28T08:00:00+02:00', '2026-09-28T09:00:00+02:00', 0)).json() as AppState;
    const second = await (await block('2026-09-28T10:00:00+02:00', '2026-09-28T11:00:00+02:00', 1)).json() as AppState;
    const removed = await api(`/api/blocks/${first.blocks[0].id}`, 'DELETE', { expectedRevision: 2 });
    expect(removed.status).toBe(200);
    const after = await removed.json() as AppState;
    expect(after.blocks).toHaveLength(1);
    const restored = await (await undo(after)).json() as AppState;
    expect(restored.blocks).toEqual(second.blocks);
    expect(restored.undo).toBeNull();
  });

  it('keeps undo after failed mutation, preview, reads and backup; successful mutation invalidates it', async () => {
    const added = await (await block('2026-09-28T08:00:00+02:00', '2026-09-28T09:00:00+02:00', 0)).json() as AppState;
    const overlap = await block('2026-09-28T08:30:00+02:00', '2026-09-28T09:30:00+02:00', 1);
    expect(overlap.status).toBe(409);
    const preview = await api('/api/import/preview', 'POST', { format: 'json', text: JSON.stringify({ schemaVersion: 1, activities: [] }) });
    expect(preview.status).toBe(200);
    expect((await api('/api/backup')).status).toBe(200);
    expect((await current()).undo).toEqual(added.undo);
    const weekChange = await api('/api/weeks/2026-09-28', 'POST', { status: 'open', expectedRevision: 1 });
    expect(weekChange.status).toBe(200);
    expect(((await weekChange.json()) as AppState).undo).toBeNull();
    const stale = await api('/api/blocks/undo', 'POST', { expectedRevision: 2, token: added.undo!.token });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('UNDO_CONFLICT');
  });

  it('rejects stale revision, stale token and mismatched affected after-state without writes', async () => {
    const first = await (await block('2026-09-28T08:00:00+02:00', '2026-09-28T09:00:00+02:00', 0)).json() as AppState;
    expect((await undo({ ...first, revision: 0 })).status).toBe(409);
    expect((await undo(first, '00000000-0000-0000-0000-000000000000')).status).toBe(409);
    const beforeMismatch = await current();
    db.prepare('UPDATE blocks SET note=? WHERE id=?').run('external', first.blocks[0].id);
    const mismatch = await undo(first);
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json()).code).toBe('UNDO_CONFLICT');
    expect((await current()).revision).toBe(beforeMismatch.revision);
    expect((await current()).blocks[0].note).toBe('external');
  });

  it('rejects a changed affected week row without deleting created blocks', async () => {
    const created = await (await block('2026-09-28T08:00:00+02:00', '2026-09-28T09:00:00+02:00', 0)).json() as AppState;
    db.prepare('UPDATE weeks SET status=? WHERE week_start=?').run('closed', '2026-09-28');
    const changedWeek = await undo(created);
    expect(changedWeek.status).toBe(409);
    expect((await changedWeek.json()).code).toBe('UNDO_CONFLICT');
    expect((await current()).blocks).toEqual(created.blocks);
  });

  it('rejects a conflicting unrelated block without partial restore', async () => {
    const original = await (await block('2026-09-28T08:00:00+02:00', '2026-09-28T09:00:00+02:00', 0)).json() as AppState;
    const removed = await (await api(`/api/blocks/${original.blocks[0].id}`, 'DELETE', { expectedRevision: 1 })).json() as AppState;
    db.prepare('INSERT INTO blocks(id,start,end,note) VALUES (?,?,?,?)').run('external', original.blocks[0].start, original.blocks[0].end, 'external');
    const overlap = await undo(removed);
    expect(overlap.status).toBe(409);
    expect((await overlap.json()).code).toBe('UNDO_CONFLICT');
    expect((await current()).blocks.map(b => b.id)).toEqual(['external']);
  });

  it('makes the previous tab token stale after a newer block change', async () => {
    const first = await (await block('2026-09-28T08:00:00+02:00', '2026-09-28T09:00:00+02:00', 0)).json() as AppState;
    const second = await (await block('2026-09-28T10:00:00+02:00', '2026-09-28T11:00:00+02:00', 1)).json() as AppState;
    expect(second.undo?.token).not.toBe(first.undo?.token);
    const staleRevision = await undo(first);
    expect(staleRevision.status).toBe(409);
    expect((await staleRevision.json()).code).toBe('REVISION_CONFLICT');
    const staleToken = await undo(second, first.undo!.token);
    expect(staleToken.status).toBe(409);
    expect((await staleToken.json()).code).toBe('UNDO_CONFLICT');
    expect((await current()).blocks).toHaveLength(2);
  });

  it('survives process restart and consistent SQLite backup', async () => {
    const after = await (await block('2026-09-28T08:00:00+02:00', '2026-09-28T09:00:00+02:00', 0)).json() as AppState;
    const bytes = Buffer.from(await (await api('/api/backup')).arrayBuffer());
    writeFileSync(join(dir, 'restored.sqlite'), bytes);
    const backupDb = openDatabase(join(dir, 'restored.sqlite'));
    expect(readState(backupDb).undo).toEqual(after.undo);
    backupDb.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    db = openDatabase(join(dir, 'data.sqlite'));
    await startServer();
    expect((await current()).undo).toEqual(after.undo);
    expect((await undo(after)).status).toBe(200);
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    db = openDatabase(join(dir, 'restored.sqlite'));
    await startServer();
    expect(await current()).toEqual(after);
    expect((await undo(after)).status).toBe(200);
    expect((await current()).blocks).toEqual([]);
    expect((await current()).undo).toBeNull();
  });

  it('treats malformed or future-version journals as unavailable and protects host/origin', async () => {
    db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run('block_undo', '{broken');
    expect((await current()).undo).toBeNull();
    db.prepare('UPDATE meta SET value=? WHERE key=?').run(JSON.stringify({ version: 2, token: 'x' }), 'block_undo');
    expect((await current()).undo).toBeNull();
    expect(await rawStatus('/api/blocks/undo', 'evil.example')).toBe(403);
    const wrongOrigin = await api('/api/blocks/undo', 'POST', { expectedRevision: 0, token: 'x' }, { Origin: 'http://evil.example' });
    expect(wrongOrigin.status).toBe(403);
  });
});
