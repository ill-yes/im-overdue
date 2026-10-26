import type { Page, Route } from '@playwright/test';
import { test as base, expect } from './language-fixture';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

// Only this isolated child receives the test password; no local app data is used.
const password = 'browser-test-passphrase';
type AuthApp = { url: string; restart: () => Promise<void> };

const test = base.extend<{ authApp: AuthApp }>({
  authApp: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'im-overdue-auth-browser-'));
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
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

async function login(page: Page) {
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
}

test('password boundary loads no private data, supports keyboard login, backup and logout', async ({ page, authApp }) => {
  let stateLoads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/state') stateLoads += 1; });
  await page.goto(authApp.url);
  await expect(page.getByRole('heading', { name: 'Dein Zeitkonto.' })).toBeVisible();
  await expect(page.getByLabel('Passwort', { exact: true })).toBeFocused();
  expect(stateLoads).toBe(0);
  for (const path of ['/api/state', '/api/backup', '/api/timesheet?from=2026-10-01&to=2026-11-01']) {
    const response = await page.request.get(`${authApp.url}${path}`);
    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe('AUTH_REQUIRED');
  }
  await page.getByLabel('Passwort', { exact: true }).fill('incorrect-passphrase');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Passwort', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Passwort', { exact: true })).toBeFocused();
  await page.keyboard.type('retry-draft');
  await expect(page.getByLabel('Passwort', { exact: true })).toHaveValue('retry-draft');
  expect(stateLoads).toBe(0);
  await login(page);
  await expect(page.locator('.calendar-workspace')).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.some(cookie => cookie.httpOnly && cookie.sameSite === 'Strict')).toBe(true);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'SQLite-Backup herunterladen' }).click();
  expect((await download).suggestedFilename()).toBe('im-overdue-backup.sqlite');
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  await expect(page.locator('.calendar-workspace')).toHaveCount(0);
  expect((await page.request.get(`${authApp.url}/api/state`)).status()).toBe(401);
});

