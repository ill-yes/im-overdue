import type { Page, Route } from '@playwright/test';
import { test as base, expect } from './language-fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { AppState, ImportAnalysis, ImportPreview } from '../../shared/types.js';

const test = base.extend<Record<never, never>, { requestHarnessUrl: string }>({
  requestHarnessUrl: [async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'im-overdue-request-harness-'));
    let server: ViteDevServer | undefined;
    try {
      server = await createServer({
        configFile: false,
        root: process.cwd(),
        cacheDir: join(directory, 'vite-cache'),
        plugins: [react()],
        server: { host: '127.0.0.1', port: 0, hmr: false },
        optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
        logLevel: 'error',
      });
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') throw new Error('Missing request harness port');
      await use(`http://127.0.0.1:${address.port}/tests/e2e/request-harness.html`);
    } finally {
      await server?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, { scope: 'worker' }],
});

function state(revision: number, timezone = 'Europe/Berlin'): AppState {
  return {
    revision, undo: { token: `undo-${revision}`, label: `Change ${revision}` }, settings: { timezone },
    profiles: [], dataSources: [], activities: [], blocks: [], templates: [], recentEntries: [], weeks: [], notes: [], vacations: [], vacationAllowances: [],
  };
}

function preview(revision: number): ImportPreview {
  return {
    revision, counts: { total: 0, new: 0, updated: 0, unchanged: 0, duplicates: 0 }, rows: [], errors: [],
  };
}

async function settleLoad(page: Page, route: Route, next: AppState) {
  const response = route.request().response();
  await route.fulfill({ json: next });
  await (await response)?.finished();
  await page.evaluate(() => new Promise<void>(resolve => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  }));
}

async function pendingLoads(page: Page, url: string) {
  const loads: Route[] = [];
  await page.route('**/api/state', route => { loads.push(route); });
  await page.goto(url);
  await expect.poll(() => loads.length).toBe(2);
  return loads;
}

async function initialize(page: Page, url: string, revision: number) {
  const loads = await pendingLoads(page, url);
  await loads[0].fulfill({ json: state(revision) });
  await loads[1].fulfill({ json: state(revision) });
  await expect(page.getByTestId('revision')).toHaveText(String(revision));
  await expect(page.getByTestId('initializations')).toHaveText('1');
  return loads;
}

test('reversed initial loads preserve the newer state and initialize the timezone only once', async ({ page, requestHarnessUrl }) => {
  const loads = await pendingLoads(page, requestHarnessUrl);
  await expect(page.getByTestId('loading')).toHaveText('true');
  await loads[1].fulfill({ json: state(4, 'Pacific/Auckland') });
  await expect(page.getByTestId('revision')).toHaveText('4');
  await expect(page.getByTestId('loading')).toHaveText('false');
  await settleLoad(page, loads[0], state(2));
  await expect(page.getByTestId('revision')).toHaveText('4');
  await expect(page.getByTestId('undo')).toHaveText('undo-4');
  await expect(page.getByTestId('timezone')).toHaveText('Pacific/Auckland');
  await expect(page.getByTestId('initializations')).toHaveText('1');
  await expect(page.getByTestId('initial-timezone')).toHaveText('Pacific/Auckland');

  await page.evaluate(() => { void window.requestStateHarness.refresh(); });
  await expect.poll(() => loads.length).toBe(3);
  await loads[2].fulfill({ json: state(5, 'America/New_York') });
  await expect(page.getByTestId('revision')).toHaveText('5');
  await expect(page.getByTestId('initializations')).toHaveText('1');
  await expect(page.getByTestId('initial-timezone')).toHaveText('Pacific/Auckland');
});

test('an older pending initial load cannot overwrite a successful mutation or its undo token', async ({ page, requestHarnessUrl }) => {
  const mutations: unknown[] = [];
  await page.route('**/api/weeks/2026-09-28', async route => {
    mutations.push(route.request().postDataJSON());
    await route.fulfill({ json: state(2) });
  });
  const loads = await pendingLoads(page, requestHarnessUrl);
  await loads[1].fulfill({ json: state(1) });
  await expect(page.getByTestId('revision')).toHaveText('1');
  expect(await page.evaluate(() => window.requestStateHarness.mutate())).toBe(true);
  await expect(page.getByTestId('revision')).toHaveText('2');
  await settleLoad(page, loads[0], state(1, 'America/New_York'));
  await expect(page.getByTestId('revision')).toHaveText('2');
  await expect(page.getByTestId('undo')).toHaveText('undo-2');
  await expect(page.getByTestId('timezone')).toHaveText('Europe/Berlin');
  await expect(page.getByTestId('initializations')).toHaveText('1');
  expect(mutations).toEqual([{ status: 'closed', expectedRevision: 1, confirmCurrent: false, confirmWarnings: false }]);
});

