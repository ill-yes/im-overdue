import { createApp } from './app.js';
import { createAuthentication } from './auth.js';
import { readConfig } from './config.js';
import { openDatabase } from './db.js';

export async function initializeApplication(env: NodeJS.ProcessEnv, open = openDatabase) {
  // All config validation and password derivation finish before opening SQLite.
  const config = readConfig(env);
  const auth = await createAuthentication(config.password, config.origin, { trustedProxies: config.trustedProxies });
  const db = open(config.databasePath);
  return { config, db, app: createApp(db, { origin: config.origin, auth }) };
}
