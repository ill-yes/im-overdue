import type { Page, Route } from '@playwright/test';
import type { AppState, Source } from '../../shared/types.js';
import { test, expect, getState } from './isolated-fixture';
import { dataSourceMessages as sources } from '../../src/locales/data-sources';
import { importMessages as imports } from '../../src/locales/import';

type Language = 'en' | 'de';
const panel = (page: Page) => page.locator('.sources-panel');
const switchTo = async (page: Page, language: Language) => {
  await page.getByLabel('Language / Sprache', { exact: true }).selectOption(language);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
};
async function mutate(page: Page, path: string, data: object): Promise<AppState> {
  const before = await getState(page);
  const response = await page.request.post(path, { headers: { Origin: new URL(page.url()).origin }, data: { ...data, expectedRevision: before.revision } });
  expect(response.status()).toBe(200);
  return response.json();
}
async function openSources(page: Page, language: Language) {
  await page.getByRole('button', { name: language === 'en' ? 'Settings' : 'Einstellungen', exact: true }).click();
  await page.getByRole('tab', { name: sources.dataSources[language], exact: true }).click();
}
const evidence = (source: Source, title: string) => ({ source, id: 'same-external-id', title, start: '2026-10-01T09:00:00Z', end: null, url: null });
const json = (activities: object[]) => JSON.stringify({ schemaVersion: 1, activities });

