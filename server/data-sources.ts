import type { Express, Request } from 'express';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { SOURCES, type Activity, type DataPage, type ImportCounts, type ImportInput, type ImportPackage, type Source } from '../shared/types.js';
import { SOURCE_LABELS } from '../shared/data-sources.js';
import { Temporal } from '../shared/time.js';
import { ACTIVITY_TIME_ORDER, bumpRevision, readState, transaction } from './db.js';
import { bad, body, HttpError, route } from './http.js';
import { mutate, revision, UNCHANGED } from './state-changes.js';
import { clearUndo } from './undo.js';
import { analyzeImport, importDuplicates, previewImport } from './import.js';
import { parseImportInput } from './validation.js';

const pageSize = 50;
const activityColumns = 'source,id,start,end,title,url';
const packageColumns = 'id,data_source_id AS dataSourceId,file_name AS fileName,created_at AS createdAt,first_start AS firstStart,last_end AS lastEnd,total,new_count,updated,unchanged,duplicates';
type PackageRow = Omit<ImportPackage, 'counts'> & { total: number; new_count: number; updated: number; unchanged: number; duplicates: number };

function packageFromRow(row: PackageRow): ImportPackage {
  const { total, new_count, updated, unchanged, duplicates, ...item } = row;
  return { ...item, counts: { total, new: new_count, updated, unchanged, duplicates } };
}

function pageQuery(req: Request): { page: number; q: string } {
  if (Object.keys(req.query).some(key => key !== 'page' && key !== 'q')) throw bad('error.dataSource.query');
  const raw = req.query.page;
  if (raw !== undefined && (typeof raw !== 'string' || !/^(0|[1-9][0-9]*)$/.test(raw))) throw bad('error.dataSource.page');
  const page = raw === undefined ? 0 : Number(raw);
  if (!Number.isSafeInteger(page) || page > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) throw bad('error.dataSource.pageSize');
  const q = req.query.q === undefined ? '' : req.query.q;
  if (typeof q !== 'string' || q.length > 500) throw bad('error.dataSource.search');
  return { page, q: q.trim() };
}

