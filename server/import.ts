import { MessageError, importProblem, serverProblem } from '../shared/server-messages.js';
import { parse } from 'csv-parse/sync';
import { Temporal } from '../shared/time.js';
import { SOURCES, type Activity, type DataSource, type ImportAnalysis, type ImportInput, type ImportPreview, type Source } from '../shared/types.js';
import { activityDataSourceId, activityKey, legacyDataSourceId } from '../shared/data-sources.js';
import { IMPORT_MAX_BYTES } from '../shared/import-contract.js';

export { IMPORT_MAX_BYTES } from '../shared/import-contract.js';
const maxRows = 20_000;
const fields = ['source', 'id', 'start', 'end', 'title', 'url'];
const hasOffset = /(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/i;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !hasOffset.test(value)) throw new MessageError('error.import.timestampOffset', { field });
  try { return Temporal.Instant.from(value).toString(); }
  catch { throw new MessageError('error.import.timestamp', { field }); }
}
function validate(row: unknown): Activity {
  if (!record(row)) throw new MessageError('error.import.row');
  if (typeof row.source !== 'string' || !SOURCES.includes(row.source as Activity['source'])) throw new MessageError('error.import.source');
  if (typeof row.id !== 'string' || !row.id.trim() || row.id.length > 500) throw new MessageError('error.import.id');
  if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > 1000) throw new MessageError('error.import.title');
  const start = timestamp(row.start, 'start');
  const end = row.end === null || row.end === undefined || row.end === '' ? null : timestamp(row.end, 'end');
  if (end && Temporal.Instant.compare(start, end) >= 0) throw new MessageError('error.import.end');
  let url: string | null = null;
  if (row.url !== null && row.url !== undefined && row.url !== '') {
    if (typeof row.url !== 'string' || row.url.length > 2048) throw new MessageError('error.import.urlLength');
    try {
      const parsed = new URL(row.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      url = row.url;
    } catch { throw new MessageError('error.import.url'); }
  }
  return { source: row.source as Activity['source'], id: row.id, start, end, title: row.title, url };
}
function parseInput(input: ImportInput): unknown[] {
  if (typeof input.text !== 'string' || Buffer.byteLength(input.text, 'utf8') > IMPORT_MAX_BYTES) throw new MessageError('error.import.size');
  let rows: unknown[];
  if (input.format === 'json') {
    const parsed: unknown = JSON.parse(input.text);
    if (!record(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.activities)) throw new MessageError('error.import.jsonShape');
    rows = parsed.activities;
  } else if (input.format === 'csv') {
    let headerSeen = false;
    const parsed = parse(input.text, { bom: true, columns: (head: string[]) => {
      headerSeen = true;
      if (head.length !== fields.length || fields.some((field, i) => head[i] !== field))
        throw new MessageError('error.import.csvHeader', { fields: fields.join(',') });
      return head;
    }, skip_empty_lines: true, relax_quotes: false, relax_column_count: false, trim: false,
    on_record: (row, context) => {
      // Count parsed records, not physical lines, and stop before collecting the rest of the file.
      if (context.records > maxRows) throw new MessageError('error.import.rows');
      return row;
    } }) as Record<string, unknown>[];
    if (!headerSeen) throw new MessageError('error.import.csvMissingHeader');
    rows = parsed;
  } else throw new MessageError('error.import.format');
  if (rows.length > maxRows) throw new MessageError('error.import.rows');
  return rows;
}
type ParsedImport = { analysis: ImportAnalysis; activities: Activity[]; duplicates: Partial<Record<Source, number>> };

function parsedImport(input: ImportInput): ParsedImport {
  const analysis: ImportAnalysis = { sources: [], total: 0, duplicates: 0, errors: [] };
  const activities: Activity[] = [];
  const duplicates: Partial<Record<Source, number>> = {};
  let raw: unknown[];
  try { raw = parseInput(input); }
  catch (error) { analysis.errors.push(importProblem(error, 'error.import.invalid')); return { analysis, activities, duplicates }; }
  analysis.total = raw.length;
  const seen = new Map<string, Activity>();
  raw.forEach((item, index) => {
    try {
      const activity = validate(item);
      const key = JSON.stringify([activity.source, activity.id]);
      const prior = seen.get(key);
      if (prior) {
        if (sameActivity(prior, activity)) {
          analysis.duplicates++;
          duplicates[activity.source] = (duplicates[activity.source] ?? 0) + 1;
          return;
        }
        throw new MessageError('error.import.duplicate');
      }
      seen.set(key, activity);
      activities.push(activity);
    } catch (error) { analysis.errors.push({ row: index + 1, ...importProblem(error, 'error.import.activity') }); }
  });
  analysis.sources = SOURCES.map(source => ({ source, count: activities.filter(a => a.source === source).length })).filter(item => item.count > 0);
  return { analysis, activities, duplicates };
}

export function analyzeImport(input: ImportInput): ImportAnalysis { return parsedImport(input).analysis; }

export function importDuplicates(input: ImportInput): Partial<Record<Source, number>> { return parsedImport(input).duplicates; }

function sameActivity(a: Activity, b: Activity): boolean {
  return a.source === b.source && a.id === b.id && a.start === b.start && a.end === b.end && a.title === b.title && a.url === b.url;
}

/** The optional catalog keeps the original pure three-argument model API usable. */
export function previewImport(input: ImportInput, existing: Activity[], revision: number, catalog?: Pick<DataSource, 'id' | 'type'>[]): ImportPreview {
  const preview: ImportPreview = { revision, counts: { total: 0, new: 0, updated: 0, unchanged: 0, duplicates: 0 }, rows: [], errors: [] };
  const parsed = parsedImport(input);
  preview.counts.total = parsed.analysis.total;
  preview.counts.duplicates = parsed.analysis.duplicates;
  preview.errors = [...parsed.analysis.errors];
  const sources = catalog ?? [...new Map(existing.map(a => [activityDataSourceId(a), { id: activityDataSourceId(a), type: a.source }])).values()];
  if (input.assignments !== undefined) {
    for (const [type, id] of Object.entries(input.assignments)) {
      if (!sources.some(source => source.id === id && source.type === type)) preview.errors.push(serverProblem('error.import.targetInvalid', { source: type }));
    }
  }
  const assignments = new Map<Source, string>();
  for (const { source } of parsed.analysis.sources) {
    if (input.assignments !== undefined) {
      const id = input.assignments[source];
      if (!id || !sources.some(item => item.id === id && item.type === source)) {
        preview.errors.push(serverProblem('error.import.targetMissing', { source }));
        continue;
      }
      assignments.set(source, id);
    } else {
      const matches = sources.filter(item => item.type === source);
      if (matches.length > 1) {
        preview.errors.push(serverProblem('error.import.targetAmbiguous', { source }));
        continue;
      }
      assignments.set(source, matches[0]?.id ?? legacyDataSourceId(source));
    }
  }
  const current = new Map(existing.map(a => [activityKey(a), a]));
  for (const raw of parsed.activities) {
      const dataSourceId = assignments.get(raw.source);
      if (!dataSourceId) continue;
      const activity = { ...raw, dataSourceId };
      const old = current.get(activityKey(activity));
      const status = !old ? 'new' : sameActivity(old, activity) ? 'unchanged' : 'updated';
      preview.counts[status]++;
      preview.rows.push({ activity, status, ...(status === 'updated' && old ? { previous: old } : {}) });
  }
  return preview;
}