for (const initial of ['en', 'de'] as const) {
  const next = initial === 'en' ? 'de' : 'en';
  test.describe(`source/import language switch from ${initial}`, () => {
    test.use({ appLanguage: initial });

    test('source draft and visible server error retranslate without replaying a write', async ({ page }) => {
      await page.goto('/');
      const before = await getState(page);
      await openSources(page, initial);
      await panel(page).getByRole('button', { name: sources.newSource[initial], exact: true }).click();
      await panel(page).getByLabel('Name', { exact: true }).fill('Mein Projekt / My project');
      await panel(page).getByRole('combobox', { name: sources.type[initial], exact: true }).selectOption('github');
      await switchTo(page, next);
      await expect(panel(page).getByLabel('Name', { exact: true })).toHaveValue('Mein Projekt / My project');
      await expect(panel(page).getByRole('combobox', { name: sources.type[next], exact: true })).toHaveValue('github');
      expect(await getState(page)).toEqual(before);
      let writes = 0;
      await page.route('**/api/data-sources', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        writes++;
        await route.fulfill({ status: 400, json: { message: 'Unbekannter Quellentyp.', messageKey: 'error.dataSource.type' } });
      });
      await panel(page).getByRole('button', { name: sources.createTitle[next], exact: true }).click();
      await expect(panel(page).getByRole('alert')).toContainText(next === 'en' ? 'Unknown source type.' : 'Unbekannter Quellentyp.');
      await switchTo(page, initial);
      await expect(panel(page).getByRole('alert')).toContainText(initial === 'en' ? 'Unknown source type.' : 'Unbekannter Quellentyp.');
      await expect(panel(page).getByLabel('Name', { exact: true })).toHaveValue('Mein Projekt / My project');
      expect(writes).toBe(1);
      expect(await getState(page)).toEqual(before);
    });

    test('mixed assignment and open preview survive switching; names and historical snapshots stay intact', async ({ page }) => {
      await page.goto('/');
      let state = await mutate(page, '/api/data-sources', { type: 'slack', name: 'Slack Arbeit / Work' });
      const slack = state.dataSources.find(source => source.type === 'slack')!.id;
      state = await mutate(page, '/api/data-sources', { type: 'github', name: 'GitHub Verein / Club' });
      const github = state.dataSources.find(source => source.type === 'github')!.id;
      for (const [fileName, title] of [['original.json', 'Original user title'], ['update.json', 'Aktueller user title']]) {
        await mutate(page, '/api/import/commit', { format: 'json', text: json([evidence('slack', title)]), assignments: { slack }, fileName });
      }
      const packagesUrl = `/api/data-sources/${slack}/packages?page=0`;
      const history = await (await page.request.get(packagesUrl)).json();
      const original = history.items.find((item: { fileName: string }) => item.fileName === 'original.json');
      const snapshotUrl = `/api/import-packages/${original.id}?page=0`;
      const snapshot = await (await page.request.get(snapshotUrl)).json();
      expect(snapshot.items[0].title).toBe('Original user title');
      await page.reload();
      const before = await getState(page);
      await openSources(page, initial);
      await panel(page).locator('.source-list-item').filter({ hasText: 'Slack Arbeit / Work' }).click();
      await panel(page).getByRole('button', { name: sources.importHere[initial], exact: true }).click();
      const rows = [evidence('slack', 'Aktueller user title'), evidence('github', 'Neue user evidence')];
      await panel(page).locator('input[type=file]').setInputFiles({ name: 'mixed-user-file.json', mimeType: 'application/json', buffer: Buffer.from(json(rows)) });
      await panel(page).getByRole('button', { name: imports.checkFile[initial], exact: true }).click();
      const assignments = panel(page).getByRole('region', { name: imports.assignmentSection[initial], exact: true });
      await expect(assignments.locator('.imp-assignment')).toHaveCount(2);
      await switchTo(page, next);
      const switched = panel(page).getByRole('region', { name: imports.assignmentSection[next], exact: true });
      const targets = switched.getByRole('combobox', { name: imports.targetSource[next], exact: true });
      await expect(targets.nth(0)).toHaveValue(slack);
      await expect(targets.nth(1)).toHaveValue(github);
      await expect(switched).toContainText('mixed-user-file.json');
      await panel(page).getByRole('button', { name: imports.checkPreview[next], exact: true }).click();
      await expect(panel(page).getByRole('region', { name: imports.previewSection[next], exact: true })).toContainText('Neue user evidence');
      let writes = 0;
      page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/')) writes++; });
      await switchTo(page, initial);
      const preview = panel(page).getByRole('region', { name: imports.previewSection[initial], exact: true });
      await expect(preview).toContainText('Slack Arbeit / Work');
      await expect(preview).toContainText('GitHub Verein / Club');
      await expect(preview).toContainText('Aktueller user title');
      await expect(preview).toContainText('Neue user evidence');
      expect(await getState(page)).toEqual(before);
      expect(await (await page.request.get(packagesUrl)).json()).toEqual(history);
      expect(await (await page.request.get(snapshotUrl)).json()).toEqual(snapshot);
      expect(writes).toBe(0);
    });

    test('analysis row errors retranslate with the open input preserved and no database writes', async ({ page }) => {
      await page.goto('/');
      const state = await mutate(page, '/api/data-sources', { type: 'slack', name: 'User source bleibt gleich' });
      await page.reload();
      await openSources(page, initial);
      await panel(page).locator('.source-list-item').filter({ hasText: state.dataSources[0].name }).click();
      await panel(page).getByRole('button', { name: sources.importHere[initial], exact: true }).click();
      const raw = json([{ ...evidence('slack', 'User title remains'), url: 'javascript:alert(1)' }]);
      await panel(page).getByRole('button', { name: imports.pasteData[initial], exact: true }).click();
      await panel(page).getByRole('textbox', { name: imports.pasteData[initial], exact: true }).fill(raw);
      let writes = 0;
      page.on('request', request => { if (request.method() !== 'GET' && !new URL(request.url()).pathname.endsWith('/analyze')) writes++; });
      await panel(page).getByRole('button', { name: imports.checkFile[initial], exact: true }).click();
      await expect(panel(page).getByRole('alert')).toContainText(initial === 'en' ? 'Only HTTP/HTTPS URLs are allowed.' : 'Nur HTTP/HTTPS-URLs sind erlaubt.');
      await switchTo(page, next);
      await expect(panel(page).getByRole('alert')).toContainText(next === 'en' ? 'Only HTTP/HTTPS URLs are allowed.' : 'Nur HTTP/HTTPS-URLs sind erlaubt.');
      await expect(panel(page).getByRole('button', { name: imports.checkPreview[next], exact: true })).toBeDisabled();
      await panel(page).getByRole('button', { name: imports.editInput[next], exact: true }).click();
      await expect(panel(page).getByRole('textbox', { name: imports.pasteData[next], exact: true })).toHaveValue(raw);
      expect(await getState(page)).toEqual(state);
      expect(writes).toBe(0);
    });

    test(`a failed hidden commit preserves its draft when ${initial === 'en' ? 'Close' : 'Escape'} discard is dismissed`, async ({ page }) => {
      await page.goto('/');
      const before = await mutate(page, '/api/data-sources', { type: 'slack', name: 'Retained user source / Quelle' });
      const target = before.dataSources[0].id;
      const packagesUrl = `/api/data-sources/${target}/packages?page=0`;
      const history = await (await page.request.get(packagesUrl)).json();
      await page.reload();
      await openSources(page, initial);
      await panel(page).locator('.source-list-item').filter({ hasText: before.dataSources[0].name }).click();
      await panel(page).getByRole('button', { name: sources.importHere[initial], exact: true }).click();
      const raw = json([evidence('slack', 'Raw user title / unverändert')]);
      await panel(page).getByRole('button', { name: imports.pasteData[initial], exact: true }).click();
      await panel(page).getByRole('textbox', { name: imports.pasteData[initial], exact: true }).fill(raw);
      await panel(page).getByRole('button', { name: imports.checkFile[initial], exact: true }).click();
      await expect(panel(page).getByRole('region', { name: imports.previewSection[initial], exact: true })).toBeVisible();

      const commits: Route[] = [];
      await page.route('**/api/import/commit', route => { commits.push(route); });
      const prompts: string[] = [];
      let discard = false;
      page.on('dialog', async dialog => {
        expect(dialog.type()).toBe('confirm');
        prompts.push(dialog.message());
        await (discard ? dialog.accept() : dialog.dismiss());
      });
      const close = async () => {
        if (initial === 'de') await page.keyboard.press('Escape');
        else await page.getByRole('dialog').getByRole('button', { name: next === 'en' ? 'Close dialog' : 'Dialog schließen', exact: true }).click();
      };
      const failure = { status: 503, json: { message: 'Interner Serverfehler.', messageKey: 'error.http.internal' } };
      const expectedBody = { format: 'json', text: raw, assignments: { slack: target }, expectedRevision: before.revision };
      await panel(page).getByRole('button', { name: imports.confirmImport[initial], exact: true }).click();
      await expect.poll(() => commits.length).toBe(1);
      expect(commits[0].request().postDataJSON()).toEqual(expectedBody);
      await page.getByRole('tab', { name: sources.general[initial], exact: true }).click();
      await expect(page.getByRole('tab', { name: sources.general[initial], exact: true })).toHaveAttribute('aria-selected', 'true');
      expect(prompts).toEqual([]);
      await switchTo(page, next);
      await commits[0].fulfill(failure);
      // The failure belongs to the still-mounted hidden import, not General.
      const hiddenError = panel(page).locator('[role="alert"]');
      await expect(hiddenError).toHaveText(next === 'en' ? 'Internal server error.' : 'Interner Serverfehler.');
      await close();
      expect(prompts).toEqual([imports.discardImport[next]]);
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(page.getByRole('tab', { name: sources.general[next], exact: true })).toHaveAttribute('aria-selected', 'true');
      expect(commits).toHaveLength(1);
      expect(await getState(page)).toEqual(before);

      await page.getByRole('tab', { name: sources.dataSources[next], exact: true }).click();
      const retainedPreview = panel(page).getByRole('region', { name: imports.previewSection[next], exact: true });
      await expect(retainedPreview).toContainText('Raw user title / unverändert');
      await expect(retainedPreview).toContainText('Retained user source / Quelle');
      await expect(retainedPreview.getByRole('alert')).toHaveText(next === 'en' ? 'Internal server error.' : 'Interner Serverfehler.');
      // An explicit retry proves that dismiss kept the exact raw input and target.
      await panel(page).getByRole('button', { name: imports.confirmImport[next], exact: true }).click();
      await expect.poll(() => commits.length).toBe(2);
      expect(commits[1].request().postDataJSON()).toEqual(expectedBody);
      await page.getByRole('tab', { name: sources.general[next], exact: true }).click();
      expect(prompts).toEqual([imports.discardImport[next]]);
      await commits[1].fulfill(failure);
      await expect(hiddenError).toHaveText(next === 'en' ? 'Internal server error.' : 'Interner Serverfehler.');
      discard = true;
      await close();
      expect(prompts).toEqual([imports.discardImport[next], imports.discardImport[next]]);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(commits).toHaveLength(2);
      expect(await getState(page)).toEqual(before);
      expect(await (await page.request.get(packagesUrl)).json()).toEqual(history);
    });
  });
}
