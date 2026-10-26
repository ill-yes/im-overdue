import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Temporal, weekStartFor } from '../shared/time.js';
import type { AppState, RecentEntry, VacationDay, WeekRecord, WorkBlock, WorkTemplate } from '../shared/types.js';
import { REUSABLE_DURATION_MAX_MINUTES, REUSABLE_NOTE_MAX_LENGTH, REUSABLE_TITLE_MAX_LENGTH } from '../shared/reuse.js';

const KEY = 'block_undo';
type Change<T> = { key: string; before: T | null; after: T | null };
interface UndoBase {
  token: string;
  label: string;
  revision: number;
  blocks: Change<WorkBlock>[];
  weeks: Change<WeekRecord>[];
}
export type UndoEntry = (UndoBase & { version: 1 }) | (UndoBase & {
  version: 2;
  templates: Change<WorkTemplate>[];
  recentEntries: { before: RecentEntry[]; after: RecentEntry[] };
}) | (UndoBase & { version: 3; vacations: Change<VacationDay>[] });

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validBlock(value: unknown, key: string): value is WorkBlock {
  if (!object(value) || value.id !== key || typeof value.start !== 'string' || typeof value.end !== 'string' || typeof value.note !== 'string') return false;
  try {
    return value.note.length <= REUSABLE_NOTE_MAX_LENGTH && (value.title === undefined || (typeof value.title === 'string' && value.title.length <= REUSABLE_TITLE_MAX_LENGTH)) &&
      (value.createdAt === undefined || value.createdAt === null || (typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt)))) &&
      Temporal.Instant.from(value.start).toString() === value.start &&
      Temporal.Instant.from(value.end).toString() === value.end && Temporal.Instant.compare(value.start, value.end) < 0;
  }
  catch { return false; }
}
function validReusable(value: unknown, requireTitle: boolean): boolean {
  return object(value) && typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.title === 'string' && (!requireTitle || value.title.trim().length > 0) && value.title.length <= REUSABLE_TITLE_MAX_LENGTH &&
    typeof value.note === 'string' && value.note.length <= REUSABLE_NOTE_MAX_LENGTH &&
    Number.isInteger(value.durationMinutes) && Number(value.durationMinutes) >= 1 && Number(value.durationMinutes) <= REUSABLE_DURATION_MAX_MINUTES;
}
function validTemplate(value: unknown, key: string): value is WorkTemplate {
  return validReusable(value, true) && (value as WorkTemplate).id === key;
}
function validRecent(value: unknown): value is RecentEntry {
  return validReusable(value, false) && typeof (value as RecentEntry).createdAt === 'string' &&
    !Number.isNaN(Date.parse((value as RecentEntry).createdAt));
}
function validRecentList(value: unknown): value is RecentEntry[] {
  return Array.isArray(value) && value.length <= 20 && value.every(validRecent) &&
    new Set(value.map(x => x.id)).size === value.length;
}
function normalizeBlock(block: WorkBlock | null): WorkBlock | null {
  return block ? { ...block, title: block.title ?? '', createdAt: block.createdAt ?? null } : null;
}
function validWeek(value: unknown, key: string): value is WeekRecord {
  if (!object(value) || value.weekStart !== key || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(key) || (value.status !== 'open' && value.status !== 'closed')) return false;
  try { return weekStartFor(key) === key; }
  catch { return false; }
}
function validVacation(value: unknown, key: string): value is VacationDay {
  if (!object(value) || value.date !== key || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(key) || (value.fraction !== 0.5 && value.fraction !== 1)) return false;
  try { return Temporal.PlainDate.from(key).toString() === key; }
  catch { return false; }
}
function validChanges<T>(value: unknown, valid: (item: unknown, key: string) => item is T): value is Change<T>[] {
  if (!Array.isArray(value)) return false;
  const keys = new Set<string>();
  for (const change of value) {
    if (!object(change) || typeof change.key !== 'string' || keys.has(change.key) || !('before' in change) || !('after' in change) ||
      (change.before !== null && !valid(change.before, change.key)) || (change.after !== null && !valid(change.after, change.key)) ||
      (change.before === null && change.after === null)) return false;
    keys.add(change.key);
  }
  return true;
}