test('mobile action menu includes logout and fits a narrow viewport', async ({ page, authApp }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(authApp.url);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await login(page);
  await page.getByRole('button', { name: 'App-Aktionen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toHaveCount(0);
});

test('a server restart invalidates the browser session', async ({ page, authApp }) => {
  await page.goto(authApp.url);
  await login(page);
  await authApp.restart();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  await expect(page.locator('.calendar-workspace')).toHaveCount(0);
});

test('a protected mutation 401 clears the app and is not replayed after login', async ({ page, authApp }) => {
  await page.goto(authApp.url);
  await login(page);
  await expect(page.locator('.calendar-workspace')).toBeVisible();
  let writes = 0;
  await page.route('**/api/settings', async route => {
    writes += 1;
    await route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED', message: 'Bitte anmelden.' } });
  });
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByLabel('Zeitzone suchen').fill('UTC');
  await page.getByRole('dialog', { name: 'Einstellungen', exact: true }).locator('section').filter({ has: page.getByRole('heading', { name: 'Zeitzone', exact: true }) }).getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveText(/Sitzung ist abgelaufen/);
  await login(page);
  await expect(page.locator('.calendar-workspace')).toBeVisible();
  expect(writes).toBe(1);
  expect((await (await page.request.get(`${authApp.url}/api/state`)).json()).settings.timezone).toBe('Europe/Berlin');
});

test('late private responses cannot restore the app after logout or contaminate a new session', async ({ page, authApp }) => {
  let held: Route | undefined;
  let originalState: Record<string, unknown> | undefined;
  await page.route('**/api/state', async route => {
    if (!held) {
      held = route;
      originalState = await (await route.fetch()).json() as Record<string, unknown>;
    } else await route.continue();
  });
  await page.goto(authApp.url);
  await login(page);
  await expect.poll(() => Boolean(originalState)).toBe(true);
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
  await login(page);
  await expect(page.locator('.calendar-workspace')).toBeVisible();
  // This reply belongs to the first App mount and must be ignored even after re-login.
  await held!.fulfill({ json: { ...originalState, revision: 999, settings: { timezone: 'Pacific/Auckland' } } }).catch(() => {});
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByLabel('Zeitzone suchen')).toHaveValue('Europe/Berlin');
});

for (const transport of ['BroadcastChannel with blocked storage', 'storage fallback'] as const) {
  test(`cross-tab logout removes an existing export and rejects late private responses via ${transport}`, async ({ page, context, authApp }) => {
    await context.addInitScript(mode => {
      // LAN HTTP does not expose this secure-context-only convenience API.
      Object.defineProperty(window.crypto, 'randomUUID', { value: undefined });
      if (mode === 'storage fallback') Object.defineProperty(window, 'BroadcastChannel', { value: undefined });
      else {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          // Keep the fixture's language seed independent of init-script ordering.
          if (key === 'im-overdue-language') return setItem.call(this, key, value);
          throw new DOMException('Storage blocked', 'SecurityError');
        };
        Storage.prototype.removeItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
      }
    }, transport);
    await page.goto(authApp.url);
    await login(page);
    const other = await context.newPage();
    await other.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const state = window as Window & { holdTimesheet?: boolean; releaseTimesheet?: () => void };
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
        if (state.holdTimesheet && url.pathname === '/api/timesheet') {
          state.holdTimesheet = false;
          // Simulate a transport whose already successful response ignores abort.
          return originalFetch(input, { ...init, signal: undefined }).then(response => new Promise<Response>(resolve => {
            state.releaseTimesheet = () => resolve(response);
          }));
        }
        return originalFetch(input, init);
      };
    });
    await other.goto(authApp.url);
    await expect(other.locator('.calendar-workspace')).toBeVisible();
    await other.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
    await other.getByRole('menuitem', { name: 'Stundenzettel', exact: true }).click();
    const sheet = other.getByRole('dialog', { name: 'Stundenzettel exportieren', exact: true });
    await sheet.getByRole('checkbox', { name: 'Nur abgeschlossene Wochen', exact: true }).uncheck();
    await expect(sheet.locator('.timesheet-document')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'CSV', exact: true })).toBeEnabled();
    await other.evaluate(() => { (window as Window & { holdTimesheet?: boolean }).holdTimesheet = true; });
    await sheet.getByRole('button', { name: 'Nächster Zeitraum', exact: true }).click();
    await expect.poll(() => other.evaluate(() => typeof (window as Window & { releaseTimesheet?: () => void }).releaseTimesheet)).toBe('function');
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
    await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
    await expect(other.getByLabel('Passwort', { exact: true })).toBeVisible();
    await expect(other.getByRole('navigation')).toHaveCount(0);
    await expect(other.getByRole('dialog')).toHaveCount(0);
    await expect(other.locator('.timesheet-document, .timesheet-print')).toHaveCount(0);
    await other.evaluate(async () => {
      (window as Window & { releaseTimesheet?: () => void }).releaseTimesheet!();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await expect(other.getByLabel('Passwort', { exact: true })).toBeVisible();
    await expect(other.locator('.calendar-workspace, .timesheet-document, .timesheet-print')).toHaveCount(0);
    await login(other);
    await expect(other.locator('.calendar-workspace')).toBeVisible();
    await expect(other.locator('.timesheet-document, .timesheet-print')).toHaveCount(0);
  });
}

test('reactivating a tab checks the session without remounting valid drafts and detects a missed expiry', async ({ page, context, authApp }) => {
  await page.goto(authApp.url);
  await login(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByLabel('Zeitzone suchen').fill('UTC');
  let sessionChecks = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/auth/session') sessionChecks++; });
  const checked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/session');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect((await checked).status()).toBe(200);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByLabel('Zeitzone suchen')).toHaveValue('UTC');
  await page.route('**/api/auth/session', route => route.abort());
  const failed = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname === '/api/auth/session');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await failed;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByLabel('Zeitzone suchen')).toHaveValue('UTC');
  await page.unroute('**/api/auth/session');
  await context.clearCookies();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.calendar-workspace')).toHaveCount(0);
  expect(sessionChecks).toBeGreaterThanOrEqual(3);
});

