import { serverProblem } from '../shared/server-messages.js';
import type { Request, RequestHandler } from 'express';

function hostAllowed(req: Request): boolean {
  const host = req.headers.host;
  if (!host || host.includes(',') || host.includes('@')) return false;
  let parsed: URL;
  try { parsed = new URL(`http://${host}`); }
  catch { return false; }
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) return false;
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
  const localPort = req.socket.localPort;
  return !localPort || (parsed.port || '80') === String(localPort);
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin || Array.isArray(origin)) return false;
  try {
    const u = new URL(origin);
    const host = new URL(`http://${req.headers.host}`);
    return u.protocol === 'http:' && u.hostname === host.hostname && u.port === host.port && u.origin === origin;
  } catch { return false; }
}

export function requestSecurity(origin?: string): RequestHandler {
  const expectedHost = origin ? new URL(origin).host : undefined;
  return (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  // The container probe can reach only this status route through loopback, even
  // when the browser-facing canonical URL terminates HTTPS at a reverse proxy.
  const localProbe = req.path === '/api/health' && ['GET', 'HEAD'].includes(req.method)
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && hostAllowed(req);
  if (!(expectedHost ? req.headers.host === expectedHost || localProbe : hostAllowed(req))) {
    res.status(403).json(serverProblem('Host ist nicht erlaubt.', 'error.security.host')); return;
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    res.status(403).json(serverProblem('Fremde Website ist nicht erlaubt.', 'error.security.site')); return;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !(origin ? req.headers.origin === origin : originAllowed(req))) {
    res.status(403).json(serverProblem('Origin stimmt nicht mit dem lokalen Server ueberein.', 'error.security.origin')); return;
  }
  next();
  };
}

export const loopbackSecurity = requestSecurity();
