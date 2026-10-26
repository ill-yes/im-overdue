import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { openDatabase, readState } from '../server/db.js';
import type { AppState } from '../shared/types.js';

let db: DatabaseSync;
let server: Server;
let base: string;
const input = { start: '2026-09-28T08:00:00+02:00', end: '2026-09-28T09:00:00+02:00', title: 'Planning', note: 'Original note' };

async function api(path: string, data: object, method = 'POST') {
  return fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(data) });
}

async function setup(status: 'open' | 'closed'): Promise<AppState> {
  expect((await api('/api/blocks', { ...input, expectedRevision: 0 })).status).toBe(200);
  if (status === 'closed') {
    expect((await api('/api/weeks/2026-09-28', { status, expectedRevision: 1, confirmWarnings: true })).status).toBe(200);
    // Keep an unrelated undo available while the target week is closed.
    expect((await api('/api/blocks', { ...input, start: '2026-10-05T08:00:00+02:00', end: '2026-10-05T09:00:00+02:00', expectedRevision: 2 })).status).toBe(200);
  }
  const state = readState(db);
  expect(state.undo).not.toBeNull();
  return state;
}

beforeEach(async () => {
  db = openDatabase(':memory:');
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No port');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
});

describe.each(['open', 'closed'] as const)('identical block saves in an %s week', status => {
  it('preserves the complete state, including undo, with canonical equivalent instants and title', async () => {
    const before = await setup(status);
    const response = await api(`/api/blocks/${before.blocks[0].id}`, {
      ...input, start: '2026-09-28T06:00:00Z', end: '2026-09-28T07:00:00.000Z', title: '  Planning  ', expectedRevision: before.revision,
    }, 'PUT');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(before);
    expect(readState(db)).toEqual(before);
  });

  it('rejects stale revisions before allowing a no-op or template creation', async () => {
    const before = await setup(status);
    for (const rememberTemplate of [false, true]) {
      const response = await api(`/api/blocks/${before.blocks[0].id}`, {
        ...input, rememberTemplate, expectedRevision: before.revision - 1,
      }, 'PUT');
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'REVISION_CONFLICT' });
      expect(readState(db)).toEqual(before);
    }
  });

  it('creates a new template alone and then treats the existing identical template as a no-op', async () => {
    const before = await setup(status);
    const response = await api(`/api/blocks/${before.blocks[0].id}`, {
      ...input, rememberTemplate: true, expectedRevision: before.revision,
    }, 'PUT');
    expect(response.status).toBe(200);
    const after = await response.json() as AppState;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.undo).toBeNull();
    expect(after.templates).toMatchObject([{ title: input.title, note: input.note, durationMinutes: 60 }]);
    expect({ ...after, revision: before.revision, undo: before.undo, templates: before.templates }).toEqual(before);
    // Give the duplicate-template save a live undo token to preserve.
    const another = await api('/api/blocks', {
      ...input, start: '2026-10-12T08:00:00+02:00', end: '2026-10-12T09:00:00+02:00', expectedRevision: after.revision,
    });
    expect(another.status).toBe(200);
    const withUndo = await another.json() as AppState;
    expect(withUndo.undo).not.toBeNull();
    const duplicate = await api(`/api/blocks/${before.blocks[0].id}`, {
      ...input, rememberTemplate: true, expectedRevision: withUndo.revision,
    }, 'PUT');
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual(withUndo);
    expect(readState(db)).toEqual(withUndo);
  });

  it.each([
    { end: '2026-09-28T09:30:00+02:00' },
    { title: 'Changed title' },
    { note: 'Original note ' },
  ])('keeps actual changes subject to reopen and undo rules: %j', async change => {
    const before = await setup(status);
    const path = `/api/blocks/${before.blocks[0].id}`;
    const data = { ...input, ...change, expectedRevision: before.revision };
    if (status === 'closed') {
      const rejected = await api(path, data, 'PUT');
      expect(rejected.status).toBe(409);
      expect(await rejected.json()).toMatchObject({ code: 'REOPEN_REQUIRED' });
      expect(readState(db)).toEqual(before);
    }
    const response = await api(path, { ...data, confirmReopen: status === 'closed' }, 'PUT');
    expect(response.status).toBe(200);
    const after = await response.json() as AppState;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.blocks[0]).toMatchObject({ id: before.blocks[0].id, createdAt: before.blocks[0].createdAt });
    expect(after.weeks[0].status).toBe('open');
    expect(after.undo?.token).toBeTruthy();
    expect(after.undo?.token).not.toBe(before.undo?.token);
    const undone = await api('/api/blocks/undo', { expectedRevision: after.revision, token: after.undo!.token });
    expect(undone.status).toBe(200);
    const restored = await undone.json() as AppState;
    expect(restored.blocks).toEqual(before.blocks);
    expect(restored.weeks).toEqual(before.weeks);
  });
});
