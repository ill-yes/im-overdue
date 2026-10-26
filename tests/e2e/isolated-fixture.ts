import type { Page, Request } from '@playwright/test';
import { test as base, expect } from './language-fixture';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../server/app.js';
import { openDatabase } from '../../server/db.js';
import type { AppState, Source } from '../../shared/types.js';
import { activityKey } from '../../shared/data-sources.js';

interface LocalApp {
  url: string;
  directory: string;
  restart: (databasePath?: string) => Promise<void>;
}

// Each regression gets its own real API/database and the built browser bundle.
export const test = base.extend<{ localApp: LocalApp }>({
  localApp: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'im-overdue-regression-'));
    let server: Server | undefined;
    let db: DatabaseSync | undefined;
    const stop = async () => {
      if (server) {
        const closed = new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
        server.closeAllConnections();
        await closed;
        server = undefined;
      }
      db?.close();
      db = undefined;
    };
    const localApp: LocalApp = {
      url: '', directory,
      restart: async (databasePath = join(directory, 'app.sqlite')) => {
        await stop();
        db = openDatabase(databasePath);
        const app = createApp(db);
        app.use(express.static(resolve('dist')));
        server = app.listen(0, '127.0.0.1');
        await new Promise<void>((resolve, reject) => { server!.once('listening', resolve); server!.once('error', reject); });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing isolated server port');
        localApp.url = `http://127.0.0.1:${address.port}`;
      },
    };
    try {
      await localApp.restart();
      await use(localApp);
    } finally {
      await stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
  baseURL: async ({ localApp }, use) => { await use(localApp.url); },
});
export { expect };

export async function openAppAction(page: Page, name: 'Importieren' | 'Einstellungen') {
  await expect(page.locator('.site-header')).toBeVisible();
  const direct = page.getByRole('button', { name, exact: true });
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByRole('button', { name: 'App-Aktionen', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
}

export async function openBlockNote(page: Page) {
  const disclosure = page.getByRole('dialog').locator('details').filter({ has: page.locator('summary', { hasText: /^Notiz/ }) });
  if (await disclosure.count() && !(await disclosure.evaluate(element => (element as HTMLDetailsElement).open))) await disclosure.locator('summary').click();
}
export async function openBlockTemplate(page: Page) {
  const disclosure = page.getByRole('dialog').locator('details').filter({ has: page.locator('summary', { hasText: /^Vorlagenoptionen/ }) });
  if (await disclosure.count() && !(await disclosure.evaluate(element => (element as HTMLDetailsElement).open))) await disclosure.locator('summary').click();
}
export async function openSourceFilters(page: Page) {
  const trigger = page.getByRole('button', { name: 'Belege filtern', exact: true });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}

export async function getState(page: Page): Promise<AppState> {
  return page.evaluate(async () => (await fetch('/api/state')).json());
}
export async function assignImportSources(page: Page, language: 'en' | 'de' = 'de') {
  const assignments = page.getByRole('region', { name: language === 'en' ? 'Assign import sources' : 'Importquellen zuordnen', exact: true });
  await expect(assignments).toBeVisible();
  const rows = assignments.locator('.imp-assignment');
  for (const row of await rows.all()) {
    const select = row.getByRole('combobox', { name: language === 'en' ? 'Target source' : 'Zielquelle', exact: true });
    if (await select.inputValue()) continue;
    const existing = select.locator('option').nth(1);
    if (await existing.count()) await select.selectOption(await existing.getAttribute('value') ?? '');
    else {
      const name = await row.locator('.imp-assignment-label strong').innerText();
      await row.getByRole('button', { name: language === 'en' ? 'Create new source' : 'Neue Quelle anlegen', exact: true }).click();
      await row.getByLabel(language === 'en' ? 'New source name' : 'Name der neuen Quelle', { exact: true }).fill(name);
      await row.getByRole('button', { name: language === 'en' ? 'Create source' : 'Quelle anlegen', exact: true }).click();
      await expect(select).not.toHaveValue('');
    }
  }
}
export async function previewImport(page: Page, language: 'en' | 'de' = 'de') {
  await page.getByRole('button', { name: language === 'en' ? 'Check file' : 'Datei prüfen', exact: true }).click();
  await assignImportSources(page, language);
  await page.getByRole('button', { name: language === 'en' ? 'Check preview' : 'Vorschau prüfen', exact: true }).click();
  await expect(page.getByRole('region', { name: language === 'en' ? 'Import preview' : 'Importvorschau', exact: true })).toBeVisible();
}
export async function unchangedImportResult(page: Page) {
  const before = await getState(page);
  const commits: Request[] = [];
  const capture = (request: Request) => {
    if (new URL(request.url()).pathname === '/api/import/commit') commits.push(request);
  };
  page.on('request', capture);
  try {
    const action = page.getByRole('button', { name: 'Bereits vorhanden', exact: true });
    await expect(action).toBeEnabled();
    await action.click();
    await expect(page.getByRole('region', { name: 'Importergebnis', exact: true }).getByRole('heading', { name: 'Bereits vorhanden', exact: true })).toBeVisible();
    expect(await getState(page)).toEqual(before);
    expect(commits).toEqual([]);
  } finally { page.off('request', capture); }
}
export async function createFilterSource(page: Page, type: Source, name: string) {
  const state = await getState(page);
  const response = await page.request.post('/api/data-sources', {
    headers: { Origin: new URL(page.url()).origin }, data: { type, name, expectedRevision: state.revision },
  });
  expect(response.status()).toBe(200);
  await page.reload();
}
export async function reviewActivity(page: Page, source: Source, id: string) {
  const state = await getState(page);
  const activity = state.activities.find(entry => entry.source === source && entry.id === id);
  expect(activity, `Imported activity ${source}/${id}`).toBeDefined();
  expect(activity!.dataSourceId).toBeTruthy();
  return page.locator(`[data-review-activity=${JSON.stringify(activityKey(activity!))}]`);
}
export async function chooseWeek(page: Page, date: string) {
  await page.getByLabel('Woche über Datum wählen').fill(date);
  await expect(page.locator(`[data-calendar-day="${date}"]`)).toBeVisible();
}
export async function newBlock(page: Page, date: string, from: string, to: string, note = '') {
  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  await page.getByLabel('Beginn · Datum').fill(date);
  await page.getByLabel('Ende · Datum').fill(date);
  await page.getByLabel('Beginn · Uhrzeit').fill(from);
  await page.getByLabel('Ende · Uhrzeit').fill(to);
  if (note) { await openBlockNote(page); await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill(note); }
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
