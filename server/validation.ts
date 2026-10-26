import { IMPORT_MAX_BYTES } from '../shared/import-contract.js';
import { bad, HttpError } from './http.js';
import { REUSABLE_DURATION_MAX_MINUTES, REUSABLE_NOTE_MAX_LENGTH, REUSABLE_TITLE_MAX_LENGTH } from '../shared/reuse.js';
import { Temporal, minutesBetween, weekStartFor } from '../shared/time.js';
import { SOURCES, type BlockInput, type ImportInput, type ReusableInput, type Source, type VacationChange } from '../shared/types.js';

export function parseImportInput(b: Record<string, unknown>): ImportInput {
  if ((b.format !== 'json' && b.format !== 'csv') || typeof b.text !== 'string') throw bad('format und text erforderlich.', 'error.import.input');
  if (Buffer.byteLength(b.text, 'utf8') > IMPORT_MAX_BYTES) throw new HttpError(413, 'Importdatei ist groesser als 5 MB.', 'error.import.size');
  let assignments: ImportInput['assignments'];
  if (b.assignments !== undefined) {
    if (!b.assignments || typeof b.assignments !== 'object' || Array.isArray(b.assignments)) throw bad('assignments muss ein Objekt sein.', 'error.import.assignmentsObject');
    const entries = Object.entries(b.assignments);
    if (entries.some(([key, value]) => !SOURCES.includes(key as Source) || typeof value !== 'string' || !value || value.length > 500)) throw bad('Ungueltige Importzuordnung.', 'error.import.assignments');
    assignments = Object.fromEntries(entries) as ImportInput['assignments'];
  }
  if (b.fileName !== undefined && (typeof b.fileName !== 'string' || !b.fileName.trim() || b.fileName.length > 255)) throw bad('Dateiname muss 1 bis 255 Zeichen enthalten.', 'error.import.fileName');
  return { format: b.format, text: b.text, ...(assignments !== undefined ? { assignments } : {}), ...(b.fileName !== undefined ? { fileName: (b.fileName as string).trim() } : {}) };
}

export function bool(value: unknown, name: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw bad(`${name} muss boolean sein.`, 'error.validation.boolean', { field: name });
  return value;
}

function utcMinute(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !/(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/i.test(value)) throw bad(`${field}: UTC-Offset oder Z erforderlich.`, 'error.validation.offset', { field });
  let instant: Temporal.Instant;
  try { instant = Temporal.Instant.from(value); }
  catch { throw bad(`${field}: ungueltige Zeit.`, 'error.validation.time', { field }); }
  if (instant.epochNanoseconds % 60_000_000_000n !== 0n) throw bad(`${field}: nur volle Minuten erlaubt.`, 'error.validation.minute', { field });
  return instant.toString();
}

export function validBlock(b: Record<string, unknown>): BlockInput {
  const start = utcMinute(b.start, 'start');
  const end = utcMinute(b.end, 'end');
  if (Temporal.Instant.compare(start, end) >= 0) throw bad('Ende muss nach Beginn liegen.', 'error.validation.end');
  if (typeof b.note !== 'string' || b.note.length > REUSABLE_NOTE_MAX_LENGTH) throw bad(`Notiz muss Text mit maximal ${REUSABLE_NOTE_MAX_LENGTH} Zeichen sein.`, 'error.validation.note', { max: REUSABLE_NOTE_MAX_LENGTH });
  const title = b.title === undefined ? undefined : validTitle(b.title, false);
  const rememberTemplate = bool(b.rememberTemplate, 'rememberTemplate');
  return { start, end, note: b.note, title, rememberTemplate };
}

function validTitle(value: unknown, required: boolean): string {
  if (typeof value !== 'string') throw bad('Name muss Text sein.', 'error.validation.nameText');
  const title = value.trim();
  if (title.length > REUSABLE_TITLE_MAX_LENGTH || (required && !title)) throw bad('Name muss 1 bis 160 Zeichen enthalten.', 'error.validation.nameLength');
  return title;
}

export function validReusable(b: Record<string, unknown>): ReusableInput {
  const title = validTitle(b.title, true);
  if (typeof b.note !== 'string' || b.note.length > REUSABLE_NOTE_MAX_LENGTH) throw bad(`Notiz muss Text mit maximal ${REUSABLE_NOTE_MAX_LENGTH} Zeichen sein.`, 'error.validation.note', { max: REUSABLE_NOTE_MAX_LENGTH });
  if (!Number.isInteger(b.durationMinutes) || (b.durationMinutes as number) < 1 || (b.durationMinutes as number) > REUSABLE_DURATION_MAX_MINUTES)
    throw bad(`Dauer muss 1 bis ${REUSABLE_DURATION_MAX_MINUTES} ganze Minuten betragen.`, 'error.validation.duration', { max: REUSABLE_DURATION_MAX_MINUTES });
  return { title, note: b.note.trim(), durationMinutes: b.durationMinutes as number };
}

export function reusableForBlock(input: BlockInput, title: string): ReusableInput {
  return validReusable({ title, note: input.note, durationMinutes: minutesBetween(input.start, input.end) });
}

export function validDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad('Datum im Format YYYY-MM-DD erwartet.', 'error.validation.dateFormat');
  try { if (Temporal.PlainDate.from(value).toString() !== value) throw Error(); }
  catch { throw bad('Ungueltiges Datum.', 'error.validation.date'); }
  return value;
}

export function monday(value: unknown): string {
  const date = validDate(value);
  if (weekStartFor(date) !== date) throw bad('Profil und Woche muessen an einem Montag beginnen.', 'error.validation.monday');
  return date;
}

export function validVacationChanges(value: unknown): VacationChange[] {
  if (!Array.isArray(value) || !value.length || value.length > 366) throw bad('1 bis 366 Urlaubstage erwartet.', 'error.vacation.count');
  const dates = new Set<string>();
  const days = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw bad('Ungueltiger Urlaubstag.', 'error.vacation.day');
    const date = validDate(item.date);
    if (dates.has(date)) throw bad('Urlaubstage muessen eindeutig sein.', 'error.vacation.duplicate');
    dates.add(date);
    if (item.fraction !== null && item.fraction !== 0.5 && item.fraction !== 1) throw bad('Urlaub muss ein halber oder ganzer Tag sein.', 'error.vacation.fraction');
    return { date, fraction: item.fraction } as VacationChange;
  }).sort((a, z) => a.date.localeCompare(z.date));
  if (Temporal.PlainDate.from(days[0].date).until(Temporal.PlainDate.from(days[days.length - 1].date)).days >= 366)
    throw bad('Urlaubsbereich darf hoechstens 366 Kalendertage umfassen.', 'error.vacation.range');
  return days;
}

export function allowanceDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 3650 || !Number.isInteger(value * 2))
    throw bad('Urlaubsanspruch muss in halben Tagen zwischen 0 und 3650 liegen.', 'error.vacation.allowance');
  return value;
}

export function validZone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) throw bad('Ungueltige Zeitzone.', 'error.validation.timezone');
  try { new Intl.DateTimeFormat('de-DE', { timeZone: value }); Temporal.Now.plainDateISO(value); }
  catch { throw bad('Ungueltige Zeitzone.', 'error.validation.timezone'); }
  return value;
}
