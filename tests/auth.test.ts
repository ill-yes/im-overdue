import { afterEach, describe, expect, it } from 'vitest';
import { request as httpRequest, type Server } from 'node:http';
import { createApp } from '../server/app.js';
import { createAuthentication } from '../server/auth.js';
import { openDatabase } from '../server/db.js';

const password = 'correct horse battery staple';
const origin = 'https://overdue.example:444';
const running: { server: Server; db: ReturnType<typeof openDatabase> }[] = [];

async function start(options: { origin?: string; now?: () => number; noAuth?: boolean } = {}) {
  const db = openDatabase(':memory:');
  const canonical = options.origin ?? origin;
  const auth = await createAuthentication(options.noAuth ? undefined : password, options.noAuth ? undefined : canonical, options.now);
  const server = createApp(db, { origin: canonical, auth }).listen(0, '127.0.0.1');
  running.push({ server, db });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  const port = address.port;
  const request = (path: string, method = 'GET', data?: unknown, extra: Record<string, string> = {}) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string; json: () => unknown }>((resolve, reject) => {
    const payload = data === undefined ? undefined : JSON.stringify(data);
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method, headers: { Host: new URL(canonical).host, ...(method !== 'GET' && method !== 'HEAD' ? { Origin: canonical } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}), ...extra } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(payload);
  });
  const login = async (value = password) => {
    const res = await request('/api/auth/login', 'POST', { password: value });
    const cookie = (res.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0];
    return { ...res, cookie };
  };
  return { request, login, port, server };
}

