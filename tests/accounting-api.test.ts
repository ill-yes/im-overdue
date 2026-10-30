import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { openDatabase, readState } from '../server/db.js';
import { readUndo } from '../server/undo.js';
import { addDays } from '../shared/time.js';
import { serverMessages } from '../shared/server-messages.js';
import type { AbsenceChange, AppState } from '../shared/types.js';
let dir: string, db: DatabaseSync, server: Server, base: string;
const day = (date = '2026-09-28', extra: Partial<AbsenceChange> = {}): AbsenceChange => ({ date, sickness: false, vacationFraction: 0, compensation: null, ...extra });
async function api(path: string, method = 'GET', data?: object, headers = {}) {
  return fetch(base + path, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, body: data ? JSON.stringify(data) : undefined });
}
async function state(): Promise<AppState> { return (await api('/api/state')).json() as Promise<AppState>; }
async function save(path: string, data: object, method = 'PUT') { return api(path, method, { expectedRevision: (await state()).revision, ...data }); }
async function absent(days: AbsenceChange[], extra = {}) { return save('/api/absences', { days, ...extra }); }
async function undo() { const s = await state(); return api('/api/blocks/undo', 'POST', { token: s.undo?.token, expectedRevision: s.revision }); }
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'overdue-accounting-')); db = openDatabase(join(dir, 'test.sqlite'));
  server = createApp(db).listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No port'); base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('account opening and ledger', () => {
  it('requires opening, validates signed integer bounds, and leaves closed weeks alone', async () => {
    const entry = { date: '2026-09-28', kind: 'payout', minutes: -60, reason: ' Paid out ' };
    expect((await save('/api/account/entries', entry, 'POST')).status).toBe(400);
    for (const minutes of [1.5, 1000000001, -1000000001, null, '12']) expect((await save('/api/account/opening', { date: '2026-09-28', minutes })).status).toBe(400);
    expect((await save('/api/account/opening', { date: '2026-09-28', minutes: -1000000000 })).status).toBe(200);
    for (const input of [{ ...entry, minutes: 0 }, { ...entry, kind: 'correction', minutes: 0 }, { ...entry, date: '2026-09-27' }, { ...entry, reason: ' ' }, { ...entry, kind: 'invalid' }]) expect((await save('/api/account/entries', input, 'POST')).status).toBe(400);
    db.prepare("INSERT INTO weeks VALUES ('2026-09-28','closed')").run();
    const created = await (await save('/api/account/entries', entry, 'POST')).json() as AppState;
    expect(created.accountEntries?.[0].reason).toBe('Paid out'); expect(created.weeks[0].status).toBe('closed');
    const id = created.accountEntries![0].id;
    const duplicate = await (await save(`/api/account/entries/${id}`, entry)).json(); expect(duplicate).toEqual(created);
    expect((await save(`/api/account/entries/${id}`, { ...entry, kind: 'correction', minutes: 30 })).status).toBe(200);
    expect((await save('/api/account/opening', { date: '2026-10-01', minutes: 0 })).status).toBe(200);
    expect((await state()).accountEntries).toHaveLength(1);
    expect((await save(`/api/account/entries/${id}`, {}, 'DELETE')).status).toBe(200);
    expect((await state()).accountEntries).toEqual([]);
  });
  it('preserves undo for equal opening and rejects stale revisions', async () => {
    await save('/api/account/opening', { date: '2026-09-28', minutes: 0 });
    await absent([day(undefined, { sickness: true })]); const before = await state();
    expect(await (await save('/api/account/opening', { date: '2026-09-28', minutes: 0 })).json()).toEqual(before);
    expect((await api('/api/account/opening', 'PUT', { date: '2026-09-28', minutes: 1, expectedRevision: 0 })).status).toBe(409);
    await save('/api/account/opening', { date: '2026-09-28', minutes: 1 }); expect((await state()).undo).toBeNull();
  });
});

