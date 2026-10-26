import type { ErrorRequestHandler, Request, Response } from 'express';
import type { WeekReview } from '../shared/types.js';
import type { MessageParams } from '../shared/i18n.js';
import { serverProblem, type ServerMessageKey } from '../shared/server-messages.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public messageKey: ServerMessageKey, public code?: string, public weeks?: string[], public review?: WeekReview, public messageParams?: MessageParams) { super(message); }
}

export const bad = (message: string, messageKey: ServerMessageKey, messageParams?: MessageParams) => new HttpError(400, message, messageKey, undefined, undefined, undefined, messageParams);

export const route = (fn: (req: Request, res: Response) => void | Promise<void>) => (req: Request, res: Response, next: (error?: unknown) => void) => {
  Promise.resolve().then(() => fn(req, res)).catch(next);
};

export function body(req: Request): Record<string, unknown> {
  if (!req.is('application/json')) throw new HttpError(415, 'JSON-Content-Type erforderlich.', 'error.http.jsonType');
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw bad('JSON-Objekt erwartet.', 'error.http.jsonObject');
  return req.body as Record<string, unknown>;
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof HttpError) { res.status(error.status).json({ ...serverProblem(error.message, error.messageKey, error.messageParams), ...(error.code ? { code: error.code } : {}), ...(error.weeks ? { weeks: error.weeks } : {}), ...(error.review ? { review: error.review } : {}) }); return; }
  if (error instanceof SyntaxError && 'body' in error) { res.status(400).json(serverProblem('Ungueltiges JSON.', 'error.http.jsonInvalid')); return; }
  if (error instanceof Error && 'status' in error && error.status === 413) { res.status(413).json(serverProblem('Anfrage zu gross.', 'error.http.tooLarge')); return; }
  console.error('Serverfehler:', error instanceof Error ? error.message : 'Unbekannter Fehler');
  res.status(500).json(serverProblem('Interner Fehler.', 'error.http.internal'));
};