afterEach(async () => {
  for (const { server, db } of running.splice(0)) {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

describe('password API', () => {
  it('protects every product API including HEAD, backups, exports and unknown routes before large parsing', async () => {
    const app = await start();
    expect((await app.request('/api/auth/session')).json()).toEqual({ required: true, authenticated: false });
    for (const path of ['/api/state', '/api/backup', '/api/timesheet', '/api/unknown', '/api/auth/other', '/api/auth/session/', '/api/auth/SESSION']) {
      const response = await app.request(path);
      expect(response.status, path).toBe(401);
      expect(response.json()).toEqual({ code: 'AUTH_REQUIRED', message: 'Bitte anmelden.', messageKey: 'error.auth.required' });
    }
    expect((await app.request('/api/backup', 'HEAD')).status).toBe(401);
    expect((await app.request('/api/import/preview', 'POST', { text: 'a'.repeat(7 * 1024 * 1024) })).status).toBe(401);
    expect((await app.request('/api/auth/login', 'POST', { password, padding: 'a'.repeat(2048) })).status).toBe(413);
  });

  it('uses opaque private cookies, authenticates requests, logs out, and distinguishes invalid credentials', async () => {
    const app = await start();
    const invalid = await app.login('wrong password value');
    expect(invalid.status).toBe(401);
    expect(invalid.json()).toEqual({ code: 'LOGIN_INVALID', message: 'Passwort ist nicht korrekt.', messageKey: 'error.auth.invalid' });
    const login = await app.login();
    expect(login.status).toBe(200);
    expect(login.json()).toEqual({ required: true, authenticated: true });
    expect(login.cookie).toMatch(/^im_overdue_session=[a-f0-9]{64}$/);
    const setCookie = (login.headers['set-cookie'] as string[])[0];
    for (const attribute of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/', 'Max-Age=86400']) expect(setCookie).toContain(attribute);
    expect(setCookie).not.toContain('Domain=');
    const headers = { Cookie: login.cookie! };
    expect((await app.request('/api/auth/session', 'GET', undefined, headers)).json()).toEqual({ required: true, authenticated: true });
    expect((await app.request('/api/state', 'GET', undefined, headers)).status).toBe(200);
    expect((await app.request('/api/backup', 'HEAD', undefined, headers)).status).toBe(200);
    const logout = await app.request('/api/auth/logout', 'POST', undefined, headers);
    expect(logout.status).toBe(204);
    expect((logout.headers['set-cookie'] as string[])[0]).toContain('Expires=Thu, 01 Jan 1970');
    expect((await app.request('/api/state', 'GET', undefined, headers)).status).toBe(401);
  });

  it('expires at a fixed 24 hours and rejects sessions in a restarted app', async () => {
    let now = 1_000;
    const app = await start({ now: () => now });
    const { cookie } = await app.login();
    const headers = { Cookie: cookie! };
    now += 23 * 60 * 60 * 1000;
    expect((await app.request('/api/state', 'GET', undefined, headers)).status).toBe(200);
    const restarted = await start();
    expect((await restarted.request('/api/state', 'GET', undefined, headers)).status).toBe(401);
    now += 60 * 60 * 1000;
    expect((await app.request('/api/state', 'GET', undefined, headers)).status).toBe(401);
  });

  it('requires exact host/origin, ignores forwarded forgery and exposes only health to the internal HTTPS probe', async () => {
    const app = await start();
    expect((await app.request('/api/health')).json()).toEqual({ ok: true });
    expect((await app.request('/api/health', 'GET', undefined, { Host: `127.0.0.1:${app.port}` })).status).toBe(200);
    expect((await app.request('/api/state', 'GET', undefined, { Host: `127.0.0.1:${app.port}` })).status).toBe(403);
    expect((await app.request('/api/health', 'GET', undefined, { Host: 'evil.example', 'X-Forwarded-Host': new URL(origin).host, 'X-Forwarded-Proto': 'https' })).status).toBe(403);
    for (const Origin of ['', 'https://evil.example', `${origin}/`, 'http://overdue.example:444'])
      expect((await app.request('/api/auth/login', 'POST', { password }, { Origin })).status).toBe(403);
    expect((await app.request('/api/auth/logout', 'POST', undefined, { Origin: '' })).status).toBe(403);
    expect((await app.request('/api/auth/session', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    const health = await app.request('/api/health');
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['cache-control']).toBe('no-store');
  });

  it('limits attempts process-wide without affecting sessions and accepts retries after five minutes', async () => {
    let now = 100_000;
    const app = await start({ now: () => now });
    const { cookie } = await app.login();
    for (let i = 0; i < 9; i++) expect((await app.login('wrong password value')).status).toBe(401);
    const limited = await app.login();
    expect(limited.status).toBe(429);
    expect(limited.json()).toEqual({ code: 'LOGIN_LIMITED', message: 'Zu viele Anmeldeversuche. Bitte spaeter erneut versuchen.', messageKey: 'error.auth.limited' });
    expect(limited.headers['retry-after']).toBe('300');
    expect((await app.request('/api/state', 'GET', undefined, { Cookie: cookie! })).status).toBe(200);
    now += 5 * 60 * 1000;
    expect((await app.login()).status).toBe(200);
  });

  it('allows only one password derivation at a time', async () => {
    const app = await start();
    const results = await Promise.all([app.login(), app.login()]);
    expect(results.map(result => result.status).sort()).toEqual([200, 429]);
    expect(results.find(result => result.status === 429)?.headers['retry-after']).toBe('1');
    expect(results.find(result => result.status === 429)?.json()).toEqual({ code: 'LOGIN_LIMITED', message: 'Anmeldung wird bereits geprueft.', messageKey: 'error.auth.busy' });
  });

  it('keeps at most 64 sessions and expires the oldest session when a new one is created', async () => {
    let now = 100_000;
    const app = await start({ now: () => now });
    const oldest = await app.login();
    let newest = oldest;
    for (let i = 1; i <= 64; i++) {
      if (i % 10 === 0) now += 5 * 60 * 1000;
      newest = await app.login();
      expect(newest.status).toBe(200);
    }
    expect((await app.request('/api/state', 'GET', undefined, { Cookie: oldest.cookie! })).status).toBe(401);
    expect((await app.request('/api/state', 'GET', undefined, { Cookie: newest.cookie! })).status).toBe(200);
  });

  it('uses non-Secure cookies for LAN HTTP and supports explicitly disabled auth', async () => {
    const app = await start({ origin: 'http://overdue.lan:4317' });
    const login = await app.login();
    expect((login.headers['set-cookie'] as string[])[0]).not.toContain('Secure');
    const local = await start({ noAuth: true });
    expect((await local.request('/api/auth/session')).json()).toEqual({ required: false, authenticated: true });
    expect((await local.request('/api/state')).status).toBe(200);
  });
});
