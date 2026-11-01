import { expect, it } from 'vitest';
import { request as httpRequest, type Server } from 'node:http';
import { createApp } from '../server/app.js';
import { createAuthentication } from '../server/auth.js';
import { openDatabase, readState } from '../server/db.js';
import type { AppState, ImportPackage, DataPage } from '../shared/types.js';

it('protects source, package and import APIs with the existing session and origin guards', async () => {
  const db = openDatabase(':memory:');
  const origin = 'https://sources-test.example';
  const password = 'isolated-source-test-password';
  let server: Server | undefined;
  try {
    const auth = await createAuthentication(password, origin);
    server = createApp(db, { origin, auth }).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing isolated port');
    const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read loosely shaped API bodies.
      new Promise<{ status: number; cookie?: string; json: () => any }>((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = httpRequest({ hostname: '127.0.0.1', port: address.port, path, method, headers: {
          Host: new URL(origin).host, ...(method === 'GET' || method === 'HEAD' ? {} : { Origin: origin }),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
          ...headers,
        } }, response => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', chunk => { text += chunk; });
          response.on('end', () => resolve({ status: response.statusCode ?? 0,
            cookie: response.headers['set-cookie']?.[0]?.split(';')[0], json: () => JSON.parse(text) }));
        });
        req.on('error', reject);
        req.end(payload);
      });
    const protectedRoutes = [
      ['/api/data-sources', 'POST'], ['/api/data-sources/missing', 'PUT'], ['/api/data-sources/missing', 'DELETE'],
      ['/api/data-sources/missing/activities', 'GET'], ['/api/data-sources/missing/packages', 'GET'],
      ['/api/import-packages/missing', 'GET'], ['/api/import/analyze', 'POST'],
      ['/api/import/preview', 'POST'], ['/api/import/commit', 'POST'],
    ];
    const before = readState(db);
    for (const [path, method] of protectedRoutes) {
      const response = await request(path, method, method === 'GET' ? undefined : {});
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(response.json().code).toBe('AUTH_REQUIRED');
    }
    expect((await request('/api/data-sources/missing/activities', 'HEAD')).status).toBe(401);
    expect(readState(db)).toEqual(before);
    const login = await request('/api/auth/login', 'POST', { password });
    expect(login.status).toBe(200);
    const headers = { Cookie: login.cookie! };
    const created = await request('/api/data-sources', 'POST', { type: 'slack', name: 'Geschützte Quelle', expectedRevision: 0 }, headers);
    expect(created.status).toBe(200);
    const state = created.json() as AppState;
    const id = state.dataSources[0].id;
    const input = { format: 'json', assignments: { slack: id }, text: JSON.stringify({ schemaVersion: 1,
      activities: [{ source: 'slack', id: 'one', start: '2026-10-01T08:00:00Z', end: null, title: 'Geschützt', url: null }] }) };
    expect((await request('/api/import/analyze', 'POST', input, headers)).status).toBe(200);
    expect((await request('/api/import/preview', 'POST', input, headers)).status).toBe(200);
    const committed = await request('/api/import/commit', 'POST', { ...input, expectedRevision: state.revision }, headers);
    expect(committed.status).toBe(200);
    const after = committed.json() as AppState;
    expect((await request(`/api/data-sources/${id}/activities`, 'GET', undefined, headers)).json().items).toHaveLength(1);
    const packetResponse = await request(`/api/data-sources/${id}/packages`, 'GET', undefined, headers);
    expect(packetResponse.status).toBe(200);
    const packet = (packetResponse.json() as DataPage<ImportPackage>).items[0];
    expect((await request(`/api/import-packages/${packet.id}`, 'GET', undefined, headers)).json().items).toHaveLength(1);
    const renamed = await request(`/api/data-sources/${id}`, 'PUT', { name: 'Neuer Name', expectedRevision: after.revision }, headers);
    expect(renamed.status).toBe(200);
    for (const [path, method] of protectedRoutes) {
      expect((await request(path, method, method === 'GET' ? undefined : {}, { ...headers, Host: 'evil.example' })).status).toBe(403);
    }
    expect((await request(`/api/data-sources/${id}`, 'DELETE', { expectedRevision: renamed.json().revision }, { ...headers, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await request('/api/auth/logout', 'POST', undefined, headers)).status).toBe(204);
    expect((await request(`/api/import-packages/${packet.id}`, 'GET', undefined, headers)).status).toBe(401);
    expect((await request(`/api/data-sources/${id}`, 'DELETE', { expectedRevision: renamed.json().revision }, headers)).status).toBe(401);
    expect(readState(db).dataSources).toHaveLength(1);
    const secondLogin = await request('/api/auth/login', 'POST', { password });
    const deleted = await request(`/api/data-sources/${id}`, 'DELETE', { expectedRevision: renamed.json().revision }, { Cookie: secondLogin.cookie! });
    expect(deleted.status).toBe(200);
    expect(deleted.json().dataSources).toEqual([]);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    db.close();
  }
});
