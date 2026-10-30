import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AbsenceDay, AccountEntry, AccountOpening, HolidayOverride, HolidayProfile, Activity, AppState, CalendarNote, DataSource, RecentEntry, Source, VacationAllowance, VacationDay, WorkBlock, WorkProfile, WorkTemplate, WeekRecord } from '../shared/types.js';
import { legacyDataSourceId, SOURCE_LABELS } from '../shared/data-sources.js';
import { readUndoInfo } from './undo.js';

// Imports are canonical UTC instants. Fixed-width fractions preserve nanoseconds,
// unlike julianday(), and sort whole-second instants before fractional instants.
export const ACTIVITY_TIME_ORDER = "substr(start,1,19) || '.' || substr(CASE WHEN substr(start,20,1)='.' THEN replace(substr(start,21),'Z','') ELSE '' END || '000000000',1,9)";

export function openDatabase(path = process.env.IM_OVERDUE_DB ?? 'data/im-overdue.sqlite'): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    initializeDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function initializeDatabase(db: DatabaseSync): void {
  db.function('search_fold', { deterministic: true }, value => typeof value === 'string' ? value.normalize('NFC').toLocaleLowerCase('de-DE') : '');
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activities (source TEXT NOT NULL, id TEXT NOT NULL, start TEXT NOT NULL, end TEXT, title TEXT NOT NULL, url TEXT, PRIMARY KEY(source,id));
    CREATE TABLE IF NOT EXISTS blocks (id TEXT PRIMARY KEY, start TEXT NOT NULL, end TEXT NOT NULL, note TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', created_at TEXT);
    CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT NOT NULL, duration_minutes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, effective_from TEXT UNIQUE, weekly_minutes INTEGER NOT NULL, workdays TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS weeks (week_start TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('open','closed')));
    CREATE TABLE IF NOT EXISTS notes (scope TEXT NOT NULL CHECK(scope IN ('day','week')), date TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(scope,date));
    CREATE TABLE IF NOT EXISTS vacations (date TEXT PRIMARY KEY, fraction REAL NOT NULL CHECK(fraction IN (0.5,1)));
    CREATE TABLE IF NOT EXISTS vacation_allowances (year INTEGER PRIMARY KEY CHECK(year BETWEEN 1 AND 9999), entitlement_days REAL NOT NULL CHECK(entitlement_days BETWEEN 0 AND 3650 AND entitlement_days*2=CAST(entitlement_days*2 AS INTEGER)), carryover_days REAL NOT NULL CHECK(carryover_days BETWEEN 0 AND 3650 AND carryover_days*2=CAST(carryover_days*2 AS INTEGER)));`);
  const blockColumns = db.prepare('PRAGMA table_info(blocks)').all() as unknown as { name: string }[];
  if (!blockColumns.some(column => column.name === 'title')) db.exec("ALTER TABLE blocks ADD COLUMN title TEXT NOT NULL DEFAULT ''");
  if (!blockColumns.some(column => column.name === 'created_at')) db.exec('ALTER TABLE blocks ADD COLUMN created_at TEXT');
  migrateDataSources(db);
  migrateAccounting(db);
  if (!db.prepare("SELECT value FROM meta WHERE key='revision'").get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run('revision', '0');
      db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run('timezone', 'Europe/Berlin');
      db.prepare('INSERT INTO profiles(id,effective_from,weekly_minutes,workdays) VALUES (?,?,?,?)')
        .run(randomUUID(), null, 2400, JSON.stringify([1, 2, 3, 4, 5]));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}

/** Keep legacy evidence, revision and Undo byte-for-byte; no package history is invented. */
function migrateDataSources(db: DatabaseSync): void {
  transaction(db, () => {
    db.exec(`CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('google_calendar','slack','github','other')), name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS import_packages (
        id TEXT PRIMARY KEY, data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL, created_at TEXT NOT NULL, first_start TEXT NOT NULL, last_end TEXT NOT NULL,
        total INTEGER NOT NULL, new_count INTEGER NOT NULL, updated INTEGER NOT NULL, unchanged INTEGER NOT NULL, duplicates INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS import_package_rows (
        package_id TEXT NOT NULL REFERENCES import_packages(id) ON DELETE CASCADE,
        source TEXT NOT NULL, id TEXT NOT NULL, start TEXT NOT NULL, end TEXT, title TEXT NOT NULL, url TEXT,
        PRIMARY KEY(package_id,id));`);
    const columns = db.prepare('PRAGMA table_info(activities)').all() as unknown as { name: string }[];
    if (!columns.some(column => column.name === 'data_source_id')) {
      const sources = db.prepare('SELECT DISTINCT source FROM activities').all() as unknown as { source: Source }[];
      const insert = db.prepare('INSERT INTO data_sources(id,type,name) VALUES (?,?,?)');
      for (const { source } of sources) insert.run(legacyDataSourceId(source), source, SOURCE_LABELS[source]);
      db.exec(`ALTER TABLE activities RENAME TO activities_legacy;
        CREATE TABLE activities (
          data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
          source TEXT NOT NULL, id TEXT NOT NULL, start TEXT NOT NULL, end TEXT, title TEXT NOT NULL, url TEXT,
          PRIMARY KEY(data_source_id,id));
        INSERT INTO activities(data_source_id,source,id,start,end,title,url)
          SELECT 'legacy:' || source,source,id,start,end,title,url FROM activities_legacy;
        DROP TABLE activities_legacy;`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS activities_by_source_start ON activities(data_source_id,start,id);
      CREATE INDEX IF NOT EXISTS packages_by_source_created ON import_packages(data_source_id,created_at,id);
      CREATE INDEX IF NOT EXISTS package_rows_by_id ON import_package_rows(id,package_id);`);
  });
}