describe('combined absences and v4 undo', () => {
  it('writes and undoes combinations atomically with closed week status and no blocks', async () => {
    db.prepare("INSERT INTO weeks VALUES ('2026-09-28','closed')").run();
    const days = [day(undefined, { sickness: true, vacationFraction: 0.5, compensation: { mode: 'minutes', value: 90 } }), day('2026-09-29', { compensation: { mode: 'fraction', value: 1 } })];
    expect((await absent(days)).status).toBe(409); expect((await state()).revision).toBe(0);
    expect((await absent(days, { confirmReopen: true })).status).toBe(200);
    const after = await state(); expect(after.blocks).toEqual([]); expect(after.weeks[0].status).toBe('open'); expect(readUndo(db)?.version).toBe(4);
    expect(await (await absent(days)).json()).toEqual(after);
    expect((await undo()).status).toBe(200); const restored = await state();
    expect(restored.absences).toEqual([]); expect(restored.vacations).toEqual([]); expect(restored.weeks[0].status).toBe('closed');
  });
  it('preserves other absence parts through legacy vacation edits and protects whole combinations during undo', async () => {
    await absent([day(undefined, { sickness: true })]);
    await save('/api/vacations', { days: [{ date: '2026-09-28', fraction: 0.5 }] });
    expect((await state()).absences?.[0].sickness).toBe(true); expect(readUndo(db)?.version).toBe(3);
    expect((await undo()).status).toBe(200); expect((await state()).absences?.[0].sickness).toBe(true);
    await absent([day(undefined, { sickness: true, compensation: { mode: 'minutes', value: 1 } })]);
    db.prepare("INSERT INTO vacations VALUES ('2026-09-28',1)").run();
    const before = await state(); expect((await undo()).status).toBe(409); expect(await state()).toEqual(before);
  });
  it('undoes vacation-only v4 changes and preserves undo through holiday no-ops', async () => {
    await save('/api/holiday-profiles', { effectiveFrom: '2026-01-01', region: null }, 'POST');
    await absent([day(undefined, { vacationFraction: 1 })]);
    const before = await state(); expect(readUndo(db)?.version).toBe(4);
    expect(await (await save('/api/holiday-profiles', { effectiveFrom: '2026-01-01', region: null }, 'POST')).json()).toEqual(before);
    expect(await (await save('/api/holiday-overrides/2026-09-28', {}, 'DELETE')).json()).toEqual(before);
    expect((await undo()).status).toBe(200); expect((await state()).vacations).toEqual([]);
  });
  it('validates every row and rejects invalid ranges and new target-zero absence while allowing preservation/removal', async () => {
    const invalid = [[], [day('2026-02-30')], [day(), day()], [day(), day('2027-09-29')], [day(undefined, { compensation: { mode: 'minutes', value: 10081 } })], [day(undefined, { compensation: { mode: 'minutes', value: 0.5 } })], [day(), day('2026-10-03', { sickness: true })]];
    for (const days of invalid) expect((await absent(days)).status).toBe(400);
    expect((await state()).revision).toBe(0);
    await absent([day(undefined, { sickness: true, vacationFraction: 1 })]);
    db.prepare('UPDATE profiles SET weekly_minutes=0').run(); const before = await state();
    expect(await (await absent([day(undefined, { sickness: true, vacationFraction: 1 })])).json()).toEqual(before);
    expect((await absent([day()])).status).toBe(200);
  });
  it('supports 366 days and rejects malformed journals without writing', async () => {
    db.prepare('UPDATE profiles SET workdays=?').run('[1,2,3,4,5,6,7]');
    expect((await absent(Array.from({ length: 366 }, (_, i) => day(addDays('2024-01-01', i), { sickness: true })))).status).toBe(200);
    const journal = readUndo(db)!; expect(journal.version).toBe(4);
    db.prepare("UPDATE meta SET value=? WHERE key='block_undo'").run(JSON.stringify({ ...journal, absences: [] }));
    expect((await state()).undo).toBeNull(); expect((await api('/api/blocks/undo', 'POST', { expectedRevision: (await state()).revision, token: journal.token })).status).toBe(409);
    db.prepare("UPDATE meta SET value=? WHERE key='block_undo'").run(JSON.stringify(journal));
    expect((await undo()).status).toBe(200); expect((await state()).absences).toEqual([]);
  });
});