/** Invalid or future-version journals are unavailable and are never applied. */
export function readUndo(db: DatabaseSync): UndoEntry | null {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get(KEY) as { value: string } | undefined;
  if (!row) return null;
  // JSON may expand every accepted note character into a six-character escape.
  // This accommodates 32 block, 32 template and 20 before/after recent entries.
  if (row.value.length > 4 * 1024 * 1024) return null;
  try {
    const value: unknown = JSON.parse(row.value);
    if (!object(value) || (value.version !== 1 && value.version !== 2 && value.version !== 3) || typeof value.token !== 'string' || !/^[0-9a-f-]{36}$/.test(value.token) ||
      !(value.version === 3 ? ['Urlaub eingetragen', 'Urlaub geändert', 'Urlaub entfernt'] : ['Arbeitszeit hinzugefügt', 'Arbeitszeit geändert', 'Arbeitszeit gelöscht']).includes(String(value.label)) ||
      !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !validChanges(value.blocks, validBlock) ||
      !validChanges(value.weeks, validWeek) || (value.blocks as unknown[]).length > 32 || (value.weeks as unknown[]).length > (value.version === 3 ? 54 : 16) ||
      (value.version === 1 && (value.blocks as unknown[]).length === 0 && (value.weeks as unknown[]).length === 0)) return null;
    const blocks = (value.blocks as Change<WorkBlock>[]).map(c => ({ ...c, before: normalizeBlock(c.before), after: normalizeBlock(c.after) }));
    const base = { token: value.token, label: value.label, revision: value.revision, blocks, weeks: value.weeks } as UndoBase;
    if (value.version === 1) return { ...base, version: 1 };
    if (value.version === 3) {
      if (blocks.length || !validChanges(value.vacations, validVacation) || !value.vacations.length || value.vacations.length > 366) return null;
      const dates = value.vacations.map(change => change.key).sort();
      if (Temporal.PlainDate.from(dates[0]).until(Temporal.PlainDate.from(dates[dates.length - 1])).days >= 366) return null;
      const affectedWeeks = new Set(dates.map(weekStartFor));
      if (base.weeks.some(change => !affectedWeeks.has(change.key))) return null;
      return { ...base, version: 3, vacations: value.vacations };
    }
    if (!validChanges(value.templates, validTemplate) || (value.templates as unknown[]).length > 32 ||
      !object(value.recentEntries) || !validRecentList(value.recentEntries.before) || !validRecentList(value.recentEntries.after) ||
      (!blocks.length && !(value.weeks as unknown[]).length && !(value.templates as unknown[]).length &&
        JSON.stringify(value.recentEntries.before) === JSON.stringify(value.recentEntries.after))) return null;
    return { ...base, version: 2, templates: value.templates, recentEntries: value.recentEntries } as UndoEntry;
  } catch { return null; }
}

export function readUndoInfo(db: DatabaseSync, revision: number): AppState['undo'] {
  const entry = readUndo(db);
  return entry && entry.revision === revision ? { token: entry.token, label: entry.label } : null;
}

export function clearUndo(db: DatabaseSync): void {
  db.prepare('DELETE FROM meta WHERE key=?').run(KEY);
}

function changed<T>(before: T[], after: T[], keyOf: (item: T) => string): Change<T>[] {
  const first = new Map(before.map(item => [keyOf(item), item]));
  const second = new Map(after.map(item => [keyOf(item), item]));
  const keys = new Set([...first.keys(), ...second.keys()]);
  return [...keys].sort().flatMap(key => {
    const prior = first.get(key) ?? null;
    const next = second.get(key) ?? null;
    return JSON.stringify(prior) === JSON.stringify(next) ? [] : [{ key, before: prior, after: next }];
  });
}

export function saveBlockUndo(db: DatabaseSync, before: AppState, after: AppState, label: string): void {
  const blocks = changed(before.blocks, after.blocks, block => block.id);
  const weeks = changed(before.weeks, after.weeks, week => week.weekStart);
  const templates = changed(before.templates, after.templates, template => template.id);
  const recentEntries = { before: before.recentEntries, after: after.recentEntries };
  if (!blocks.length && !weeks.length && !templates.length && same(recentEntries.before, recentEntries.after)) return;
  const entry: UndoEntry = { version: 2, token: randomUUID(), label, revision: after.revision, blocks, weeks, templates, recentEntries };
  db.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(KEY, JSON.stringify(entry));
}