test('confirmation retries keep the captured revision despite a concurrent newer refresh', async ({ page, requestHarnessUrl }) => {
  const mutations: unknown[] = [];
  let firstMutation: Route | undefined;
  await page.route('**/api/weeks/2026-09-28', async route => {
    mutations.push(route.request().postDataJSON());
    if (mutations.length === 1) firstMutation = route;
    else await route.fulfill({ json: state(9) });
  });
  const loads = await initialize(page, requestHarnessUrl, 7);
  await page.evaluate(() => { void window.requestStateHarness.mutate(); });
  await expect.poll(() => Boolean(firstMutation)).toBe(true);
  await expect(page.getByTestId('busy')).toHaveText('true');
  await page.evaluate(() => { void window.requestStateHarness.refresh(); });
  await expect.poll(() => loads.length).toBe(3);
  await loads[2].fulfill({ json: state(8) });
  await expect(page.getByTestId('revision')).toHaveText('8');
  expect(await page.evaluate(() => window.requestStateHarness.isRequestInFlight())).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await firstMutation!.fulfill({ status: 409, json: { code: 'CURRENT_WEEK_CONFIRM_REQUIRED', message: 'Confirm current week' } });
  await expect(page.getByTestId('outcome')).toHaveText('true');
  await expect(page.getByTestId('revision')).toHaveText('9');
  await expect(page.getByTestId('busy')).toHaveText('false');
  expect(mutations).toEqual([
    { status: 'closed', expectedRevision: 7, confirmCurrent: false, confirmWarnings: false },
    { status: 'closed', expectedRevision: 7, confirmCurrent: true, confirmWarnings: false },
  ]);
});

test('import commits use the preview revision and rethrow conflicts after refreshing inside the lock', async ({ page, requestHarnessUrl }) => {
  let commitBody: unknown;
  await page.route('**/api/import/preview', route => route.fulfill({ json: preview(8) }));
  await page.route('**/api/import/commit', async route => {
    commitBody = route.request().postDataJSON();
    await route.fulfill({ status: 409, json: { code: 'REVISION_CONFLICT', message: 'Preview revision is stale' } });
  });
  const loads = await initialize(page, requestHarnessUrl, 10);
  const importPreview = await page.evaluate(() => window.requestStateHarness.preview());
  const result = page.evaluate(async revision => {
    try {
      await window.requestStateHarness.commit(revision);
      return 'unexpected success';
    } catch (issue) {
      if (!issue || typeof issue !== 'object' || !('message' in issue) || typeof issue.message !== 'string') throw issue;
      return issue.message;
    }
  }, importPreview.revision);
  await expect.poll(() => loads.length).toBe(3);
  expect(await page.evaluate(() => window.requestStateHarness.isRequestInFlight())).toBe(true);
  await loads[2].fulfill({ json: state(11) });
  expect(await result).toBe('Preview revision is stale');
  expect(commitBody).toEqual({ format: 'json', text: '[]', expectedRevision: 8 });
  await expect(page.getByTestId('revision')).toHaveText('11');
  await expect(page.getByTestId('undo')).toHaveText('undo-11');
  await expect(page.getByTestId('busy')).toHaveText('false');
  await expect(page.getByTestId('message')).toBeEmpty();
});

test('preview holds the synchronous lock without clearing state, toast or session failure', async ({ page, requestHarnessUrl }) => {
  let mutationCount = 0;
  let previewRoute: Route | undefined;
  await page.route('**/api/weeks/2026-09-28', async route => {
    mutationCount += 1;
    await route.fulfill(mutationCount === 1
      ? { json: state(4) }
      : { status: 500, json: { message: 'Stored mutation failed' } });
  });
  await page.route('**/api/import/preview', route => { previewRoute = route; });
  await initialize(page, requestHarnessUrl, 3);
  expect(await page.evaluate(() => window.requestStateHarness.mutate())).toBe(true);
  expect(await page.evaluate(() => window.requestStateHarness.mutate())).toBe(false);
  await expect(page.getByTestId('failure')).toHaveText('Stored mutation failed');
  await expect(page.getByTestId('failure-session')).toHaveText('17');
  await expect(page.getByTestId('message')).toHaveText('Woche gespeichert.');
  const previewResult = page.evaluate(() => window.requestStateHarness.preview());
  await expect.poll(() => Boolean(previewRoute)).toBe(true);
  await expect(page.getByTestId('busy')).toHaveText('true');
  expect(await page.evaluate(() => window.requestStateHarness.isRequestInFlight())).toBe(true);
  expect(await page.evaluate(() => window.requestStateHarness.mutate())).toBe(false);
  expect(mutationCount).toBe(2);
  await expect(page.getByTestId('revision')).toHaveText('4');
  await expect(page.getByTestId('failure')).toHaveText('Stored mutation failed');
  await expect(page.getByTestId('message')).toHaveText('Woche gespeichert.');
  await previewRoute!.fulfill({ json: preview(99) });
  expect((await previewResult).revision).toBe(99);
  await expect(page.getByTestId('revision')).toHaveText('4');
  await expect(page.getByTestId('undo')).toHaveText('undo-4');
  await expect(page.getByTestId('failure')).toHaveText('Stored mutation failed');
  await expect(page.getByTestId('message')).toHaveText('Woche gespeichert.');
  await expect(page.getByTestId('busy')).toHaveText('false');
  expect(mutationCount).toBe(2);
});

