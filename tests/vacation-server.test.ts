import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { openDatabase, readState } from '../server/db.js';
import { Temporal, addDays, weekStartFor } from '../shared/time.js';
import { weekReviewKey } from '../shared/week-review.js';
import type { AppState, VacationChange } from '../shared/types.js';

let dir: string;
let db: DatabaseSync;
let server: Server;
let base: string;
async function api(path: string, method = 'GET', data?: object, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: data ? JSON.stringify(data) : undefined });
}
async function current(): Promise<AppState> { return await (await api('/api/state')).json() as AppState; }
async function vacation(days: VacationChange[], expectedRevision: number, extra: object = {}) {
  return api('/api/vacations', 'PUT', { days, expectedRevision, ...extra });
}
async function undo(state: AppState, extra: object = {}) {
  return api('/api/blocks/undo', 'POST', { expectedRevision: state.revision, token: state.undo?.token, ...extra });
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'overdue-vacation-test-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No port');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('vacation API and shared undo', () => {
  it('starts without an assumed allowance and saves full and half days without creating week rows', async () => {
    expect((await current()).vacationAllowances).toEqual([]);
    const response = await vacation([{ date: '2026-09-28', fraction: 1 }, { date: '2026-09-29', fraction: 0.5 }], 0);
    expect(response.status).toBe(200);
    const after = await response.json() as AppState;
    expect(after.vacations).toEqual([{ date: '2026-09-28', fraction: 1 }, { date: '2026-09-29', fraction: 0.5 }]);
    expect(after.weeks).toEqual([]);
    expect(after.undo?.label).toBe('Urlaub eingetragen');
    expect((await undo(after)).status).toBe(200);
    expect((await current()).vacations).toEqual([]);
  });

  it('preserves revision and the existing undo on matching and absent-removal no-ops', async () => {
    const first = await (await vacation([{ date: '2026-09-28', fraction: 0.5 }], 0)).json() as AppState;
    const same = await vacation([{ date: '2026-09-28', fraction: 0.5 }, { date: '2026-09-29', fraction: null }], first.revision);
    expect(await same.json()).toEqual(first);
    expect((await vacation([{ date: '2026-09-28', fraction: 0.5 }], 0)).status).toBe(409);
    expect(await current()).toEqual(first);
  });

  it('validates every batch row before writing, including target-free dates and the calendar envelope', async () => {
    const invalid = [
      [], [{ date: '2026-02-30', fraction: 1 }], [{ date: '2026-09-28', fraction: 0.25 }],
      [{ date: '2026-09-28', fraction: 1 }, { date: '2026-09-28', fraction: null }],
      [{ date: '2026-09-28', fraction: 1 }, { date: '2026-10-03', fraction: 1 }],
      [{ date: '2026-09-28', fraction: 1 }, { date: '2027-09-29', fraction: 1 }],
      Array.from({ length: 367 }, (_, i) => ({ date: addDays('2026-01-01', i), fraction: null })),
    ];
    for (const days of invalid) expect((await api('/api/vacations', 'PUT', { days, expectedRevision: 0 })).status).toBe(400);
    expect((await current()).revision).toBe(0);
    expect((await current()).vacations).toEqual([]);
  });

  it('allows removals after a changed profile makes a saved day target-free', async () => {
    await vacation([{ date: '2026-09-28', fraction: 1 }], 0);
    db.prepare('UPDATE profiles SET weekly_minutes=0').run();
    expect((await vacation([{ date: '2026-09-28', fraction: null }], 1)).status).toBe(200);
    expect((await current()).vacations).toEqual([]);
  });

  it('requires reopening changed closed weeks and undo restores both their status and prior fraction', async () => {
    await vacation([{ date: '2026-09-28', fraction: 0.5 }], 0);
    const closed = await api('/api/weeks/2026-09-28', 'POST', { status: 'closed', expectedRevision: 1, confirmWarnings: true, confirmCurrent: true });
    expect(closed.status).toBe(200);
    const denied = await vacation([{ date: '2026-09-28', fraction: 1 }], 2);
    expect((await denied.json()).weeks).toEqual(['2026-09-28']);
    expect((await current()).revision).toBe(2);
    const changed = await (await vacation([{ date: '2026-09-28', fraction: 1 }], 2, { confirmReopen: true })).json() as AppState;
    expect(changed.weeks[0].status).toBe('open');
    expect((await undo(changed)).status).toBe(200);
    expect((await current()).weeks[0].status).toBe('closed');
    expect((await current()).vacations[0].fraction).toBe(0.5);
  });

  it('allows work and leave on the same date and keeps blocks, templates and recents intact on vacation undo', async () => {
    const block = await api('/api/blocks', 'POST', { expectedRevision: 0, start: '2026-09-28T06:00:00Z', end: '2026-09-28T07:00:00Z', title: 'Work', note: 'Retain', rememberTemplate: true });
    const before = await block.json() as AppState;
    const after = await (await vacation([{ date: '2026-09-28', fraction: 1 }], 1)).json() as AppState;
    expect(after.undo?.token).not.toBe(before.undo?.token);
    expect((await undo(after)).status).toBe(200);
    const restored = await current();
    expect(restored.blocks).toEqual(before.blocks);
    expect(restored.templates).toEqual(before.templates);
    expect(restored.recentEntries).toEqual(before.recentEntries);
  });

  it('rejects wrong token, revision and affected vacation or week after-state without partial writes', async () => {
    db.prepare("INSERT INTO weeks(week_start,status) VALUES (?,'closed')").run('2026-09-28');
    const after = await (await vacation([{ date: '2026-09-28', fraction: 1 }, { date: '2026-09-29', fraction: 0.5 }], 0, { confirmReopen: true })).json() as AppState;
    expect((await undo(after, { token: 'wrong' })).status).toBe(409);
    expect((await undo(after, { expectedRevision: 0 })).status).toBe(409);
    db.prepare('UPDATE vacations SET fraction=0.5 WHERE date=?').run('2026-09-28');
    const mismatch = await current();
    expect((await undo(after)).status).toBe(409);
    expect(await current()).toEqual(mismatch);
    db.prepare('UPDATE vacations SET fraction=1 WHERE date=?').run('2026-09-28');
    db.prepare("UPDATE weeks SET status='closed' WHERE week_start=?").run('2026-09-28');
    const changedWeek = await current();
    expect((await undo(after)).status).toBe(409);
    expect(await current()).toEqual(changedWeek);
  });

  it('supports the full 366-day envelope, all affected closed weeks and one atomic undo', async () => {
    db.prepare('UPDATE profiles SET workdays=?').run(JSON.stringify([1, 2, 3, 4, 5, 6, 7]));
    const days = Array.from({ length: 366 }, (_, i) => ({ date: addDays('2024-01-01', i), fraction: 1 as const }));
    const weeks = [...new Set(days.map(day => weekStartFor(day.date)))];
    weeks.forEach(week => db.prepare("INSERT INTO weeks(week_start,status) VALUES (?,'closed')").run(week));
    const before = await current();
    const response = await vacation(days, 0, { confirmReopen: true });
    expect(response.status).toBe(200);
    const after = await response.json() as AppState;
    expect(after.vacations).toHaveLength(366);
    expect(after.undo).not.toBeNull();
    expect((await undo(after)).status).toBe(200);
    expect((await current()).vacations).toEqual([]);
    expect((await current()).weeks).toEqual(before.weeks);
  });

  it('validates allowance increments, bounds and years while preserving no-ops and closed weeks', async () => {
    for (const [year, value] of [['2026', -0.5], ['2026', 0.1], ['2026', 3650.5], ['0', 30], ['0000', 30], ['2026.0', 30]]) {
      expect((await api(`/api/vacation-allowances/${year}`, 'PUT', { expectedRevision: 0, entitlementDays: value, carryoverDays: 0 })).status).toBe(400);
    }
    db.prepare("INSERT INTO weeks(week_start,status) VALUES (?,'closed')").run('2026-09-28');
    const first = await api('/api/vacation-allowances/2026', 'PUT', { expectedRevision: 0, entitlementDays: 30, carryoverDays: 2.5 });
    expect(first.status).toBe(200);
    const after = await first.json() as AppState;
    expect(after.vacationAllowances).toEqual([{ year: 2026, entitlementDays: 30, carryoverDays: 2.5 }]);
    expect(after.weeks[0].status).toBe('closed');
    const leave = await (await vacation([{ date: '2026-10-05', fraction: 1 }], 1)).json() as AppState;
    const noOp = await api('/api/vacation-allowances/2026', 'PUT', { expectedRevision: 2, entitlementDays: 30, carryoverDays: 2.5 });
    expect(await noOp.json()).toEqual(leave);
    const changed = await api('/api/vacation-allowances/2026', 'PUT', { expectedRevision: 2, entitlementDays: 31, carryoverDays: 0 });
    expect((await changed.json() as AppState).undo).toBeNull();
    expect((await api('/api/vacation-allowances/2026', 'PUT', { expectedRevision: 2, entitlementDays: 31, carryoverDays: 0 })).status).toBe(409);
  });

  it('backs up vacation, allowance and v3 undo together', async () => {
    await api('/api/vacation-allowances/2026', 'PUT', { expectedRevision: 0, entitlementDays: 30, carryoverDays: 1 });
    const after = await (await vacation([{ date: '2026-09-28', fraction: 1 }], 1)).json() as AppState;
    const bytes = Buffer.from(await (await api('/api/backup')).arrayBuffer());
    const path = join(dir, 'backup.sqlite');
    writeFileSync(path, bytes);
    const restored = openDatabase(path);
    const backupServer = createApp(restored).listen(0, '127.0.0.1');
    try {
      await new Promise<void>(resolve => backupServer.once('listening', resolve));
      expect(readState(restored)).toEqual(after);
      const address = backupServer.address();
      if (!address || typeof address === 'string') throw Error('No port');
      const origin = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${origin}/api/blocks/undo`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: after.revision, token: after.undo?.token }) });
      expect(response.status).toBe(200);
      expect(readState(restored).vacations).toEqual([]);
      expect(readState(restored).vacationAllowances).toEqual(after.vacationAllowances);
    } finally {
      await new Promise<void>(resolve => backupServer.close(() => resolve()));
      restored.close();
    }
  });

  it('treats malformed v3 journals as unavailable without applying them', async () => {
    const after = await (await vacation([{ date: '2026-09-28', fraction: 1 }], 0)).json() as AppState;
    const row = db.prepare("SELECT value FROM meta WHERE key='block_undo'").get() as { value: string };
    const journal = JSON.parse(row.value);
    const fixtures = [
      { ...journal, vacations: [{ key: '2026-09-28', before: null, after: { date: '2026-09-28', fraction: 0.25 } }] },
      { ...journal, weeks: [{ key: '2026-09-21', before: { weekStart: '2026-09-21', status: 'closed' }, after: { weekStart: '2026-09-21', status: 'open' } }] },
      { ...journal, vacations: [...journal.vacations, { key: '2027-09-29', before: null, after: { date: '2027-09-29', fraction: 1 } }] },
      { ...journal, vacations: [] },
      { ...journal, version: 4 },
    ];
    for (const fixture of fixtures) {
      db.prepare("UPDATE meta SET value=? WHERE key='block_undo'").run(JSON.stringify(fixture));
      expect((await current()).undo).toBeNull();
      expect((await undo(after)).status).toBe(409);
      expect((await current()).vacations).toEqual(after.vacations);
      expect((await current()).revision).toBe(after.revision);
    }
  });

  it('keeps origin and fetch-site protection on both new mutations', async () => {
    expect((await vacation([{ date: '2026-09-28', fraction: 1 }], 0, { confirmReopen: 'true' })).status).toBe(400);
    for (const [path, data] of [['/api/vacations', { days: [{ date: '2026-09-28', fraction: 1 }] }], ['/api/vacation-allowances/2026', { entitlementDays: 30, carryoverDays: 0 }]] as const) {
      expect((await api(path, 'PUT', { ...data, expectedRevision: 0 }, { Origin: 'http://evil.example' })).status).toBe(403);
      expect((await api(path, 'PUT', { ...data, expectedRevision: 0 }, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    }
    expect((await current()).revision).toBe(0);
  });
});

describe('week review and read-only export', () => {
  it('rejects a review kept across midnight at the same revision and accepts the refreshed review', async () => {
    const clock = vi.spyOn(Temporal.Now, 'instant').mockReturnValue(Temporal.Instant.from('2026-09-28T21:59:00Z'));
    const before = await (await vacation([{ date: '2026-09-29', fraction: 0.5 }], 0)).json() as AppState;
    const initial = await (await api('/api/weeks/2026-09-28/review')).json();
    expect(initial.warnings).toEqual([]);
    clock.mockReturnValue(Temporal.Instant.from('2026-09-28T22:01:00Z'));
    const response = await api('/api/weeks/2026-09-28', 'POST', { status: 'closed', expectedRevision: before.revision, confirmCurrent: true, confirmWarnings: true, reviewKey: weekReviewKey(initial) });
    expect(response.status).toBe(409);
    const problem = await response.json();
    expect(problem.code).toBe('WEEK_REVIEW_REQUIRED');
    expect(problem.review.today).toBe('2026-09-29');
    expect(problem.review.warnings).toMatchObject([{ date: '2026-09-28', kind: 'missing' }]);
    expect(await current()).toEqual(before);
    const accepted = await api('/api/weeks/2026-09-28', 'POST', { status: 'closed', expectedRevision: before.revision, confirmCurrent: true, confirmWarnings: true, reviewKey: weekReviewKey(problem.review) });
    expect(accepted.status).toBe(200);
  });

  it('requires reviewing newly elapsed imported evidence without a revision change', async () => {
    const clock = vi.spyOn(Temporal.Now, 'instant').mockReturnValue(Temporal.Instant.from('2026-09-28T08:59:00Z'));
    db.prepare('INSERT INTO data_sources(id,type,name) VALUES (?,?,?)').run('legacy:other', 'other', 'Sonstige');
    db.prepare('INSERT INTO activities(data_source_id,source,id,start,end,title,url) VALUES (?,?,?,?,?,?,?)').run('legacy:other', 'other', 'future-evidence', '2026-09-28T09:00:00Z', '2026-09-28T09:30:00Z', 'Evidence', null);
    const before = await (await vacation([{ date: '2026-09-29', fraction: 0.5 }], 0)).json() as AppState;
    const initial = await (await api('/api/weeks/2026-09-28/review')).json();
    expect(initial.warnings).toEqual([]);
    clock.mockReturnValue(Temporal.Instant.from('2026-09-28T09:01:00Z'));
    const response = await api('/api/weeks/2026-09-28', 'POST', { status: 'closed', expectedRevision: before.revision, confirmCurrent: true, confirmWarnings: true, reviewKey: weekReviewKey(initial) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'WEEK_REVIEW_REQUIRED', review: { revision: before.revision, today: initial.today, warnings: [{ date: '2026-09-28', kind: 'evidence', count: 1 }] } });
    expect(await current()).toEqual(before);
  });

  it('rejects a changed review even when its warnings stay empty', async () => {
    const clock = vi.spyOn(Temporal.Now, 'instant').mockReturnValue(Temporal.Instant.from('2026-10-04T21:59:00Z'));
    const days = Array.from({ length: 5 }, (_, i) => ({ date: addDays('2026-09-28', i), fraction: 1 as const }));
    const before = await (await vacation(days, 0)).json() as AppState;
    const initial = await (await api('/api/weeks/2026-09-28/review')).json();
    expect(initial.warnings).toEqual([]);
    expect(initial.requiresCurrentConfirmation).toBe(true);
    clock.mockReturnValue(Temporal.Instant.from('2026-10-04T22:01:00Z'));
    const response = await api('/api/weeks/2026-09-28', 'POST', { status: 'closed', expectedRevision: before.revision, confirmCurrent: true, confirmWarnings: true, reviewKey: weekReviewKey(initial) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'WEEK_REVIEW_REQUIRED', review: { warnings: [], today: '2026-10-05', requiresCurrentConfirmation: false } });
    expect(await current()).toEqual(before);
  });

  it('validates supplied review keys without changing state or consuming undo', async () => {
    const before = await (await vacation([{ date: '2026-09-28', fraction: 1 }], 0)).json() as AppState;
    for (const reviewKey of [null, 12, {}, '', 'x'.repeat(20_001)]) {
      const response = await api('/api/weeks/2026-09-28', 'POST', { status: 'closed', expectedRevision: before.revision, confirmCurrent: true, confirmWarnings: true, reviewKey });
      expect(response.status).toBe(400);
      expect(await current()).toEqual(before);
    }
  });

  it('returns current review and requires explicit warning confirmation without consuming undo', async () => {
    const after = await (await vacation([{ date: '2026-09-28', fraction: 1 }], 0)).json() as AppState;
    const reviewResponse = await api('/api/weeks/2026-09-28/review');
    expect(reviewResponse.headers.get('cache-control')).toBe('no-store');
    const review = await reviewResponse.json();
    expect(review.revision).toBe(1);
    expect(review.warnings).toHaveLength(4);
    const close = await api('/api/weeks/2026-09-28', 'POST', { expectedRevision: 1, status: 'closed', confirmCurrent: true });
    expect(close.status).toBe(409);
    expect(await close.json()).toMatchObject({ code: 'WEEK_REVIEW_REQUIRED', review });
    expect(await current()).toEqual(after);
    expect((await api('/api/weeks/2026-09-29/review')).status).toBe(400);
  });

  it('closes a full leave week without warnings or work blocks', async () => {
    const days = Array.from({ length: 5 }, (_, i) => ({ date: addDays('2026-09-28', i), fraction: 1 as const }));
    await vacation(days, 0);
    expect((await (await api('/api/weeks/2026-09-28/review')).json()).warnings).toEqual([]);
    expect((await api('/api/weeks/2026-09-28', 'POST', { expectedRevision: 1, status: 'closed', confirmCurrent: true })).status).toBe(200);
    expect((await current()).blocks).toEqual([]);
  });

  it('exports one consistent revision with vacation and notes while leaving state and undo untouched', async () => {
    await api('/api/notes/day/2026-09-28', 'PUT', { expectedRevision: 0, text: 'Private note' });
    const after = await (await vacation([{ date: '2026-09-28', fraction: 0.5 }], 1)).json() as AppState;
    const response = await api('/api/timesheet?from=2026-09-28&to=2026-10-05');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const snapshot = await response.json();
    expect(snapshot.revision).toBe(after.revision);
    expect(snapshot.days).toHaveLength(7);
    expect(snapshot.days[0]).toMatchObject({ date: '2026-09-28', dayNote: 'Private note', vacationFraction: 0.5, totals: { actualMinutes: 0, vacationMinutes: 240, targetMinutes: 480, balanceMinutes: -240 } });
    expect(await current()).toEqual(after);
    for (const query of ['', '?from=2026-02-30&to=2026-03-02', '?from=2026-01-01&to=2026-01-01', '?from=2026-01-02&to=2026-01-01', '?from=2026-01-01&to=2027-01-03', '?from=2026-01-01&from=2026-01-02&to=2026-01-03']) {
      expect((await api(`/api/timesheet${query}`)).status).toBe(400);
    }
    expect((await api('/api/timesheet?from=2024-01-01&to=2025-01-01')).status).toBe(200);
  });

  it('adds new tables to a populated old database without resetting its revision or existing rows', () => {
    const path = join(dir, 'legacy.sqlite');
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE blocks(id TEXT PRIMARY KEY,start TEXT NOT NULL,end TEXT NOT NULL,note TEXT NOT NULL)");
    old.prepare('INSERT INTO meta VALUES (?,?)').run('revision', '37');
    old.prepare('INSERT INTO meta VALUES (?,?)').run('timezone', 'UTC');
    old.prepare('INSERT INTO blocks VALUES (?,?,?,?)').run('old', '2026-09-28T08:00:00Z', '2026-09-28T09:00:00Z', 'Keep');
    old.close();
    const migrated = openDatabase(path);
    try {
      const state = readState(migrated);
      expect(state.revision).toBe(37);
      expect(state.blocks[0]).toMatchObject({ id: 'old', note: 'Keep', title: '', createdAt: null });
      expect(state.vacations).toEqual([]);
      expect(state.vacationAllowances).toEqual([]);
    } finally { migrated.close(); }
  });
});
