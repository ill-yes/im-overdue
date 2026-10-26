import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import type { AppState } from '../shared/types.js';
import { createApp } from '../server/app.js';
import { openDatabase, readState } from '../server/db.js';
import { periodSummary, weekTotals } from '../shared/calculations.js';
import { IMPORT_MAX_BYTES } from '../server/import.js';

let dir: string;
let db: DatabaseSync;
let server: Server;
let base: string;
let origin: string;
async function api(path: string, method = 'GET', data?: object, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { method, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { Origin: origin } : {}), ...headers }, body: data ? JSON.stringify(data) : undefined });
}
async function state(): Promise<AppState> { return (await (await api('/api/state')).json()) as AppState; }
function rawStatus(path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${base}${path}`);
    const req = httpRequest({ hostname: '127.0.0.1', port: url.port, path, headers: { Host: host } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject); req.end();
  });
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'overdue-test-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No port');
  origin = `http://127.0.0.1:${address.port}`;
  base = origin;
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('local API', () => {
  it('guards Host, Origin, and stale revisions', async () => {
    expect((await api('/api/health')).status).toBe(200);
    expect(await rawStatus('/api/health', 'evil.example')).toBe(403);
    expect(await rawStatus('/api/backup', 'evil.example')).toBe(403);
    expect((await api('/api/weeks/2026-09-28', 'POST', { expectedRevision: 0, status: 'closed' }, { Origin: 'https://evil.example' })).status).toBe(403);
    const good = await api('/api/weeks/2026-09-28', 'POST', { expectedRevision: 0, status: 'closed', confirmCurrent: true, confirmWarnings: true });
    expect(good.status).toBe(200);
    const stale = await api('/api/weeks/2026-09-28', 'POST', { expectedRevision: 0, status: 'open' });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('REVISION_CONFLICT');
  });

  it('splits midnight blocks, tracks full actual time, and reopens affected weeks', async () => {
    const first = await api('/api/blocks', 'POST', { expectedRevision: 0, start: '2026-09-28T08:00:00+02:00', end: '2026-09-28T16:00:00+02:00', note: '' });
    expect(first.status).toBe(200);
    const after = await first.json() as AppState;
    expect(weekTotals(after, '2026-09-28').actualMinutes).toBe(480);
    const conflict = await api('/api/blocks', 'POST', { expectedRevision: 1, start: '2026-09-28T09:00:00+02:00', end: '2026-09-28T10:00:00+02:00', note: '' });
    expect((await conflict.json()).code).toBe('BLOCK_OVERLAP');
    const closed = await api('/api/weeks/2026-09-28', 'POST', { expectedRevision: 1, status: 'closed', confirmCurrent: true, confirmWarnings: true });
    expect(closed.status).toBe(200);
    const denied = await api(`/api/blocks/${after.blocks[0].id}`, 'PUT', { expectedRevision: 2, start: '2026-10-04T23:00:00+02:00', end: '2026-10-05T02:00:00+02:00', note: '' });
    expect((await denied.json()).weeks).toEqual(['2026-09-28']);
    const moved = await api(`/api/blocks/${after.blocks[0].id}`, 'PUT', { expectedRevision: 2, start: '2026-10-04T23:00:00+02:00', end: '2026-10-05T02:00:00+02:00', note: '', confirmReopen: true });
    expect(moved.status).toBe(200);
    const next = await moved.json() as AppState;
    expect(next.blocks).toHaveLength(2);
    expect(next.weeks).toEqual([{ weekStart: '2026-09-28', status: 'open' }, { weekStart: '2026-10-05', status: 'open' }]);
  });

  it('computes the published cross-month example and persists through restart and backup', async () => {
    const hours = [9, 8, 10, 8, 7, 2];
    let rev = 0;
    for (let i = 0; i < hours.length; i++) {
      const day = new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10);
      const result = await api('/api/blocks', 'POST', { expectedRevision: rev, start: `${day}T08:00:00+02:00`, end: `${day}T${String(8 + hours[i]).padStart(2, '0')}:00:00+02:00`, note: '' });
      expect(result.status).toBe(200);
      rev++;
    }
    expect((await api('/api/weeks/2026-09-28', 'POST', { expectedRevision: rev, status: 'closed', confirmCurrent: true, confirmWarnings: true })).status).toBe(200);
    const current = await state();
    expect(weekTotals(current, '2026-09-28').balanceMinutes).toBe(240);
    expect(periodSummary(current, '2026-09-01', '2026-10-01').confirmed.balanceMinutes).toBe(180);
    expect(periodSummary(current, '2026-10-01', '2026-11-01').confirmed.balanceMinutes).toBe(60);
    const bytes = Buffer.from(await (await api('/api/backup')).arrayBuffer());
    writeFileSync(join(dir, 'restore.sqlite'), bytes);
    const restore = openDatabase(join(dir, 'restore.sqlite'));
    expect(restore.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    restore.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    db = openDatabase(join(dir, 'db.sqlite'));
    server = createApp(db).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No port');
    origin = `http://127.0.0.1:${address.port}`;
    base = origin;
    expect((await state()).blocks).toHaveLength(6);
  });

  it('keeps failed imports atomic and activities independent of week closure', async () => {
    const document = { schemaVersion: 1, activities: [{ source: 'github', id: 'repo:sha', start: '2026-09-29T09:00:00+02:00', end: null, title: 'Commit', url: 'https://example.org/commit' }] };
    const text = JSON.stringify(document);
    const preview = await api('/api/import/preview', 'POST', { format: 'json', text });
    expect(preview.status).toBe(200);
    expect((await preview.json()).counts.new).toBe(1);
    const commit = await api('/api/import/commit', 'POST', { format: 'json', text, expectedRevision: 0 });
    expect(commit.status).toBe(200);
    expect((await api('/api/import/commit', 'POST', { format: 'json', text, expectedRevision: 1 })).status).toBe(200);
    expect((await state()).activities).toHaveLength(1);
    const invalid = JSON.stringify({ schemaVersion: 1, activities: [...document.activities, { ...document.activities[0], id: 'bad', url: 'javascript:alert(1)' }] });
    expect((await api('/api/import/commit', 'POST', { format: 'json', text: invalid, expectedRevision: 1 })).status).toBe(400);
    expect((await state()).activities).toHaveLength(1);
    expect((await state()).revision).toBe(1);
    expect((await api('/api/weeks/2026-09-28', 'POST', { status: 'closed', expectedRevision: 1, confirmCurrent: true, confirmWarnings: true })).status).toBe(200);
    const changed = JSON.stringify({ ...document, activities: [{ ...document.activities[0], title: 'Updated' }] });
    const result = await api('/api/import/commit', 'POST', { format: 'json', text: changed, expectedRevision: 2 });
    expect(result.status).toBe(200);
    expect(((await result.json()) as AppState).weeks[0].status).toBe('closed');
  });

  it('rejects invalid import envelopes consistently before preview or commit', async () => {
    for (const input of [{ format: 'xml', text: '' }, { format: 'json', text: 42 }, { format: 'csv' }]) {
      const preview = await api('/api/import/preview', 'POST', input);
      const commit = await api('/api/import/commit', 'POST', { ...input, expectedRevision: 0 });
      expect(preview.status).toBe(400);
      expect(commit.status).toBe(400);
      expect(await preview.json()).toMatchObject({ message: 'format und text erforderlich.' });
      expect(await commit.json()).toMatchObject({ message: 'format und text erforderlich.' });
    }
    expect((await state()).revision).toBe(0);
  });

  it('splits UTC instants at local day boundaries after timezone change', async () => {
    const added = await api('/api/blocks', 'POST', { expectedRevision: 0, start: '2026-09-28T23:00:00Z', end: '2026-09-29T01:00:00Z', note: '' });
    expect(added.status).toBe(200);
    expect(((await added.json()) as AppState).blocks).toHaveLength(1);
    const moved = await api('/api/settings', 'PUT', { timezone: 'UTC', expectedRevision: 1 });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as AppState).blocks).toHaveLength(2);
    const back = await api('/api/settings', 'PUT', { timezone: 'America/New_York', expectedRevision: 2 });
    expect(back.status).toBe(200);
    expect(((await back.json()) as AppState).blocks).toHaveLength(2);
  });

  it('requires explicit reopening for an empty closed week when timezone or initial target changes', async () => {
    expect((await api('/api/weeks/2026-09-28', 'POST', { status: 'closed', expectedRevision: 0, confirmCurrent: true, confirmWarnings: true })).status).toBe(200);
    const zone = await api('/api/settings', 'PUT', { timezone: 'UTC', expectedRevision: 1 });
    expect((await zone.json()).code).toBe('REOPEN_REQUIRED');
    expect((await state()).revision).toBe(1);
    const profile = await api('/api/profiles', 'POST', { effectiveFrom: null, weeklyMinutes: 1800, workdays: [1, 2, 3, 4, 5], expectedRevision: 1 });
    expect((await profile.json()).weeks).toEqual(['2026-09-28']);
    const changed = await api('/api/profiles', 'POST', { effectiveFrom: null, weeklyMinutes: 1800, workdays: [1, 2, 3, 4, 5], expectedRevision: 1, confirmReopen: true });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as AppState).weeks[0].status).toBe('open');
  });

  it('refuses future closure and validates profile Mondays', async () => {
    const future = await api('/api/weeks/2099-01-05', 'POST', { status: 'closed', expectedRevision: 0 });
    expect(future.status).toBe(400);
    const badProfile = await api('/api/profiles', 'POST', { effectiveFrom: '2026-10-01', weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5], expectedRevision: 0 });
    expect(badProfile.status).toBe(400);
    const goodProfile = await api('/api/profiles', 'POST', { effectiveFrom: '2026-10-05', weeklyMinutes: 1800, workdays: [1, 2, 3, 4, 5], expectedRevision: 0 });
    expect(goodProfile.status).toBe(200);
    expect(((await goodProfile.json()) as AppState).profiles).toHaveLength(2);
  });

  it('uses elapsed minutes through daylight saving transitions', async () => {
    const added = await api('/api/blocks', 'POST', { expectedRevision: 0, start: '2026-10-25T01:30:00+02:00', end: '2026-10-25T02:30:00+01:00', note: '' });
    expect(added.status).toBe(200);
    const current = await added.json() as AppState;
    expect(weekTotals(current, '2026-10-19').actualMinutes).toBe(120);
    expect(current.blocks).toHaveLength(1);
  });

  it('restores all persisted categories from a consistent backup', async () => {
    const block = await api('/api/blocks', 'POST', { expectedRevision: 0, start: '2026-09-28T08:00:00+02:00', end: '2026-09-28T09:00:00+02:00', note: 'Projekt' });
    expect(block.status).toBe(200);
    expect((await api('/api/settings', 'PUT', { timezone: 'UTC', expectedRevision: 1 })).status).toBe(200);
    expect((await api('/api/profiles', 'POST', { effectiveFrom: '2026-10-05', weeklyMinutes: 1950, workdays: [1, 2, 3, 4], expectedRevision: 2 })).status).toBe(200);
    const data = JSON.stringify({ schemaVersion: 1, activities: [{ source: 'other', id: 'x', start: '2026-09-28T08:30:00Z', end: null, title: 'Test', url: null }] });
    expect((await api('/api/import/commit', 'POST', { format: 'json', text: data, expectedRevision: 3 })).status).toBe(200);
    expect((await api('/api/weeks/2026-09-28', 'POST', { status: 'closed', expectedRevision: 4, confirmCurrent: true, confirmWarnings: true })).status).toBe(200);
    const original = await state();
    const bytes = Buffer.from(await (await api('/api/backup')).arrayBuffer());
    writeFileSync(join(dir, 'complete.sqlite'), bytes);
    const restored = openDatabase(join(dir, 'complete.sqlite'));
    expect(readState(restored)).toEqual(original);
    expect(weekTotals(readState(restored), '2026-09-28')).toEqual(weekTotals(original, '2026-09-28'));
    restored.close();
  });

  it('accepts valid under-5-MiB imports after JSON transport escaping and rejects oversized decoded content atomically', async () => {
    const text = JSON.stringify({ schemaVersion: 1, activities: Array.from({ length: 2000 }, (_, i) => ({
      source: 'other', id: String(i), start: '2026-10-01T09:00:00Z', end: null, title: '"'.repeat(1000), url: null,
    })) });
    expect(Buffer.byteLength(text)).toBeLessThan(IMPORT_MAX_BYTES);
    expect(Buffer.byteLength(JSON.stringify({ format: 'json', text }))).toBeGreaterThan(6 * 1024 * 1024);
    const previewResponse = await api('/api/import/preview', 'POST', { format: 'json', text });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    expect(preview.errors).toEqual([]);
    expect(preview.counts.new).toBe(2000);
    const commitResponse = await api('/api/import/commit', 'POST', { format: 'json', text, expectedRevision: 0 });
    expect(commitResponse.status).toBe(200);
    expect((await state()).activities).toHaveLength(2000);
    const tooLarge = 'x'.repeat(IMPORT_MAX_BYTES + 1);
    expect((await api('/api/import/preview', 'POST', { format: 'json', text: tooLarge })).status).toBe(413);
    expect((await api('/api/import/commit', 'POST', { format: 'json', text: tooLarge, expectedRevision: 1 })).status).toBe(413);
    const after = await state();
    expect(after.revision).toBe(1);
    expect(after.activities).toHaveLength(2000);
  }, 30_000);

  it('uses the configured zone for the seven-local-day block cap across fall DST', async () => {
    expect((await api('/api/settings', 'PUT', { timezone: 'America/New_York', expectedRevision: 0 })).status).toBe(200);
    // New York falls back on 2026-11-01, so seven local days take 169 elapsed hours.
    const start = '2026-10-27T12:00:00-04:00';
    const accepted = await api('/api/blocks', 'POST', { start, end: '2026-11-03T12:00:00-05:00', note: '', expectedRevision: 1 });
    expect(accepted.status).toBe(200);
    const previous = await accepted.json() as AppState;
    expect(previous.blocks).toHaveLength(8);
    const rejected = await api('/api/blocks', 'POST', { start, end: '2026-11-03T12:01:00-05:00', note: '', expectedRevision: 2 });
    expect(rejected.status).toBe(400);
    expect((await state()).revision).toBe(2);
  });
});