for (const result of ['success', 'failure'] as const) {
  test(`analysis blocks concurrent requests without changing state or toast and releases its lock after ${result}`, async ({ page, requestHarnessUrl }) => {
    const mutations: unknown[] = [];
    const analyses: Route[] = [];
    let previews = 0;
    let commits = 0;
    await page.route('**/api/weeks/2026-09-28', async route => {
      mutations.push(route.request().postDataJSON());
      await route.fulfill({ json: state(3 + mutations.length) });
    });
    await page.route('**/api/import/analyze', route => { analyses.push(route); });
    await page.route('**/api/import/preview', async route => {
      previews++;
      await route.fulfill({ json: preview(99) });
    });
    await page.route('**/api/import/commit', async route => {
      commits++;
      await route.fulfill({ json: state(99) });
    });
    await initialize(page, requestHarnessUrl, 3);
    expect(await page.evaluate(() => window.requestStateHarness.mutate())).toBe(true);
    await expect(page.getByTestId('message')).toHaveText('Woche gespeichert.');
    const pending = page.evaluate(async () => {
      try { return { analysis: await window.requestStateHarness.analyze() }; }
      catch (issue) {
        if (!issue || typeof issue !== 'object' || !('message' in issue) || typeof issue.message !== 'string') throw issue;
        return { error: issue.message };
      }
    });
    await expect.poll(() => analyses.length).toBe(1);
    expect(analyses[0].request().postDataJSON()).toEqual({ format: 'json', text: '[]' });
    await expect(page.getByTestId('busy')).toHaveText('true');
    expect(await page.evaluate(() => window.requestStateHarness.isRequestInFlight())).toBe(true);
    const blocked = await page.evaluate(async () => {
      const harness = window.requestStateHarness;
      return Promise.all([harness.analyze(), harness.preview(), harness.commit(4)].map(async request => {
        try { await request; return 'unexpected success'; }
        catch (issue) {
          if (!issue || typeof issue !== 'object' || !('message' in issue) || typeof issue.message !== 'string') throw issue;
          return issue.message;
        }
      }));
    });
    expect(blocked).toEqual(Array(3).fill('Bitte warte, bis die laufende Anfrage abgeschlossen ist.'));
    expect(await page.evaluate(() => window.requestStateHarness.mutate())).toBe(false);
    expect(analyses).toHaveLength(1);
    expect(previews).toBe(0);
    expect(commits).toBe(0);
    expect(mutations).toHaveLength(1);
    await expect(page.getByTestId('revision')).toHaveText('4');
    await expect(page.getByTestId('undo')).toHaveText('undo-4');
    await expect(page.getByTestId('timezone')).toHaveText('Europe/Berlin');
    await expect(page.getByTestId('failure')).toBeEmpty();
    await expect(page.getByTestId('message')).toHaveText('Woche gespeichert.');
    const analysis: ImportAnalysis = { sources: [{ source: 'slack', count: 2 }], total: 2, duplicates: 0, errors: [] };
    await analyses[0].fulfill(result === 'success'
      ? { json: analysis }
      : { status: 503, json: { message: 'Analyze failed' } });
    expect(await pending).toEqual(result === 'success' ? { analysis } : { error: 'Analyze failed' });
    await expect(page.getByTestId('busy')).toHaveText('false');
    expect(await page.evaluate(() => window.requestStateHarness.isRequestInFlight())).toBe(false);
    await expect(page.getByTestId('revision')).toHaveText('4');
    await expect(page.getByTestId('undo')).toHaveText('undo-4');
    await expect(page.getByTestId('failure')).toBeEmpty();
    await expect(page.getByTestId('message')).toHaveText('Woche gespeichert.');
    expect(await page.evaluate(() => window.requestStateHarness.mutate())).toBe(true);
    await expect(page.getByTestId('revision')).toHaveText('5');
    expect(mutations).toEqual([
      { status: 'closed', expectedRevision: 3, confirmCurrent: false, confirmWarnings: false },
      { status: 'closed', expectedRevision: 4, confirmCurrent: false, confirmWarnings: false },
    ]);
  });
}
