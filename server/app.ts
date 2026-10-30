import express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { registerAccountingRoutes } from './accounting.js';
import type { Authentication } from './auth.js';
import { registerBlockRoutes } from './blocks.js';
import { registerDataSourceRoutes, registerImportRoutes } from './data-sources.js';
import { readState } from './db.js';
import { registerExportRoutes } from './exports.js';
import { errorHandler } from './http.js';
import { requestSecurity } from './loopback-security.js';
import { registerNoteRoutes } from './notes.js';
import { registerSettingsRoutes } from './settings.js';
import { registerTemplateRoutes } from './templates.js';
import { registerVacationRoutes } from './vacations.js';
import { registerWeekRoutes } from './weeks.js';
import { IMPORT_MAX_BYTES } from '../shared/import-contract.js';
import { serverProblem } from '../shared/server-messages.js';

export function createApp(db: DatabaseSync, options: { origin?: string; auth?: Authentication } = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('case sensitive routing', true);
  app.set('strict routing', true);
  app.set('trust proxy', false);
  app.use(requestSecurity(options.origin));
  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  if (options.auth) {
    app.use('/api/auth', options.auth.routes);
    app.use('/api', options.auth.requireSession);
  } else {
    app.get('/api/auth/session', (_req, res) => { res.json({ required: false, authenticated: true }); });
  }
  // The JSON envelope can encode one input byte as six ASCII bytes (for example
  // a control character becomes \\u0000). Apply the larger cap only to imports.
  app.use('/api/import', express.json({ limit: IMPORT_MAX_BYTES * 6 + 64 * 1024, strict: true }));
  app.use('/api', express.json({ limit: '6mb', strict: true }));
  app.get('/api/state', (_req, res) => { res.json(readState(db)); });
  registerDataSourceRoutes(app, db);
  registerAccountingRoutes(app, db);
  registerImportRoutes(app, db);
  registerExportRoutes(app, db);
  registerVacationRoutes(app, db);
  registerTemplateRoutes(app, db);
  registerNoteRoutes(app, db);
  registerBlockRoutes(app, db);
  registerWeekRoutes(app, db);
  registerSettingsRoutes(app, db);
  app.use('/api', (_req, res) => { res.status(404).json(serverProblem('API-Endpunkt nicht gefunden.', 'error.http.notFound')); });
  app.use(errorHandler);
  return app;
}