export function saveVacationUndo(db: DatabaseSync, before: AppState, after: AppState, label: string): void {
  const vacations = changed(before.vacations, after.vacations, day => day.date);
  const weeks = changed(before.weeks, after.weeks, week => week.weekStart);
  if (!vacations.length) return;
  const entry: UndoEntry = { version: 3, token: randomUUID(), label, revision: after.revision, blocks: [], weeks, vacations };
  db.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(KEY, JSON.stringify(entry));
}

function same<T>(a: T | null, b: T | null): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** Verifies the exact affected after-state and overlap before changing any row. */
export function applyBlockUndo(db: DatabaseSync, current: AppState, entry: UndoEntry): boolean {
  if (entry.revision !== current.revision) return false;
  const blocks = new Map(current.blocks.map(block => [block.id, block]));
  const weeks = new Map(current.weeks.map(week => [week.weekStart, week]));
  if (entry.blocks.some(c => !same(blocks.get(c.key) ?? null, c.after)) ||
      entry.weeks.some(c => !same(weeks.get(c.key) ?? null, c.after))) return false;
  if (entry.version === 2) {
    const templates = new Map(current.templates.map(template => [template.id, template]));
    if (entry.templates.some(c => !same(templates.get(c.key) ?? null, c.after)) ||
      !same(current.recentEntries, entry.recentEntries.after)) return false;
  }
  if (entry.version === 3) {
    const vacations = new Map(current.vacations.map(day => [day.date, day]));
    if (entry.vacations.some(change => !same(vacations.get(change.key) ?? null, change.after))) return false;
  }
  const changedIds = new Set(entry.blocks.map(c => c.key));
  const remaining = current.blocks.filter(block => !changedIds.has(block.id));
  const restored = entry.blocks.flatMap(c => c.before ? [c.before] : []);
  const combined = [...remaining, ...restored].sort((a, b) => a.start.localeCompare(b.start));
  if (entry.version !== 3) {
    for (let i = 1; i < combined.length; i++) {
      if (Temporal.Instant.compare(combined[i - 1].end, combined[i].start) > 0) return false;
    }
  }
  const deleteBlock = db.prepare('DELETE FROM blocks WHERE id=?');
  const insertBlock = db.prepare('INSERT INTO blocks(id,start,end,note,title,created_at) VALUES (?,?,?,?,?,?)');
  entry.blocks.forEach(c => deleteBlock.run(c.key));
  restored.forEach(block => insertBlock.run(block.id, block.start, block.end, block.note, block.title, block.createdAt));
  const deleteWeek = db.prepare('DELETE FROM weeks WHERE week_start=?');
  const insertWeek = db.prepare('INSERT INTO weeks(week_start,status) VALUES (?,?)');
  entry.weeks.forEach(c => deleteWeek.run(c.key));
  entry.weeks.forEach(c => { if (c.before) insertWeek.run(c.before.weekStart, c.before.status); });
  if (entry.version === 2) {
    const deleteTemplate = db.prepare('DELETE FROM templates WHERE id=?');
    const insertTemplate = db.prepare('INSERT INTO templates(id,title,note,duration_minutes) VALUES (?,?,?,?)');
    entry.templates.forEach(c => deleteTemplate.run(c.key));
    entry.templates.forEach(c => { if (c.before) insertTemplate.run(c.before.id, c.before.title, c.before.note, c.before.durationMinutes); });
    db.prepare("INSERT INTO meta(key,value) VALUES ('recent_entries',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(entry.recentEntries.before));
  }
  if (entry.version === 3) {
    const deleteVacation = db.prepare('DELETE FROM vacations WHERE date=?');
    const insertVacation = db.prepare('INSERT INTO vacations(date,fraction) VALUES (?,?)');
    entry.vacations.forEach(change => deleteVacation.run(change.key));
    entry.vacations.forEach(change => { if (change.before) insertVacation.run(change.before.date, change.before.fraction); });
  }
  return true;
}
