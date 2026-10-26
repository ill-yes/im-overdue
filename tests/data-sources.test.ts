import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import type { Activity, AppState, DataPage, ImportAnalysis, ImportPackage, ImportPackagePage, ImportPreview, Source } from '../shared/types.js';
import { openDatabase, readState } from '../server/db.js';
import { createApp } from '../server/app.js';
import { commitImport } from '../server/data-sources.js';
import { transaction } from '../server/db.js';

let dir: string;
let db: DatabaseSync;
let server: Server;
let base: string;
const evidence = (id = 'same', source: Source = 'slack', title = 'Original'): Omit<Activity, 'dataSourceId'> => ({
  source, id, start: '2026-10-01T09:00:00Z', end: null, title, url: null,
});
const input = (activities = [evidence()], extra = {}) => ({ format: 'json', text: JSON.stringify({ schemaVersion: 1, activities }), ...extra });
async function api(path: string, method = 'GET', data?: object, headers = {}) {
  return fetch(`${base}${path}`, { method, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { Origin: base } : {}), ...headers }, body: data ? JSON.stringify(data) : undefined });
}
async function get<T>(path: string): Promise<T> { const response = await api(path); expect(response.status).toBe(200); return response.json() as Promise<T>; }
async function current() { return get<AppState>('/api/state'); }
async function create(type: Source, name: string) {
  const before = await current();
  const response = await api('/api/data-sources', 'POST', { type, name, expectedRevision: before.revision });
  expect(response.status).toBe(200);
  const after = await response.json() as AppState;
  return after.dataSources.find(source => !before.dataSources.some(old => old.id === source.id))!;
}
async function commit(activities = [evidence()], extra = {}) {
  const response = await api('/api/import/commit', 'POST', { ...input(activities, extra), expectedRevision: (await current()).revision });
  expect(response.status).toBe(200);
  return response.json() as Promise<AppState>;
}
async function packages(id: string) { return get<DataPage<ImportPackage>>(`/api/data-sources/${encodeURIComponent(id)}/packages`); }
async function makeUndo() {
  const response = await api('/api/blocks', 'POST', { expectedRevision: (await current()).revision, start: '2026-10-01T09:00:00Z', end: '2026-10-01T10:00:00Z', note: 'Preserve' });
  expect(response.status).toBe(200);
  return response.json() as Promise<AppState>;
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'overdue-sources-test-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No test port');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('source-scoped imports and immutable packages', () => {
  it('analyzes without writes; preview proposes legacy targets and commit creates only used sources', async () => {
    const before = await current();
    const data = input([evidence(), evidence(), evidence('git', 'github')]);
    const analysis = await (await api('/api/import/analyze', 'POST', data)).json() as ImportAnalysis;
    expect(analysis).toEqual({ sources: [{ source: 'slack', count: 1 }, { source: 'github', count: 1 }], total: 3, duplicates: 1, errors: [] });
    const preview = await (await api('/api/import/preview', 'POST', data)).json() as ImportPreview;
    expect(preview.rows.map(row => row.activity.dataSourceId)).toEqual(['legacy:slack', 'legacy:github']);
    expect(await current()).toEqual(before);
    const state = await commit([evidence(), evidence(), evidence('git', 'github')]);
    expect(state.revision).toBe(1);
    expect(state.dataSources).toHaveLength(2);
    expect(state.dataSources.find(source => source.type === 'slack')).toMatchObject({ id: 'legacy:slack', activityCount: 1, packageCount: 1, legacyCount: 0, firstActivityStart: '2026-10-01T09:00:00Z' });
    const page = await packages('legacy:slack');
    expect(page.items[0]).toMatchObject({ fileName: 'Texteingabe', counts: { total: 2, new: 1, updated: 0, unchanged: 0, duplicates: 1 } });
  });

  it('separates equal external IDs, requires complete valid assignments and preserves missing records', async () => {
    const one = await create('slack', ' Firma ');
    const two = await create('slack', 'Privat');
    expect(one.name).toBe('Firma');
    expect(one.id).toMatch(/^[0-9a-f-]{36}$/);
    const before = await current();
    const ambiguous = await (await api('/api/import/preview', 'POST', input())).json() as ImportPreview;
    expect(ambiguous.errors[0].message).toContain('Mehrere');
    for (const assignments of [{}, { slack: 'missing' }, { slack: one.id }, { slack: two.id, github: one.id }]) {
      expect((await api('/api/import/commit', 'POST', { ...input([evidence(), evidence('g', 'github')], { assignments }), expectedRevision: before.revision })).status).toBe(400);
      expect(await current()).toEqual(before);
    }
    await commit([evidence(), evidence('kept')], { assignments: { slack: one.id } });
    await commit([evidence('same', 'slack', 'Private')], { assignments: { slack: two.id } });
    const state = await commit([evidence('same', 'slack', 'Changed')], { assignments: { slack: one.id } });
    expect(state.activities.map(a => [a.dataSourceId, a.id, a.title])).toEqual(expect.arrayContaining([[one.id, 'same', 'Changed'], [two.id, 'same', 'Private'], [one.id, 'kept', 'Original']]));
    expect(state.activities).toHaveLength(3);
  });

  it('preserves revision and Undo for unchanged imports and rename; snapshots include unchanged submitted rows', async () => {
    const source = await create('slack', 'Work');
    await commit([evidence('a'), evidence('b')], { assignments: { slack: source.id }, fileName: 'first.json' });
    const before = await makeUndo();
    expect(before.undo).not.toBeNull();
    const unchanged = await commit([evidence('a'), evidence('b')], { assignments: { slack: source.id } });
    expect(unchanged).toEqual(before);
    expect((await packages(source.id)).total).toBe(1);
    const renamed = await api(`/api/data-sources/${source.id}`, 'PUT', { name: ' Work ', expectedRevision: before.revision });
    expect(await renamed.json()).toEqual(before);
    const updated = await commit([evidence('a', 'slack', 'Updated'), evidence('b')], { assignments: { slack: source.id }, fileName: 'next.json' });
    expect(updated.undo).toBeNull();
    expect(updated.revision).toBe(before.revision + 1);
    const page = await packages(source.id);
    const first = page.items.find(item => item.fileName === 'first.json')!;
    const next = page.items.find(item => item.fileName === 'next.json')!;
    expect(next.counts).toEqual({ total: 2, new: 0, updated: 1, unchanged: 1, duplicates: 0 });
    expect((await get<ImportPackagePage>(`/api/import-packages/${next.id}`)).items).toHaveLength(2);
    expect((await get<ImportPackagePage>(`/api/import-packages/${first.id}`)).items.find(row => row.id === 'a')?.title).toBe('Original');
  });

  it('rolls back every source/package/row and preserves Undo on late mixed-target failure', async () => {
    const slack = await create('slack', 'Slack');
    const github = await create('github', 'GitHub');
    const before = await makeUndo();
    db.exec("CREATE TRIGGER reject_github BEFORE INSERT ON import_package_rows WHEN NEW.source='github' BEGIN SELECT RAISE(ABORT,'test rejection'); END");
    const response = await api('/api/import/commit', 'POST', { ...input([evidence(), evidence('g', 'github')], { assignments: { slack: slack.id, github: github.id } }), expectedRevision: before.revision });
    expect(response.status).toBe(500);
    expect(await current()).toEqual(before);
    expect((await packages(slack.id)).total).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM import_package_rows').get()).toEqual({ n: 0 });
    db.exec('DROP TRIGGER reject_github');
    await commit([evidence(), evidence('g', 'github')], { assignments: { slack: slack.id, github: github.id } });
    const state = await commit([evidence(), evidence('g', 'github', 'New')], { assignments: { slack: slack.id, github: github.id } });
    expect(state.dataSources.find(source => source.id === slack.id)?.packageCount).toBe(1);
    expect(state.dataSources.find(source => source.id === github.id)?.packageCount).toBe(2);
  });

  it('deletes only the chosen source evidence/history, leaving timesheet data and other sources', async () => {
    const one = await create('slack', 'One');
    const two = await create('slack', 'Two');
    await commit([evidence()], { assignments: { slack: one.id } });
    const deletedPackage = (await packages(one.id)).items[0].id;
    await commit([evidence()], { assignments: { slack: two.id } });
    await makeUndo();
    db.exec("INSERT INTO notes(scope,date,text) VALUES ('day','2026-10-01','Keep'); INSERT INTO vacations(date,fraction) VALUES ('2026-10-02',0.5); INSERT INTO vacation_allowances VALUES (2026,30,2)");
    const before = await current();
    const response = await api(`/api/data-sources/${one.id}`, 'DELETE', { expectedRevision: before.revision });
    expect(response.status).toBe(200);
    const after = await response.json() as AppState;
    for (const key of ['blocks', 'notes', 'vacations', 'vacationAllowances', 'weeks', 'profiles', 'templates', 'recentEntries'] as const) expect(after[key]).toEqual(before[key]);
    expect(after.activities).toHaveLength(1);
    expect(after.activities[0].dataSourceId).toBe(two.id);
    expect(after.undo).toBeNull();
    expect((await api(`/api/import-packages/${deletedPackage}`)).status).toBe(404);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('paginates live evidence and snapshots at 50, validates metadata/search and parameterizes input', async () => {
    const source = await create('slack', 'A');
    await commit(Array.from({ length: 55 }, (_, n) => evidence(String(n), 'slack', n === 54 ? "Quote ' % _" : 'Entry')), { assignments: { slack: source.id }, fileName: 'list.json' });
    const page = await get<DataPage<Activity>>(`/api/data-sources/${source.id}/activities`);
    expect(page).toMatchObject({ page: 0, pageSize: 50, total: 55 });
    expect(page.items).toHaveLength(50);
    expect((await get<DataPage<Activity>>(`/api/data-sources/${source.id}/activities?page=1`)).items).toHaveLength(5);
    const packageId = (await packages(source.id)).items[0].id;
    expect((await get<ImportPackagePage>(`/api/import-packages/${packageId}?page=1`)).items).toHaveLength(5);
    expect((await get<DataPage<Activity>>(`/api/data-sources/${source.id}/activities?q=${encodeURIComponent("' % _")}`)).total).toBe(1);
    expect((await get<ImportPackagePage>(`/api/import-packages/${packageId}?q=${encodeURIComponent("' OR 1=1 --")}`)).total).toBe(0);
    for (const query of ['page=-1', 'page=1.5', 'page=1e2', 'page=9007199254740991', 'page=0&page=1', `q=${'a'.repeat(501)}`, 'q[a]=1']) {
      expect((await api(`/api/data-sources/${source.id}/activities?${query}`)).status).toBe(400);
      expect((await api(`/api/import-packages/${packageId}?${query}`)).status).toBe(400);
    }
    const before = await current();
    for (const extra of [{ assignments: [] }, { assignments: { slack: 1 } }, { assignments: { nope: source.id } }, { fileName: '' }, { fileName: 'x'.repeat(256) }]) {
      expect((await api('/api/import/commit', 'POST', { ...input(undefined, extra), expectedRevision: before.revision })).status).toBe(400);
    }
    for (const name of ['', ' '.repeat(5), 'x'.repeat(161), 4]) expect((await api('/api/data-sources', 'POST', { type: 'slack', name, expectedRevision: before.revision })).status).toBe(400);
    expect((await api(`/api/data-sources/${source.id}`, 'PUT', { name: 'Changed', type: 'github', expectedRevision: before.revision })).status).toBe(400);
    expect(await current()).toEqual(before);
  });

  it('orders exact UTC seconds and nanoseconds correctly and searches German Unicode text', async () => {
    const source = await create('slack', 'Zeit');
    const rows = [
      { ...evidence('second'), start: '2026-10-02T00:00:01Z' },
      { ...evidence('whole'), start: '2026-10-02T00:00:00Z' },
      { ...evidence('nano', 'slack', 'ÜBERPRÜFUNG'), start: '2026-10-02T00:00:00.000000001Z' },
      { ...evidence('previous'), start: '2026-10-01T23:59:59.999999999Z' },
    ];
    const state = await commit(rows, { assignments: { slack: source.id }, fileName: 'Übersicht.json' });
    expect(state.activities.map(row => row.id)).toEqual(['previous', 'whole', 'nano', 'second']);
    expect(state.dataSources[0].firstActivityStart).toBe(rows[3].start);
    const page = await get<DataPage<Activity>>(`/api/data-sources/${source.id}/activities`);
    expect(page.items.map(row => row.id)).toEqual(['second', 'nano', 'whole', 'previous']);
    const imported = (await packages(source.id)).items[0];
    expect(imported).toMatchObject({ firstStart: rows[3].start, lastEnd: rows[0].start });
    expect((await get<ImportPackagePage>(`/api/import-packages/${imported.id}`)).items.map(row => row.id)).toEqual(page.items.map(row => row.id));
    expect((await get<DataPage<Activity>>(`/api/data-sources/${source.id}/activities?q=${encodeURIComponent('überprüfung')}`)).total).toBe(1);
    expect((await get<ImportPackagePage>(`/api/import-packages/${imported.id}?q=${encodeURIComponent('überprüfung')}`)).total).toBe(1);
    expect((await get<DataPage<ImportPackage>>(`/api/data-sources/${source.id}/packages?q=${encodeURIComponent('übersicht')}`)).total).toBe(1);
    expect(await commit([], { assignments: {} })).toEqual(state);
  });

  it('retains Host/Origin and revision guards for every source mutation and import', async () => {
    const source = await create('slack', 'A');
    const before = await current();
    const mutations: [string, string, object][] = [
      ['/api/data-sources', 'POST', { type: 'github', name: 'B' }],
      [`/api/data-sources/${source.id}`, 'PUT', { name: 'B' }],
      [`/api/data-sources/${source.id}`, 'DELETE', {}],
      ['/api/import/commit', 'POST', input()],
    ];
    for (const [path, method, data] of mutations) {
      expect((await api(path, method, { ...data, expectedRevision: 0 })).status).toBe(409);
      expect((await api(path, method, { ...data, expectedRevision: before.revision }, { Origin: 'https://evil.example' })).status).toBe(403);
    }
    const denied = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${base}/api/data-sources/${source.id}/activities`, { headers: { Host: 'evil.example' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
      req.on('error', reject); req.end();
    });
    expect(denied).toBe(403);
    expect(await current()).toEqual(before);
    const response = await api(`/api/data-sources/${source.id}`, 'PUT', { name: 'Renamed', expectedRevision: before.revision });
    const renamed = await response.json() as AppState;
    expect(renamed.revision).toBe(before.revision + 1);
    expect(renamed.dataSources[0]).toMatchObject({ id: source.id, type: 'slack', name: 'Renamed' });
  });

  it('backs up and restores catalogs, packages, snapshots, revision and Undo', async () => {
    const source = await create('github', 'Code');
    await commit([evidence('same', 'github')], { assignments: { github: source.id }, fileName: 'original.json' });
    await commit([evidence('same', 'github', 'Updated')], { assignments: { github: source.id }, fileName: 'update.json' });
    const before = await makeUndo();
    const response = await api('/api/backup');
    expect(response.status).toBe(200);
    const path = join(dir, 'restore.sqlite');
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
    const restored = openDatabase(path);
    try {
      expect(readState(restored)).toEqual(before);
      expect(restored.prepare('SELECT * FROM import_packages ORDER BY id').all()).toEqual(db.prepare('SELECT * FROM import_packages ORDER BY id').all());
      expect(restored.prepare('SELECT * FROM import_package_rows ORDER BY package_id,id').all()).toEqual(db.prepare('SELECT * FROM import_package_rows ORDER BY package_id,id').all());
      expect(restored.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    } finally { restored.close(); }
  });
});

describe('idempotent legacy migration', () => {
  it('preserves old evidence, non-source data, revision and raw Undo without invented history', () => {
    const path = join(dir, 'legacy.sqlite');
    const legacy = new DatabaseSync(path);
    const rawUndo = JSON.stringify({ opaque: 'Preserve exact journal bytes' });
    legacy.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT INTO meta VALUES ('revision','17'),('timezone','Europe/Berlin');
      CREATE TABLE activities(source TEXT NOT NULL,id TEXT NOT NULL,start TEXT NOT NULL,end TEXT,title TEXT NOT NULL,url TEXT,PRIMARY KEY(source,id));
      INSERT INTO activities VALUES ('slack','same','2026-10-01T09:00:00Z',NULL,'Old slack',NULL),('github','same','2026-10-02T09:00:00Z',NULL,'Old github',NULL);
      CREATE TABLE blocks(id TEXT PRIMARY KEY,start TEXT NOT NULL,end TEXT NOT NULL,note TEXT NOT NULL);
      INSERT INTO blocks VALUES ('b','2026-10-01T09:00:00Z','2026-10-01T10:00:00Z','Keep');`);
    legacy.prepare('INSERT INTO meta VALUES (?,?)').run('block_undo', rawUndo);
    legacy.close();
    let migrated = openDatabase(path);
    const before = readState(migrated);
    expect(before.revision).toBe(17);
    expect(before.activities.map(row => row.dataSourceId)).toEqual(['legacy:slack', 'legacy:github']);
    expect(before.dataSources.map(source => [source.id, source.legacyCount, source.packageCount])).toEqual(expect.arrayContaining([['legacy:slack', 1, 0], ['legacy:github', 1, 0]]));
    expect(before.dataSources.every(source => source.lastImportedAt === null)).toBe(true);
    expect(before.blocks[0]).toMatchObject({ id: 'b', note: 'Keep' });
    expect(migrated.prepare("SELECT value FROM meta WHERE key='block_undo'").get()).toEqual({ value: rawUndo });
    expect(migrated.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    migrated.close();
    migrated = openDatabase(path);
    try {
      expect(readState(migrated)).toEqual(before);
      const after = transaction(migrated, () => commitImport(migrated, {
        format: 'json', text: JSON.stringify({ schemaVersion: 1, activities: [evidence('same', 'slack', 'New legacy')] }),
        assignments: { slack: 'legacy:slack' },
      }));
      expect(after.dataSources.find(source => source.id === 'legacy:slack')).toMatchObject({ legacyCount: 0, packageCount: 1, activityCount: 1 });
      expect(after.dataSources.find(source => source.id === 'legacy:github')).toMatchObject({ legacyCount: 1, packageCount: 0 });
    } finally { migrated.close(); }
  });

  it('rolls the source migration back atomically when a legacy type cannot migrate', () => {
    const path = join(dir, 'invalid-legacy.sqlite');
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE activities(source TEXT NOT NULL,id TEXT NOT NULL,start TEXT NOT NULL,end TEXT,title TEXT NOT NULL,url TEXT,PRIMARY KEY(source,id));
      INSERT INTO activities VALUES ('slack','good','2026-10-01T09:00:00Z',NULL,'Keep',NULL),('unknown','bad','2026-10-02T09:00:00Z',NULL,'Keep too',NULL);`);
    const before = legacy.prepare('SELECT * FROM activities ORDER BY id').all();
    legacy.close();
    expect(() => openDatabase(path)).toThrow();
    const untouched = new DatabaseSync(path);
    try {
      expect(untouched.prepare('SELECT * FROM activities ORDER BY id').all()).toEqual(before);
      expect(untouched.prepare("SELECT name FROM sqlite_master WHERE name IN ('data_sources','import_packages','import_package_rows','activities_legacy')").all()).toEqual([]);
    } finally { untouched.close(); }
  });
});