function readPage<T>(db: DatabaseSync, table: string, columns: string, where: string, args: SQLInputValue[], order: string, page: number): DataPage<T> {
  const total = (db.prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get(...args) as { total: number }).total;
  const items = db.prepare(`SELECT ${columns} FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, pageSize, page * pageSize) as unknown as T[];
  return { items, total, page, pageSize };
}

function requireSource(db: DatabaseSync, id: string): { id: string; type: Source; name: string } {
  const source = db.prepare('SELECT id,type,name FROM data_sources WHERE id=?').get(id) as { id: string; type: Source; name: string } | undefined;
  if (!source) throw new HttpError(404, 'error.dataSource.notFound');
  return source;
}

function sourceName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) throw bad('error.validation.nameLength');
  return value.trim();
}

export function registerDataSourceRoutes(app: Express, db: DatabaseSync): void {
  app.post('/api/data-sources', route((req, res) => {
    const b = body(req);
    const name = sourceName(b.name);
    if (!SOURCES.includes(b.type as Source)) throw bad('error.dataSource.type');
    res.json(mutate(db, b, () => {
      db.prepare('INSERT INTO data_sources(id,type,name) VALUES (?,?,?)').run(randomUUID(), b.type as Source, name);
    }));
  }));
  app.put('/api/data-sources/:id', route((req, res) => {
    const b = body(req);
    const name = sourceName(b.name);
    res.json(mutate(db, b, () => {
      const source = requireSource(db, req.params.id as string);
      if (b.type !== undefined && b.type !== source.type) throw bad('error.dataSource.typeImmutable');
      if (source.name === name) return UNCHANGED;
      db.prepare('UPDATE data_sources SET name=? WHERE id=?').run(name, source.id);
    }));
  }));
  app.delete('/api/data-sources/:id', route((req, res) => {
    const b = body(req);
    res.json(mutate(db, b, () => {
      const source = requireSource(db, req.params.id as string);
      db.prepare('DELETE FROM data_sources WHERE id=?').run(source.id);
    }));
  }));
  app.get('/api/data-sources/:id/activities', route((req, res) => {
    const { page, q } = pageQuery(req);
    const source = requireSource(db, req.params.id as string);
    res.json(readPage<Activity>(db, 'activities', `data_source_id AS dataSourceId,${activityColumns}`,
      'data_source_id=? AND (?=\'\' OR instr(search_fold(title),search_fold(?))>0 OR instr(search_fold(id),search_fold(?))>0 OR instr(search_fold(url),search_fold(?))>0)',
      [source.id, q, q, q, q], `${ACTIVITY_TIME_ORDER} DESC,id`, page));
  }));
  app.get('/api/data-sources/:id/packages', route((req, res) => {
    const { page, q } = pageQuery(req);
    const source = requireSource(db, req.params.id as string);
    const result = readPage<PackageRow>(db, 'import_packages', packageColumns,
      'data_source_id=? AND (?=\'\' OR instr(search_fold(file_name),search_fold(?))>0)', [source.id, q, q], 'created_at DESC,rowid DESC', page);
    res.json({ ...result, items: result.items.map(packageFromRow) });
  }));
  app.get('/api/import-packages/:id', route((req, res) => {
    const { page, q } = pageQuery(req);
    const row = db.prepare(`SELECT ${packageColumns} FROM import_packages WHERE id=?`).get(req.params.id as string) as PackageRow | undefined;
    if (!row) throw new HttpError(404, 'error.importPackage.notFound');
    const item = packageFromRow(row);
    const result = readPage<Omit<Activity, 'dataSourceId'>>(db, 'import_package_rows', activityColumns,
      'package_id=? AND (?=\'\' OR instr(search_fold(title),search_fold(?))>0 OR instr(search_fold(id),search_fold(?))>0 OR instr(search_fold(url),search_fold(?))>0)',
      [item.id, q, q, q, q], `${ACTIVITY_TIME_ORDER} DESC,id`, page);
    res.json({ ...result, items: result.items.map(activity => ({ ...activity, dataSourceId: item.dataSourceId })), package: item });
  }));
}

/** Caller holds the transaction and has checked the revision. */
export function commitImport(db: DatabaseSync, input: ImportInput): ReturnType<typeof readState> {
  const old = readState(db);
  const preview = previewImport(input, old.activities, old.revision, old.dataSources);
  if (preview.errors.length) {
    const error = bad('error.import.commit', { count: preview.errors.length });
    // The legacy message keeps the first diagnostic, for example a parser position.
    error.message += ` ${preview.errors[0].message}`;
    throw error;
  }
  const changed = preview.rows.filter(row => row.status !== 'unchanged');
  if (!changed.length) return old;
  const duplicates = importDuplicates(input);
  const createdAt = new Date().toISOString();
  const targets = new Set(changed.map(row => row.activity.dataSourceId!));
  const upsert = db.prepare(`INSERT INTO activities(data_source_id,source,id,start,end,title,url) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(data_source_id,id) DO UPDATE SET start=excluded.start,end=excluded.end,title=excluded.title,url=excluded.url`);
  const insertSnapshot = db.prepare('INSERT INTO import_package_rows(package_id,source,id,start,end,title,url) VALUES (?,?,?,?,?,?,?)');
  for (const target of targets) {
    const rows = preview.rows.filter(row => row.activity.dataSourceId === target);
    const type = rows[0].activity.source;
    if (!old.dataSources.some(source => source.id === target)) db.prepare('INSERT INTO data_sources(id,type,name) VALUES (?,?,?)').run(target, type, SOURCE_LABELS[type]);
    const counts: ImportCounts = { total: rows.length + (duplicates[type] ?? 0), new: 0, updated: 0, unchanged: 0, duplicates: duplicates[type] ?? 0 };
    rows.forEach(row => { counts[row.status]++; });
    let firstStart = rows[0].activity.start;
    let lastEnd = rows[0].activity.end ?? rows[0].activity.start;
    for (const { activity } of rows) {
      if (Temporal.Instant.compare(activity.start, firstStart) < 0) firstStart = activity.start;
      const end = activity.end ?? activity.start;
      if (Temporal.Instant.compare(end, lastEnd) > 0) lastEnd = end;
    }
    const id = randomUUID();
    db.prepare('INSERT INTO import_packages(id,data_source_id,file_name,created_at,first_start,last_end,total,new_count,updated,unchanged,duplicates) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, target, input.fileName ?? 'Texteingabe', createdAt, firstStart, lastEnd, counts.total, counts.new, counts.updated, counts.unchanged, counts.duplicates);
    for (const { activity: a, status } of rows) {
      insertSnapshot.run(id, a.source, a.id, a.start, a.end, a.title, a.url);
      if (status !== 'unchanged') upsert.run(target, a.source, a.id, a.start, a.end, a.title, a.url);
    }
  }
  bumpRevision(db); clearUndo(db);
  return readState(db);
}

export function registerImportRoutes(app: Express, db: DatabaseSync): void {
  app.post('/api/import/analyze', route((req, res) => {
    res.json(analyzeImport(parseImportInput(body(req))));
  }));
  app.post('/api/import/preview', route((req, res) => {
    const input = parseImportInput(body(req));
    const old = readState(db);
    res.json(previewImport(input, old.activities, old.revision, old.dataSources));
  }));
  app.post('/api/import/commit', route((req, res) => {
    const b = body(req);
    const input = parseImportInput(b);
    const state = transaction(db, () => {
      revision(db, b);
      return commitImport(db, input);
    });
    res.json(state);
  }));
}