test('failed server logout still hides other tabs and retains the local retry flow', async ({ page, context, authApp }) => {
  await page.goto(authApp.url);
  await login(page);
  const other = await context.newPage();
  await other.goto(authApp.url);
  await expect(other.locator('.calendar-workspace')).toBeVisible();
  await page.route('**/api/auth/logout', route => route.abort());
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Erneut abmelden', exact: true })).toBeVisible();
  await expect(other.getByLabel('Passwort', { exact: true })).toBeVisible();
  await other.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(other.locator('.calendar-workspace')).toHaveCount(0);
  expect((await page.request.get(`${authApp.url}/api/state`)).status()).toBe(200);
  await page.unroute('**/api/auth/logout');
  await page.getByRole('button', { name: 'Erneut abmelden', exact: true }).click();
  await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
  expect((await page.request.get(`${authApp.url}/api/state`)).status()).toBe(401);
});

test('peer logout signals preserve an in-flight local logout and its failed retry state', async ({ page, context, authApp }) => {
  await page.goto(authApp.url);
  await login(page);
  const other = await context.newPage();
  await other.goto(authApp.url);
  await expect(other.locator('.calendar-workspace')).toBeVisible();
  await page.evaluate(() => {
    const state = window as Window & { peerLogoutSignals?: number };
    state.peerLogoutSignals = 0;
    window.addEventListener('storage', event => {
      if (event.key === 'im-overdue-logout' && event.newValue) state.peerLogoutSignals! += 1;
    });
  });
  const publishPeerLogout = async (id: string, count: number) => {
    await other.evaluate(id => localStorage.setItem('im-overdue-logout', JSON.stringify({ type: 'logout', id })), id);
    await expect.poll(() => page.evaluate(() => (window as Window & { peerLogoutSignals?: number }).peerLogoutSignals)).toBe(count);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
  let held: Route | undefined;
  let logoutAttempts = 0;
  let abortedLogout = false;
  page.on('requestfailed', request => { if (new URL(request.url()).pathname === '/api/auth/logout') abortedLogout = true; });
  await page.route('**/api/auth/logout', async route => {
    logoutAttempts += 1;
    if (logoutAttempts === 1) held = route;
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await expect(other.getByLabel('Passwort', { exact: true })).toBeVisible();
  await publishPeerLogout('peer-during-request', 1);
  expect(abortedLogout).toBe(false);
  await expect(page.getByRole('status')).toHaveText('Abmelden …');
  await expect(page.getByLabel('Passwort', { exact: true })).toHaveCount(0);
  await expect(page.locator('.calendar-workspace')).toHaveCount(0);
  await held!.fulfill({ status: 500, json: { message: 'Simulated logout failure' } });
  const retry = page.getByRole('button', { name: 'Erneut abmelden', exact: true });
  await expect(retry).toBeVisible();
  await publishPeerLogout('peer-after-failure', 2);
  await expect(retry).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(/Die Abmeldung konnte nicht bestätigt werden/);
  await expect(page.getByLabel('Passwort', { exact: true })).toHaveCount(0);
  expect((await page.request.get(`${authApp.url}/api/state`)).status()).toBe(200);
  await retry.click();
  await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
  expect(logoutAttempts).toBe(2);
  expect(abortedLogout).toBe(false);
  expect((await page.request.get(`${authApp.url}/api/state`)).status()).toBe(401);
});

test('backup expiry uses the login boundary and a rate limit has clear feedback', async ({ page, authApp }) => {
  await page.goto(authApp.url);
  await page.route('**/api/auth/login', route => route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { message: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' } }));
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/Zu viele Anmeldeversuche/);
  await page.unroute('**/api/auth/login');
  await login(page);
  await expect(page.locator('.calendar-workspace')).toBeVisible();
  await page.route('**/api/backup', route => route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED', message: 'Bitte anmelden.' } }));
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('link', { name: 'SQLite-Backup herunterladen' }).click();
  await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test.describe('English-first bilingual authentication', () => {
  test.use({ appLanguage: null, locale: 'de-DE' });

  test('login language preserves the password draft and retranslates a visible error without loading data', async ({ page, authApp }) => {
    let stateLoads = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/state') stateLoads++; });
    await page.goto(authApp.url);
    await expect(page.getByRole('heading', { name: 'Your time account.' })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('incorrect-passphrase');
    await page.getByLabel('Language / Sprache', { exact: true }).selectOption('de');
    await expect(page.getByLabel('Passwort', { exact: true })).toHaveValue('incorrect-passphrase');
    await page.getByLabel('Language / Sprache', { exact: true }).selectOption('en');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Incorrect password.');
    await page.getByLabel('Language / Sprache', { exact: true }).selectOption('de');
    await expect(page.getByRole('alert')).toHaveText('Das Passwort ist nicht korrekt.');
    expect(stateLoads).toBe(0);
    await page.getByLabel('Language / Sprache', { exact: true }).selectOption('en');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.locator('.calendar-workspace')).toHaveCount(0);
    expect((await page.request.get(`${authApp.url}/api/state`)).status()).toBe(401);
  });

  test('an expired English session can switch language and sign in without replaying a mutation', async ({ page, authApp }) => {
    await page.goto(authApp.url);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.calendar-workspace')).toBeVisible();
    let writes = 0;
    await page.route('**/api/settings', async route => {
      writes++;
      await route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED', message: 'Bitte anmelden.', messageKey: 'error.auth.required' } });
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Find a time zone', { exact: true }).fill('UTC');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Your session has expired. Please sign in again.');
    await expect(page.locator('.calendar-workspace')).toHaveCount(0);
    await page.getByLabel('Language / Sprache', { exact: true }).selectOption('de');
    await expect(page.getByRole('alert')).toHaveText('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
    await login(page);
    await expect(page.locator('.calendar-workspace')).toBeVisible();
    expect(writes).toBe(1);
    expect((await (await page.request.get(`${authApp.url}/api/state`)).json()).settings.timezone).toBe('Europe/Berlin');
  });

  test('a late authenticated success cannot show private data after logout and a language switch', async ({ page, authApp }) => {
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      let firstState = true;
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
        if (firstState && url.pathname === '/api/state') {
          firstState = false;
          return originalFetch(input, { ...init, signal: undefined }).then(response => new Promise<Response>(resolve => {
            (window as Window & { releaseAuthenticatedState?: () => void }).releaseAuthenticatedState = () => resolve(response);
          }));
        }
        return originalFetch(input, init);
      };
    });
    await page.goto(authApp.url);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => typeof (window as Window & { releaseAuthenticatedState?: () => void }).releaseAuthenticatedState)).toBe('function');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await page.getByLabel('Language / Sprache', { exact: true }).selectOption('de');
    await page.evaluate(async () => {
      (window as Window & { releaseAuthenticatedState?: () => void }).releaseAuthenticatedState!();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
    await expect(page.locator('.calendar-workspace')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test('capture login in both languages on desktop and mobile', async ({ page, authApp }) => {
    await page.goto(authApp.url);
    for (const locale of ['en', 'de']) {
      await page.getByLabel('Language / Sprache', { exact: true }).selectOption(locale);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await expect(page.getByRole('heading', { name: locale === 'en' ? 'Your time account.' : 'Dein Zeitkonto.' })).toBeVisible();
        await page.screenshot({ path: `output/i18n/login-${locale}-${width}.png` });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  });

  test('English mobile login and logout fit the viewport and retain the saved language', async ({ page, authApp }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(authApp.url);
    await expect(page.getByLabel('Language / Sprache', { exact: true })).toHaveValue('en');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('english-mobile-login.png') });
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Password', { exact: true }).press('Enter');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await page.getByRole('button', { name: 'App actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  });
});
