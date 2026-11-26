import { test as base, expect } from './language-fixture';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

// Only this isolated child receives the test password; no local app data is used.
export const password = 'browser-test-passphrase';
type AuthApp = { url: string; restart: () => Promise<void> };

export const test = base.extend<{ authApp: AuthApp }>({
  authApp: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'im-overdue-auth-browser-'));
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '0.0.0.0', resolve); });
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Missing authentication test port');
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    const url = `http://127.0.0.1:${port}`;
    let child: ChildProcess | undefined;
    const stop = async () => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      const current = child;
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => current.kill('SIGKILL'), 5000);
        current.once('exit', () => { clearTimeout(timer); resolve(); });
        current.kill('SIGTERM');
      });
    };
    const authApp: AuthApp = {
      url,
      restart: async () => {
        await stop();
        child = spawn(process.execPath, ['dist-server/server/index.js'], {
          stdio: 'ignore',
          env: {
            PATH: process.env.PATH, NODE_ENV: 'production', TZ: 'Europe/Berlin', HOST: '0.0.0.0', PORT: String(port),
            IM_OVERDUE_DB: join(directory, 'auth.sqlite'), IM_OVERDUE_ORIGIN: url, IM_OVERDUE_PASSWORD: password,
          },
        });
        let startupError: Error | undefined;
        child.once('error', error => { startupError = error; });
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          if (startupError || child.exitCode !== null || child.signalCode !== null) throw new Error('Isolated authentication server failed to start.');
          try { if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for listening. */ }
          await pause(50);
        }
        throw new Error('Isolated authentication server did not become healthy.');
      },
    };
    try { await authApp.restart(); await use(authApp); }
    finally { await stop(); await rm(directory, { recursive: true, force: true }); }
  },
  baseURL: async ({ authApp }, use) => { await use(authApp.url); },
});

export { expect };