describe('holiday configuration', () => {
  it('does not reopen a closed week when a zero-target vacation is only suspended', async () => {
    db.prepare('UPDATE profiles SET weekly_minutes=0').run();
    db.prepare("INSERT INTO vacations VALUES ('2026-09-28',1)").run();
    db.prepare("INSERT INTO weeks VALUES ('2026-09-28','closed')").run();
    expect((await save('/api/holiday-overrides/2026-09-28', { name: 'No hours changed' })).status).toBe(200);
    expect((await state()).weeks[0].status).toBe('closed');
    expect((await save('/api/holiday-overrides/2026-09-28', {}, 'DELETE')).status).toBe(200);
    expect((await state()).weeks[0].status).toBe('closed');
    expect((await state()).vacations).toEqual([{ date: '2026-09-28', fraction: 1 }]);
  });
  it('requires reopen for numerical change and preserves revision for no-ops', async () => {
    db.prepare("INSERT INTO weeks VALUES ('2026-12-21','closed')").run();
    expect((await save('/api/holiday-profiles', { effectiveFrom: '2026-01-01', region: 'HE' }, 'POST')).status).toBe(409);
    expect((await save('/api/holiday-profiles', { effectiveFrom: '2026-01-01', region: 'HE', confirmReopen: true }, 'POST')).status).toBe(200);
    const first = await state(); expect(first.weeks[0].status).toBe('open');
    expect(await (await save('/api/holiday-profiles', { effectiveFrom: '2026-01-01', region: 'HE' }, 'POST')).json()).toEqual(first);
    expect(first.holidayProfiles).toHaveLength(1);
    await save('/api/holiday-profiles', { effectiveFrom: '2026-01-01', region: null }, 'POST'); expect((await state()).holidayProfiles).toHaveLength(1);
    expect((await save(`/api/holiday-profiles/${first.holidayProfiles![0].id}`, {}, 'DELETE')).status).toBe(200);
  });
  it('allows metadata-only changes and target-free configuration without reopening', async () => {
    db.prepare("INSERT INTO weeks VALUES ('2026-09-28','closed')").run();
    expect((await save('/api/holiday-overrides/2026-09-28', { name: 'Special', confirmReopen: true })).status).toBe(200);
    db.prepare("UPDATE weeks SET status='closed'").run();
    expect((await save('/api/holiday-overrides/2026-09-28', { name: 'Renamed' })).status).toBe(200);
    expect((await state()).weeks[0].status).toBe('closed');
    expect((await save('/api/holiday-overrides/2026-10-03', { name: 'Weekend' })).status).toBe(200);
    expect((await save('/api/holiday-overrides/2026-09-28', { name: null })).status).toBe(409);
    await save('/api/holiday-overrides/2026-09-28', { name: null, confirmReopen: true });
    expect((await state()).holidayOverrides).toContainEqual({ date: '2026-09-28', name: null });
    expect((await save('/api/holiday-overrides/2026-09-28', {}, 'DELETE')).status).toBe(200);
    const before = await state(); expect(await (await save('/api/holiday-overrides/2026-09-28', {}, 'DELETE')).json()).toEqual(before);
  });
  it('retains request security and localized validation on new endpoint families', async () => {
    const requests = [ ['/api/account/opening', 'PUT', { date: '2026-09-28', minutes: 0 }], ['/api/account/entries', 'POST', {}], ['/api/absences', 'PUT', { days: [day()] }], ['/api/holiday-profiles', 'POST', {}], ['/api/holiday-overrides/2026-09-28', 'PUT', { name: 'Day' }] ] as const;
    for (const [path, method, data] of requests) {
      expect((await api(path, method, { ...data, expectedRevision: 0 }, { Origin: 'http://evil.example' })).status).toBe(403);
      expect((await api(path, method, { ...data, expectedRevision: 0 }, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    }
    const invalid = await (await save('/api/holiday-profiles', { effectiveFrom: '2026-01-01', region: 'XX' }, 'POST')).json();
    expect(invalid.messageKey).toBe('error.holiday.region'); expect(serverMessages['error.holiday.region'].en).toBeTruthy(); expect(serverMessages['error.holiday.region'].de).toBeTruthy();
    const version = await (await save('/api/holiday-profiles', { effectiveFrom: '2026-01-01', region: 'HE', ruleVersion: 2 }, 'POST')).json();
    expect(version.messageKey).toBe('error.holiday.ruleVersion'); expect(serverMessages['error.holiday.ruleVersion'].en).toBeTruthy(); expect(serverMessages['error.holiday.ruleVersion'].de).toBeTruthy();
    expect((await state()).revision).toBe(0);
  });
  it('backs up ledger, absence, profile, overrides and v4 undo together', async () => {
    await save('/api/account/opening', { date: '2026-09-28', minutes: 42 });
    await save('/api/account/entries', { date: '2026-09-28', minutes: -1, kind: 'payout', reason: 'Payout' }, 'POST');
    await save('/api/holiday-profiles', { effectiveFrom: '2026-01-01', region: 'HE' }, 'POST');
    await save('/api/holiday-overrides/2026-09-29', { name: null });
    await absent([day(undefined, { sickness: true })]); const before = await state();
    const path = join(dir, 'backup.sqlite'); writeFileSync(path, Buffer.from(await (await api('/api/backup')).arrayBuffer()));
    const restored = openDatabase(path); try { expect(readState(restored)).toEqual(before); expect(readUndo(restored)?.version).toBe(4); } finally { restored.close(); }
  });
});
