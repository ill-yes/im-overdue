import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { analyzeImport, previewImport } from '../server/import.js';
import { serverMessages } from '../shared/server-messages.js';
import { translate } from '../shared/i18n.js';
import { parse } from 'csv-parse/sync';

let server: Server | undefined;
let db: ReturnType<typeof openDatabase> | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  db?.close();
  server = undefined;
  db = undefined;
});

async function start() {
  db = openDatabase(':memory:');
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  const origin = `http://127.0.0.1:${address.port}`;
  return (path: string, body?: string, headers?: Record<string, string>) => fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body,
  });
}

function problem(key: keyof typeof serverMessages, params?: Record<string, string | number>) {
  return { messageKey: key, ...(params ? { messageParams: params } : {}) };
}

describe('stable API message descriptors', () => {
  it('provides both languages with identical interpolation parameters', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const [key, text] of Object.entries(serverMessages)) {
      expect(text.en.trim(), key).not.toBe('');
      expect(text.de.trim(), key).not.toBe('');
      expect(placeholders(text.en), key).toEqual(placeholders(text.de));
    }
    expect(translate(serverMessages, 'error.validation.note', { max: 2000 }, 'en')).toContain('2000');
    expect(translate(serverMessages, 'error.validation.note', { max: 2000 }, 'de')).toContain('2000');
  });

  it('adds metadata to validation, parser, unknown route and security responses without changing legacy fields', async () => {
    const request = await start();
    const cases = [
      ['/api/import/preview', '{}', 400, 'format und text erforderlich.', problem('error.import.input')],
      ['/api/import/preview', '{', 400, 'Ungueltiges JSON.', problem('error.http.jsonInvalid')],
      ['/api/import/preview', '[]', 400, 'JSON-Objekt erwartet.', problem('error.http.jsonObject')],
      ['/api/blocks', JSON.stringify({ start: 'missing' }), 400, 'start: UTC-Offset oder Z erforderlich.', problem('error.validation.offset', { field: 'start' })],
      ['/api/unknown', undefined, 404, 'API-Endpunkt nicht gefunden.', problem('error.http.notFound')],
    ] as const;
    for (const [path, body, status, message, metadata] of cases) {
      const response = await request(path, body);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ message, ...metadata });
    }
    const wrongType = await request('/api/import/preview', '{}', { 'Content-Type': 'text/plain' });
    expect(wrongType.status).toBe(415);
    expect(await wrongType.json()).toEqual({ message: 'JSON-Content-Type erforderlich.', ...problem('error.http.jsonType') });
    const security = await request('/api/state', undefined, { 'Sec-Fetch-Site': 'cross-site' });
    expect(security.status).toBe(403);
    expect(await security.json()).toEqual({ message: 'Fremde Website ist nicht erlaubt.', ...problem('error.security.site') });
  });

  it('retains conflict code and fields alongside metadata', async () => {
    const request = await start();
    const response = await request('/api/templates', JSON.stringify({ expectedRevision: 1, title: 'Example', note: '', durationMinutes: 60 }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: 'Ansicht ist veraltet. Bitte neu laden.', code: 'REVISION_CONFLICT', ...problem('error.revision.conflict') });
  });

  it('describes intentional import problems at their source and keeps row numbers', () => {
    const base = { source: 'slack', id: 'example', start: '2026-10-01T09:00:00Z', end: null, title: 'Example', url: null };
    const json = (activities: unknown[]) => previewImport({ format: 'json', text: JSON.stringify({ schemaVersion: 1, activities }) }, [], 0);
    expect(json([{ ...base, start: '2026-10-01T09:00:00' }]).errors).toEqual([
      { row: 1, message: 'start: Zeitstempel mit UTC-Offset oder Z erforderlich.', ...problem('error.import.timestampOffset', { field: 'start' }) },
    ]);
    expect(json([base, { ...base, title: 'Changed' }]).errors[0]).toMatchObject(problem('error.import.duplicate'));
    expect(json([{ ...base, url: 'javascript:alert(1)' }]).errors[0]).toMatchObject(problem('error.import.url'));
    expect(previewImport({ format: 'csv', text: 'source,id,start,title,url\n' }, [], 0).errors[0]).toMatchObject(problem('error.import.csvHeader', { fields: 'source,id,start,end,title,url' }));
  });

  it('preserves legacy JSON and CSV parser diagnostics while supplying a generic translated display', async () => {
    const request = await start();
    const example = 'synthetic-parser-example';
    for (const input of [
      { format: 'json' as const, text: `{"${example}"` },
      { format: 'csv' as const, text: `source,id,start,end,title,url\nslack,1,2026-10-01T09:00:00Z,,"${example},\n` },
    ]) {
      let legacyMessage = '';
      try {
        if (input.format === 'json') JSON.parse(input.text);
        else parse(input.text, { bom: true, columns: true, skip_empty_lines: true, relax_quotes: false, relax_column_count: false, trim: false });
      } catch (error) { legacyMessage = (error as Error).message; }
      expect(legacyMessage).not.toBe('');
      const errors = previewImport(input, [], 0).errors;
      expect(errors).toEqual([{ message: legacyMessage, ...problem('error.import.invalid') }]);
      expect(translate(serverMessages, 'error.import.invalid', {}, 'en')).toBe('Invalid import format.');
      expect(translate(serverMessages, 'error.import.invalid', {}, 'de')).toBe('Ungültiges Importformat.');
      const preview = await request('/api/import/preview', JSON.stringify(input));
      expect(preview.status).toBe(200);
      expect((await preview.json()).errors).toEqual(errors);
      const analysis = await request('/api/import/analyze', JSON.stringify(input));
      expect(analysis.status).toBe(200);
      expect((await analysis.json()).errors).toEqual(errors);
      const commit = await request('/api/import/commit', JSON.stringify({ ...input, expectedRevision: 0 }));
      expect(commit.status).toBe(400);
      expect(await commit.json()).toEqual({ message: `Import hat 1 Fehler: ${legacyMessage}`, ...problem('error.import.commit', { count: 1 }) });
    }
  });

  it('keeps analysis row and duplicate descriptors identical to preview and describes source assignments', () => {
    const row = { source: 'slack', id: 'example', start: '2026-10-01T09:00:00Z', title: 'User title' };
    for (const activities of [[{ ...row, url: 'javascript:alert(1)' }], [row, { ...row, title: 'Changed user title' }]]) {
      const input = { format: 'json' as const, text: JSON.stringify({ schemaVersion: 1, activities }) };
      const errors = analyzeImport(input).errors;
      expect(errors).toEqual(previewImport(input, [], 0).errors);
      expect(errors[0]).toMatchObject({ row: activities.length, messageKey: activities.length === 1 ? 'error.import.url' : 'error.import.duplicate' });
      expect(errors[0].message).toBe(activities.length === 1 ? 'Nur HTTP/HTTPS-URLs sind erlaubt.' : 'Widerspruechlicher doppelter Schluessel in der Datei.');
    }
    const input = { format: 'json' as const, text: JSON.stringify({ schemaVersion: 1, activities: [row] }) };
    const catalog = [{ id: 'first', type: 'slack' as const }, { id: 'second', type: 'slack' as const }];
    expect(previewImport(input, [], 0, catalog).errors).toEqual([{ message: 'Mehrere Datenquellen fuer slack: Bitte ein Importziel waehlen.', ...problem('error.import.targetAmbiguous', { source: 'slack' }) }]);
    expect(previewImport({ ...input, assignments: {} }, [], 0, catalog).errors).toEqual([{ message: 'Importziel fuer slack fehlt, existiert nicht oder hat einen anderen Typ.', ...problem('error.import.targetMissing', { source: 'slack' }) }]);
    expect(previewImport({ ...input, assignments: { slack: 'missing' } }, [], 0, catalog).errors).toEqual([
      { message: 'Ungueltiges Importziel fuer slack.', ...problem('error.import.targetInvalid', { source: 'slack' }) },
      { message: 'Importziel fuer slack fehlt, existiert nicht oder hat einen anderen Typ.', ...problem('error.import.targetMissing', { source: 'slack' }) },
    ]);
  });

  it('adds descriptors to source, package and import-envelope errors while retaining legacy German messages', async () => {
    const request = await start();
    const cases = [
      ['/api/data-sources/missing/activities', undefined, 404, 'Datenquelle nicht gefunden.', 'error.dataSource.notFound'],
      ['/api/import-packages/missing', undefined, 404, 'Importpaket nicht gefunden.', 'error.importPackage.notFound'],
      ['/api/data-sources/missing/activities?unknown=1', undefined, 400, 'Unbekannter Abfrageparameter.', 'error.dataSource.query'],
      ['/api/data-sources/missing/packages?page=-1', undefined, 400, 'page muss eine nichtnegative ganze Zahl sein.', 'error.dataSource.page'],
      ['/api/import-packages/missing?page=9007199254740991', undefined, 400, 'page ist zu gross.', 'error.dataSource.pageSize'],
      ['/api/import-packages/missing?q=' + 'a'.repeat(501), undefined, 400, 'q muss Text mit maximal 500 Zeichen sein.', 'error.dataSource.search'],
      ['/api/data-sources', JSON.stringify({ type: 'invalid', name: 'Untouched user name', expectedRevision: 0 }), 400, 'Unbekannter Quellentyp.', 'error.dataSource.type'],
      ['/api/import/analyze', JSON.stringify({ format: 'json', text: '{}', assignments: [] }), 400, 'assignments muss ein Objekt sein.', 'error.import.assignmentsObject'],
      ['/api/import/preview', JSON.stringify({ format: 'json', text: '{}', assignments: { invalid: 'source' } }), 400, 'Ungueltige Importzuordnung.', 'error.import.assignments'],
    ] as const;
    for (const [path, body, status, message, messageKey] of cases) {
      const response = await request(path, body);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ message, ...problem(messageKey) });
      expect(translate(serverMessages, messageKey, {}, 'en')).not.toBe('');
      expect(translate(serverMessages, messageKey, {}, 'de')).not.toBe('');
    }
    const state = await (await request('/api/state')).json();
    expect(state.revision).toBe(0);
    expect(state.dataSources).toEqual([]);
    expect(state.activities).toEqual([]);
  });
});
