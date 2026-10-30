import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { bumpRevision, readRevision, readState, transaction } from './db.js';
import { clearUndo, saveBlockUndo } from './undo.js';
import { bad, HttpError } from './http.js';
import { reusableKey } from '../shared/reuse.js';
import { Temporal, localDate, splitAtMidnights, weekStartFor } from '../shared/time.js';
import type { AppState, BlockInput, RecentEntry, ReusableInput, WorkBlock } from '../shared/types.js';

export function revision(db: DatabaseSync, b: Record<string, unknown>): void {
  if (!Number.isSafeInteger(b.expectedRevision) || (b.expectedRevision as number) < 0) throw bad('expectedRevision fehlt.', 'error.revision.required');
  if (readRevision(db) !== b.expectedRevision) throw new HttpError(409, 'Ansicht ist veraltet. Bitte neu laden.', 'error.revision.conflict', 'REVISION_CONFLICT');
}

export function insertTemplateIfNew(db: DatabaseSync, state: AppState, input: ReusableInput): void {
  const key = reusableKey(input);
  if (!state.templates.some(template => reusableKey(template) === key)) {
    db.prepare('INSERT INTO templates(id,title,note,duration_minutes) VALUES (?,?,?,?)')
      .run(randomUUID(), input.title, input.note, input.durationMinutes);
  }
}

export function pushRecent(db: DatabaseSync, state: AppState, input: ReusableInput, createdAt: string): void {
  input = { ...input, title: input.title.trim(), note: input.note.trim() };
  const key = reusableKey(input);
  const prior = state.recentEntries.find(item => reusableKey(item) === key);
  const recent: RecentEntry[] = [{ id: prior?.id ?? randomUUID(), ...input, createdAt },
    ...state.recentEntries.filter(item => reusableKey(item) !== key)].slice(0, 20);
  db.prepare("INSERT INTO meta(key,value) VALUES ('recent_entries',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify(recent));
}

export function weekKeys(block: Pick<WorkBlock, 'start' | 'end'>, zone: string): string[] {
  return [...new Set(splitAtMidnights(block.start, block.end, zone).map(p => weekStartFor(localDate(p.start, zone))))];
}

export function checkReopen(state: AppState, affected: Iterable<string>, confirmed: boolean): string[] {
  const closed = new Set(state.weeks.filter(w => w.status === 'closed').map(w => w.weekStart));
  const weeks = [...new Set(affected)].filter(w => closed.has(w)).sort();
  if (weeks.length && !confirmed) throw new HttpError(409, 'Abgeschlossene Wochen muessen wieder geoeffnet werden.', 'error.week.reopen', 'REOPEN_REQUIRED', weeks);
  return weeks;
}

export function reopen(db: DatabaseSync, weeks: string[]): void {
  const stmt = db.prepare("UPDATE weeks SET status='open' WHERE week_start=?");
  weeks.forEach(w => stmt.run(w));
}

export function touchWeeks(db: DatabaseSync, weeks: Iterable<string>): void {
  const stmt = db.prepare("INSERT OR IGNORE INTO weeks(week_start,status) VALUES (?,'open')");
  for (const week of new Set(weeks)) stmt.run(week);
}

export function noOverlap(state: AppState, blocks: BlockInput[], ignoredId?: string): void {
  const existing = state.blocks.filter(b => b.id !== ignoredId);
  for (const b of blocks) {
    for (const old of existing) {
      if (Temporal.Instant.compare(b.start, old.end) < 0 && Temporal.Instant.compare(old.start, b.end) < 0)
        throw new HttpError(409, 'Arbeitsbloecke duerfen sich nicht ueberschneiden.', 'error.block.overlap', 'BLOCK_OVERLAP');
    }
  }
}

export function segments(input: BlockInput, zone: string): BlockInput[] {
  try { return splitAtMidnights(input.start, input.end, zone).map(x => ({ ...x, note: input.note })); }
  catch { throw bad('Arbeitsblock darf hoechstens sieben lokale Kalendertage lang sein.', 'error.block.range'); }
}

export function mutate(db: DatabaseSync, b: Record<string, unknown>, action: (state: AppState) => void, undoLabel?: string): AppState {
  return transaction(db, () => {
    revision(db, b);
    const before = readState(db);
    action(before);
    bumpRevision(db);
    clearUndo(db);
    if (undoLabel) saveBlockUndo(db, before, readState(db), undoLabel);
    return readState(db);
  });
}
