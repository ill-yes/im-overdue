import { serverProblem } from '../shared/server-messages.js';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import express, { type Request, type RequestHandler } from 'express';
import { body, HttpError, route } from './http.js';
import { validPassword } from './config.js';

const derive = promisify(scrypt);
const COOKIE = 'im_overdue_session';
const SESSION_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
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

export async function createAuthentication(password: string | undefined, origin?: string, now: () => number = Date.now): Promise<Authentication> {
  if (password !== undefined && (!validPassword(password) || !origin)) throw new Error('Ungueltige Authentifizierungskonfiguration.');
  const required = password !== undefined;
  const salt = required ? randomBytes(16) : undefined;
  const reference = required ? await derive(password!, salt!, 64) as Buffer : undefined;
  const sessions = new Map<string, number>();
  let attempts: number[] = [];
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
    attempts = attempts.filter(attempt => attempt > at - ATTEMPT_WINDOW_MS);
    if (attempts.length >= 10) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((attempts[0] + ATTEMPT_WINDOW_MS - at) / 1000)));
      throw new HttpError(429, 'error.auth.limited', 'LOGIN_LIMITED');
    }
    attempts.push(at);
    if (verifying) { res.setHeader('Retry-After', '1'); throw new HttpError(429, 'error.auth.busy', 'LOGIN_LIMITED'); }
    const input = body(req);
    if (!validPassword(input.password)) throw new HttpError(401, 'error.auth.invalid', 'LOGIN_INVALID');
    verifying = true;
    let matches: boolean;
    try { matches = timingSafeEqual(await derive(input.password, salt!, 64) as Buffer, reference!); }
    finally { verifying = false; }
    if (!matches) throw new HttpError(401, 'error.auth.invalid', 'LOGIN_INVALID');
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
