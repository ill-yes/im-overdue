import { describe, expect, it } from 'vitest';
import { IMPORT_MAX_BYTES, previewImport } from '../server/import.js';
import type { Activity } from '../shared/types.js';

const activity = { source: 'slack', id: 'w:c:m', start: '2026-10-01T09:15:00+02:00', end: null, title: 'Nachricht gesendet', url: null };
describe('activity imports', () => {
  it('accepts JSON and CSV equivalently, deduplicates identical rows, and detects changes', () => {
    const json = previewImport({ format: 'json', text: JSON.stringify({ schemaVersion: 1, activities: [activity, activity] }) }, [], 0);
    const csv = previewImport({ format: 'csv', text: 'source,id,start,end,title,url\nslack,w:c:m,2026-10-01T09:15:00+02:00,,Nachricht gesendet,\n' }, [], 0);
    expect(json.errors).toEqual([]);
    expect(json.counts).toEqual({ total: 2, new: 1, updated: 0, unchanged: 0, duplicates: 1 });
    expect(json.rows[0].activity).toEqual(csv.rows[0].activity);
    const old = json.rows[0].activity;
    expect(previewImport({ format: 'json', text: JSON.stringify({ schemaVersion: 1, activities: [activity] }) }, [old], 4).counts.unchanged).toBe(1);
    const updated = previewImport({ format: 'json', text: JSON.stringify({ schemaVersion: 1, activities: [{ ...activity, title: 'Neu' }] }) }, [old], 4);
    expect(updated.counts.updated).toBe(1);
    expect(updated.rows[0].previous).toEqual(old);
    expect(json.rows[0]).not.toHaveProperty('previous');
    expect(previewImport({ format: 'json', text: JSON.stringify({ schemaVersion: 1, activities: [activity] }) }, [old], 4).rows[0]).not.toHaveProperty('previous');
  });
  it('rejects contradictory duplicates, offsetless times, and script URLs', () => {
    const cases: unknown[][] = [
      [activity, { ...activity, title: 'Andere Aktivitaet' }],
      [{ ...activity, start: '2026-10-01T09:15:00' }],
      [{ ...activity, url: 'javascript:alert(1)' }],
    ];
    for (const activities of cases) expect(previewImport({ format: 'json', text: JSON.stringify({ schemaVersion: 1, activities }) }, [] as Activity[], 0).errors.length).toBeGreaterThan(0);
  });
  it('rejects duplicate or incomplete CSV headers', () => {
    for (const text of ['source,id,start,end,title,title\n', 'source,id,start,end,title,url,extra\n', 'source,id,start,end,title\n']) {
      expect(previewImport({ format: 'csv', text }, [], 0).errors.length).toBeGreaterThan(0);
    }
  });

  it('accepts exactly 20,000 CSV records, excluding the header and empty lines and including quoted newlines', () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => `slack,${i},2026-10-01T09:15:00Z,,"Message\n${i}",`).join('\n\n');
    const result = previewImport({ format: 'csv', text: `\uFEFF\nsource,id,start,end,title,url\n\n${rows}\n\n` }, [], 0);
    expect(result.errors).toEqual([]);
    expect(result.counts).toEqual({ total: 20_000, new: 20_000, updated: 0, unchanged: 0, duplicates: 0 });
    expect(result.rows.at(-1)?.activity.title).toBe('Message\n19999');
  });

  it('rejects the 20,001st CSV record, including duplicates', () => {
    const row = 'slack,id,2026-10-01T09:15:00Z,,Message,\n';
    const result = previewImport({ format: 'csv', text: `source,id,start,end,title,url\n${row.repeat(20_001)}` }, [], 0);
    expect(result.errors).toMatchObject([{ messageKey: 'error.import.rows' }]);
    expect(result.rows).toEqual([]);
  });

  it('stops at the row limit before parsing a large remainder and malformed later record', () => {
    const row = 'slack,id,2026-10-01T09:15:00Z,,Message,\n';
    const malformed = 'slack,broken,2026-10-01T09:15:00Z,,"unterminated';
    const text = `source,id,start,end,title,url\n${row.repeat(20_001)}${row.repeat(50_000)}${malformed}`;
    expect(Buffer.byteLength(text)).toBeLessThan(IMPORT_MAX_BYTES);
    const result = previewImport({ format: 'csv', text }, [], 0);
    expect(result.errors).toMatchObject([{ messageKey: 'error.import.rows' }]);
    expect(result.rows).toEqual([]);
    // The same malformed record is still rejected when it occurs below the limit.
    const belowLimit = previewImport({ format: 'csv', text: `source,id,start,end,title,url\n${malformed}` }, [], 0);
    expect(belowLimit.errors).toMatchObject([{ messageKey: 'error.import.invalid' }]);
  });

  it('retains the 5 MiB byte limit before parsing CSV', () => {
    const result = previewImport({ format: 'csv', text: 'x'.repeat(IMPORT_MAX_BYTES + 1) }, [], 0);
    expect(result.errors).toMatchObject([{ messageKey: 'error.import.size' }]);
  });
});
