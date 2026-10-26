import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { createApp } from '../../server/app.js';
import { createAuthentication } from '../../server/auth.js';
import { openDatabase } from '../../server/db.js';

// This fixture intentionally has no uncaughtException handler: the vulnerable
// dependency must fail the parent test by crashing this isolated child process.
const [directory, mode, scenario] = process.argv.slice(2);
assert(directory && (mode === 'valid' || mode === 'trailing'));
const origin = 'http://compressed-body.example';
const password = 'isolated compressed body test password';
const loginPath = '/api/auth/login';
const mutationPath = '/api/notes/day/2026-09-28';
const importPath = '/api/import/preview';
type Encoding = 'gzip' | 'deflate' | 'br';
type Response = { status: number; headers: IncomingHttpHeaders; text: string };
const compressors = { gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync };
const db = openDatabase(join(directory, 'test.sqlite'));
const auth = await createAuthentication(password, origin);
const server = createApp(db, { origin, auth }).listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const address = server.address();
assert(address && typeof address !== 'string');
const port = address.port;
let cookie: string | undefined;

function request(path: string, method = 'GET', payload?: Buffer, encoding?: Encoding): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port, path, method, agent: false,
      headers: {
        Host: new URL(origin).host,
        ...(method !== 'GET' ? { Origin: origin } : {}),
        ...(cookie && path !== loginPath ? { Cookie: cookie } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
        ...(encoding ? { 'Content-Encoding': encoding } : {}),
      },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.setTimeout(2_000, () => req.destroy(new Error(`Request timed out: ${path}`)));
    req.end(payload);
  });
}

async function payloadFor(path: string): Promise<object> {
  if (path === loginPath) return { password };
  if (path === importPath) return {
    format: 'json',
    text: JSON.stringify({ schemaVersion: 1, activities: [{
      source: 'other', id: 'compressed-test', start: '2026-09-28T08:30:00Z',
      end: null, title: 'Compressed import', url: null,
    }] }),
  };
  assert.equal(path, mutationPath);
  const state = await request('/api/state');
  assert.equal(state.status, 200);
  return { expectedRevision: JSON.parse(state.text).revision, text: 'Compressed note' };
}

async function validRequest(path: string, encoding: Encoding) {
  const payload = compressors[encoding](JSON.stringify(await payloadFor(path)));
  const result = await request(path, path === mutationPath ? 'PUT' : 'POST', payload, encoding);
  assert.equal(result.status, 200, `${path}: ${result.text}`);
  const parsed = JSON.parse(result.text);
  if (path === loginPath) {
    assert.deepEqual(parsed, { required: true, authenticated: true });
    cookie = result.headers['set-cookie']?.[0]?.split(';')[0];
    assert(cookie);
  } else if (path === mutationPath) {
    assert(parsed.notes.some((note: { scope: string; date: string; text: string }) =>
      note.scope === 'day' && note.date === '2026-09-28' && note.text === 'Compressed note'));
  } else {
    assert.equal(parsed.counts.new, 1);
    assert.equal(parsed.rows[0].activity.title, 'Compressed import');
  }
}

try {
  if (mode === 'valid') {
    assert(scenario in compressors);
    const encoding = scenario as Encoding;
    for (const path of [loginPath, mutationPath, importPath]) await validRequest(path, encoding);
  } else {
    assert([loginPath, mutationPath, importPath].includes(scenario));
    if (scenario !== loginPath) await validRequest(loginPath, 'gzip');
    // Mirror the upstream reproducer: the zero byte ends the gzip readable side
    // before a later transport chunk reaches the decoder with no error listener.
    // The 100 KiB trailer forces multiple socket reads on supported Node >= 24.
    // https://github.com/expressjs/body-parser/commit/1260c38
    const malicious = Buffer.concat([
      gzipSync(JSON.stringify(await payloadFor(scenario))),
      Buffer.from([0]),
      Buffer.alloc(100 * 1024, 0x58),
    ]);
    await request(scenario, scenario === mutationPath ? 'PUT' : 'POST', malicious, 'gzip');
    // A response can precede the fatal decoder error. Keep the actual server
    // alive for pending decoder events before probing health and normal parsing.
    await delay(200);
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.text), { ok: true });
    await validRequest(scenario, 'gzip');
  }
  console.log('compressed-body scenario passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
}
