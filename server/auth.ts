import { serverProblem } from '../shared/server-messages.js';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import express, { type Request, type RequestHandler } from 'express';
import { body, HttpError, route } from './http.js';
import { validPassword } from './config.js';
import { clientAddress, throttleKey, trustedProxyList } from './client-address.js';

const derive = promisify(scrypt);
const COOKIE = 'im_overdue_session';
const SESSION_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const ATTEMPTS_PER_CLIENT = 10;
const TRACKED_CLIENTS = 1024;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export interface Authentication {
  routes: express.Router;
  requireSession: RequestHandler;
}

function cookieToken(req: Request): string | undefined {
  const cookies = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE}=`));
  if (cookies.length !== 1) return;
  const token = cookies[0].slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}

export interface AuthenticationOptions {
  now?: () => number;
  /** Reverse proxies whose X-Forwarded-For entries identify the client for login throttling. */
  trustedProxies?: readonly string[];
}

export async function createAuthentication(password: string | undefined, origin?: string, { now = Date.now, trustedProxies }: AuthenticationOptions = {}): Promise<Authentication> {
  if (password !== undefined && (!validPassword(password) || !origin)) throw new Error('Ungueltige Authentifizierungskonfiguration.');
  const required = password !== undefined;
  const salt = required ? randomBytes(16) : undefined;
  const reference = required ? await derive(password!, salt!, 64) as Buffer : undefined;
  const sessions = new Map<string, number>();
  // Attempts are tracked per client so that strangers cannot lock out the owner.
  const attempts = new Map<string, number[]>();
  const proxies = trustedProxyList(trustedProxies);
  const recordAttempt = (client: string, at: number) => {
    const recent = attempts.get(client)!;
    recent.push(at);
    attempts.delete(client);
    attempts.set(client, recent);
    if (attempts.size <= TRACKED_CLIENTS) return;
    for (const [key, times] of attempts) if (times[times.length - 1] <= at - ATTEMPT_WINDOW_MS) attempts.delete(key);
    if (attempts.size > TRACKED_CLIENTS) attempts.delete(attempts.keys().next().value!);
  };
  let verifying = false;
  const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: origin?.startsWith('https://') ?? false, path: '/' };
  const prune = () => { for (const [token, expiry] of sessions) if (expiry <= now()) sessions.delete(token); };
  const authenticated = (req: Request): boolean => {
    if (!required) return true;
    prune();
    const token = cookieToken(req);
    return token !== undefined && sessions.has(digest(token));
  };
  const routes = express.Router({ caseSensitive: true, strict: true });
  // Exact routes only. Unknown auth paths fall through to the protected API.
  routes.get('/session', (req, res) => { res.json({ required, authenticated: authenticated(req) }); });
  routes.post('/login', express.json({ limit: 2048, strict: true }), route(async (req, res) => {
    if (!required) { res.json({ required, authenticated: true }); return; }
    const at = now();
    const client = throttleKey(clientAddress(req.socket.remoteAddress, req.headers['x-forwarded-for'], proxies));
    const recent = (attempts.get(client) ?? []).filter(attempt => attempt > at - ATTEMPT_WINDOW_MS);
    attempts.set(client, recent);
    if (recent.length >= ATTEMPTS_PER_CLIENT) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((recent[0] + ATTEMPT_WINDOW_MS - at) / 1000)));
      throw new HttpError(429, 'error.auth.limited', 'LOGIN_LIMITED');
    }
    recordAttempt(client, at);
    if (verifying) { res.setHeader('Retry-After', '1'); throw new HttpError(429, 'error.auth.busy', 'LOGIN_LIMITED'); }
    const input = body(req);
    if (!validPassword(input.password)) throw new HttpError(401, 'error.auth.invalid', 'LOGIN_INVALID');
    verifying = true;
    let matches: boolean;
    try { matches = timingSafeEqual(await derive(input.password, salt!, 64) as Buffer, reference!); }
    finally { verifying = false; }
    if (!matches) throw new HttpError(401, 'error.auth.invalid', 'LOGIN_INVALID');
    attempts.delete(client);
    prune();
    if (sessions.size >= 64) sessions.delete(sessions.keys().next().value!);
    const token = randomBytes(32).toString('hex');
    sessions.set(digest(token), now() + SESSION_MS);
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_MS });
    res.json({ required, authenticated: true });
  }));
  routes.post('/logout', (req, res) => {
    const token = cookieToken(req);
    if (token) sessions.delete(digest(token));
    res.clearCookie(COOKIE, cookieOptions);
    res.status(204).end();
  });
  const requireSession: RequestHandler = (req, res, next) => {
    if (!authenticated(req)) { res.status(401).json({ code: 'AUTH_REQUIRED', ...serverProblem('error.auth.required') }); return; }
    next();
  };
  return { routes, requireSession };
}
