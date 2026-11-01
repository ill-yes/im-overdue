import { IMPORT_MAX_BYTES } from '../shared/import-contract.js';
import { bad, HttpError } from './http.js';
import { REUSABLE_DURATION_MAX_MINUTES, REUSABLE_NOTE_MAX_LENGTH, REUSABLE_TITLE_MAX_LENGTH } from '../shared/reuse.js';
import { Temporal, minutesBetween, weekStartFor } from '../shared/time.js';
import { SOURCES, type BlockInput, type ImportInput, type ReusableInput, type Source, type VacationChange } from '../shared/types.js';

export function parseImportInput(b: Record<string, unknown>): ImportInput {
  if ((b.format !== 'json' && b.format !== 'csv') || typeof b.text !== 'string') throw bad('error.import.input');
  if (Buffer.byteLength(b.text, 'utf8') > IMPORT_MAX_BYTES) throw new HttpError(413, 'error.import.size');
  let assignments: ImportInput['assignments'];
  if (b.assignments !== undefined) {
    if (!b.assignments || typeof b.assignments !== 'object' || Array.isArray(b.assignments)) throw bad('error.import.assignmentsObject');
    const entries = Object.entries(b.assignments);
    if (entries.some(([key, value]) => !SOURCES.includes(key as Source) || typeof value !== 'string' || !value || value.length > 500)) throw bad('error.import.assignments');
    assignments = Object.fromEntries(entries) as ImportInput['assignments'];
  }
  if (b.fileName !== undefined && (typeof b.fileName !== 'string' || !b.fileName.trim() || b.fileName.length > 255)) throw bad('error.import.fileName');
  return { format: b.format, text: b.text, ...(assignments !== undefined ? { assignments } : {}), ...(b.fileName !== undefined ? { fileName: (b.fileName as string).trim() } : {}) };
}

export function bool(value: unknown, name: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw bad('error.validation.boolean', { field: name });
  return value;
}

function utcMinute(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !/(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/i.test(value)) throw bad('error.validation.offset', { field });
  let instant: Temporal.Instant;
  try { instant = Temporal.Instant.from(value); }
  catch { throw bad('error.validation.time', { field }); }
  if (instant.epochNanoseconds % 60_000_000_000n !== 0n) throw bad('error.validation.minute', { field });
  return instant.toString();
}

export function validBlock(b: Record<string, unknown>): BlockInput {
  const start = utcMinute(b.start, 'start');
  const end = utcMinute(b.end, 'end');
  if (Temporal.Instant.compare(start, end) >= 0) throw bad('error.validation.end');
  if (typeof b.note !== 'string' || b.note.length > REUSABLE_NOTE_MAX_LENGTH) throw bad('error.validation.note', { max: REUSABLE_NOTE_MAX_LENGTH });
  const title = b.title === undefined ? undefined : validTitle(b.title, false);
  const rememberTemplate = bool(b.rememberTemplate, 'rememberTemplate');
  return { start, end, note: b.note, title, rememberTemplate };
}

function validTitle(value: unknown, required: boolean): string {
  if (typeof value !== 'string') throw bad('error.validation.nameText');
  const title = value.trim();
  if (title.length > REUSABLE_TITLE_MAX_LENGTH || (required && !title)) throw bad('error.validation.nameLength');
  return title;
}

export function validReusable(b: Record<string, unknown>): ReusableInput {
  const title = validTitle(b.title, true);
  if (typeof b.note !== 'string' || b.note.length > REUSABLE_NOTE_MAX_LENGTH) throw bad('error.validation.note', { max: REUSABLE_NOTE_MAX_LENGTH });
  if (!Number.isInteger(b.durationMinutes) || (b.durationMinutes as number) < 1 || (b.durationMinutes as number) > REUSABLE_DURATION_MAX_MINUTES)
    throw bad('error.validation.duration', { max: REUSABLE_DURATION_MAX_MINUTES });
  return { title, note: b.note.trim(), durationMinutes: b.durationMinutes as number };
}

export function reusableForBlock(input: BlockInput, title: string): ReusableInput {
  return validReusable({ title, note: input.note, durationMinutes: minutesBetween(input.start, input.end) });
}

export function validDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad('error.validation.dateFormat');
  try { if (Temporal.PlainDate.from(value).toString() !== value) throw Error(); }
  catch { throw bad('error.validation.date'); }
  return value;
}

export function monday(value: unknown): string {
  const date = validDate(value);
  if (weekStartFor(date) !== date) throw bad('error.validation.monday');
  return date;
}

export function validVacationChanges(value: unknown): VacationChange[] {
  if (!Array.isArray(value) || !value.length || value.length > 366) throw bad('error.vacation.count');
  const dates = new Set<string>();
  const days = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw bad('error.vacation.day');
    const date = validDate(item.date);
    if (dates.has(date)) throw bad('error.vacation.duplicate');
    dates.add(date);
    if (item.fraction !== null && item.fraction !== 0.5 && item.fraction !== 1) throw bad('error.vacation.fraction');
    return { date, fraction: item.fraction } as VacationChange;
  }).sort((a, z) => a.date.localeCompare(z.date));
  if (Temporal.PlainDate.from(days[0].date).until(Temporal.PlainDate.from(days[days.length - 1].date)).days >= 366)
    throw bad('error.vacation.range');
  return days;
}

export function allowanceDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 3650 || !Number.isInteger(value * 2))
    throw bad('error.vacation.allowance');
  return value;
}

export function validZone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) throw bad('error.validation.timezone');
  try { new Intl.DateTimeFormat('de-DE', { timeZone: value }); Temporal.Now.plainDateISO(value); }
  catch { throw bad('error.validation.timezone'); }
  return value;
}