/** Additive migration: existing records, revision and undo are left untouched. */
function migrateAccounting(db: DatabaseSync): void {
  transaction(db, () => db.exec(`
    CREATE TABLE IF NOT EXISTS account_opening (singleton INTEGER PRIMARY KEY CHECK(singleton=1), date TEXT NOT NULL, minutes INTEGER NOT NULL CHECK(minutes BETWEEN -1000000000 AND 1000000000));
    CREATE TABLE IF NOT EXISTS account_entries (id TEXT PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('payout','correction')), minutes INTEGER NOT NULL CHECK(minutes BETWEEN -1000000000 AND 1000000000 AND minutes!=0 AND (kind!='payout' OR minutes<0)), reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS absences (date TEXT PRIMARY KEY, sickness INTEGER NOT NULL CHECK(sickness IN (0,1)), compensation_mode TEXT CHECK(compensation_mode IN ('fraction','minutes')), compensation_value REAL,
      CHECK((compensation_mode IS NULL AND compensation_value IS NULL) OR (compensation_mode='fraction' AND compensation_value IN (0.5,1)) OR (compensation_mode='minutes' AND compensation_value BETWEEN 1 AND 10080 AND compensation_value=CAST(compensation_value AS INTEGER))));
    CREATE TABLE IF NOT EXISTS holiday_profiles (id TEXT PRIMARY KEY, effective_from TEXT NOT NULL UNIQUE, region TEXT, rule_version INTEGER NOT NULL CHECK(rule_version=1));
    CREATE TABLE IF NOT EXISTS holiday_overrides (date TEXT PRIMARY KEY, name TEXT);
  `));
}

export function writeAbsence(db: DatabaseSync, day: AbsenceDay): void {
  if (!day.sickness && !day.compensation) db.prepare('DELETE FROM absences WHERE date=?').run(day.date);
  else db.prepare('INSERT INTO absences(date,sickness,compensation_mode,compensation_value) VALUES (?,?,?,?) ON CONFLICT(date) DO UPDATE SET sickness=excluded.sickness,compensation_mode=excluded.compensation_mode,compensation_value=excluded.compensation_value')
    .run(day.date, Number(day.sickness), day.compensation?.mode ?? null, day.compensation?.value ?? null);
}

export function readDataSources(db: DatabaseSync): DataSource[] {
  return db.prepare(`SELECT d.id,d.type,d.name,
    (SELECT count(*) FROM activities a WHERE a.data_source_id=d.id) AS activityCount,
    (SELECT count(*) FROM import_packages p WHERE p.data_source_id=d.id) AS packageCount,
    (SELECT max(created_at) FROM import_packages p WHERE p.data_source_id=d.id) AS lastImportedAt,
    (SELECT start FROM activities a WHERE a.data_source_id=d.id ORDER BY ${ACTIVITY_TIME_ORDER},id LIMIT 1) AS firstActivityStart,
    (SELECT count(*) FROM activities a WHERE a.data_source_id=d.id AND NOT EXISTS (
      SELECT 1 FROM import_package_rows r JOIN import_packages p ON p.id=r.package_id
      WHERE p.data_source_id=d.id AND r.id=a.id)) AS legacyCount
    FROM data_sources d ORDER BY d.rowid`).all() as unknown as DataSource[];
}

export function readState(db: DatabaseSync): AppState {
  const meta = db.prepare('SELECT key,value FROM meta').all() as unknown as { key: string; value: string }[];
  const m = Object.fromEntries(meta.map(x => [x.key, x.value]));
  const activities = db.prepare(`SELECT data_source_id AS dataSourceId,source,id,start,end,title,url FROM activities ORDER BY ${ACTIVITY_TIME_ORDER},data_source_id,id`).all() as unknown as Activity[];
  const blocks = (db.prepare('SELECT id,start,end,note,title,created_at FROM blocks ORDER BY start,id').all() as unknown as (Omit<WorkBlock, 'createdAt'> & { created_at: string | null })[])
    .map(({ created_at, ...block }) => ({ ...block, createdAt: created_at }));
  const templates = (db.prepare('SELECT id,title,note,duration_minutes FROM templates ORDER BY rowid').all() as unknown as
    { id: string; title: string; note: string; duration_minutes: number }[])
    .map(({ duration_minutes, ...entry }) => ({ ...entry, durationMinutes: duration_minutes })) as WorkTemplate[];
  const recentEntries = m.recent_entries ? JSON.parse(m.recent_entries) as RecentEntry[] : [];
  const profiles = (db.prepare('SELECT id,effective_from,weekly_minutes,workdays FROM profiles ORDER BY effective_from').all() as unknown as {
    id: string; effective_from: string | null; weekly_minutes: number; workdays: string
  }[]).map(p => ({ id: p.id, effectiveFrom: p.effective_from, weeklyMinutes: p.weekly_minutes, workdays: JSON.parse(p.workdays) as number[] })) as WorkProfile[];
  const weeks = (db.prepare('SELECT week_start,status FROM weeks ORDER BY week_start').all() as unknown as {
    week_start: string; status: 'open' | 'closed'
  }[]).map(w => ({ weekStart: w.week_start, status: w.status })) as WeekRecord[];
  const notes = db.prepare('SELECT scope,date,text FROM notes ORDER BY scope,date').all() as unknown as CalendarNote[];
  const vacations = db.prepare('SELECT date,fraction FROM vacations ORDER BY date').all() as unknown as VacationDay[];
  const vacationAllowances = (db.prepare('SELECT year,entitlement_days,carryover_days FROM vacation_allowances ORDER BY year').all() as unknown as
    { year: number; entitlement_days: number; carryover_days: number }[])
    .map(({ year, entitlement_days, carryover_days }) => ({ year, entitlementDays: entitlement_days, carryoverDays: carryover_days })) as VacationAllowance[];
  const accountOpening = (db.prepare('SELECT date,minutes FROM account_opening').get() as unknown as AccountOpening | undefined) ?? null;
  const accountEntries = db.prepare('SELECT id,date,kind,minutes,reason FROM account_entries ORDER BY date,id').all() as unknown as AccountEntry[];
  const absences = (db.prepare('SELECT date,sickness,compensation_mode AS mode,compensation_value AS value FROM absences ORDER BY date').all() as unknown as { date: string; sickness: number; mode: 'fraction' | 'minutes' | null; value: number | null }[])
    .map(row => ({ date: row.date, sickness: Boolean(row.sickness), compensation: row.mode === null ? null : { mode: row.mode, value: row.value } })) as AbsenceDay[];
  const holidayProfiles = db.prepare('SELECT id,effective_from AS effectiveFrom,region,rule_version AS ruleVersion FROM holiday_profiles ORDER BY effective_from').all() as unknown as HolidayProfile[];
  const holidayOverrides = db.prepare('SELECT date,name FROM holiday_overrides ORDER BY date').all() as unknown as HolidayOverride[];
  const revision = Number(m.revision);
  return { dataSources: readDataSources(db), revision, undo: readUndoInfo(db, revision), settings: { timezone: m.timezone }, profiles, activities, blocks, templates, recentEntries, weeks, notes, vacations, vacationAllowances, accountOpening, accountEntries, absences, holidayProfiles, holidayOverrides };
}

export function transaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function bumpRevision(db: DatabaseSync): void {
  db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
}
