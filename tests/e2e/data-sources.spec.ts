import type { Page, Route, TestInfo } from '@playwright/test';
import type { Activity, AppState, DataPage, ImportInput, ImportPackage, ImportPackagePage, Source } from '../../shared/types.js';
import { test, expect, chooseWeek, getState, openAppAction, openSourceFilters } from './isolated-fixture';

const modal = (page: Page) => page.getByRole('dialog');
const sourcePanel = (page: Page) => modal(page).locator('.sources-panel');
const evidence = (id: string, title: string, source: Source = 'slack', start = '2026-09-30T09:00:00+02:00'): Activity =>
  ({ source, id, title, start, end: null, url: null });
const input = (rows: Activity[], assignments: ImportInput['assignments'], fileName = 'belege.json'): ImportInput =>
  ({ format: 'json', text: JSON.stringify({ schemaVersion: 1, activities: rows }), assignments, fileName });

async function mutate(page: Page, path: string, data: Record<string, unknown>, method = 'POST'): Promise<AppState> {
  const before = await getState(page);
  const response = await page.request.fetch(path, {
    method, headers: { Origin: new URL(page.url()).origin }, data: { ...data, expectedRevision: before.revision },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function createSource(page: Page, name: string, type: Source = 'slack') {
  const state = await mutate(page, '/api/data-sources', { name, type });
  return state.dataSources.find(source => source.name === name)!.id;
}
async function commit(page: Page, data: ImportInput) {
  return mutate(page, '/api/import/commit', { ...data });
}
async function packages(page: Page, id: string): Promise<DataPage<ImportPackage>> {
  const response = await page.request.get(`/api/data-sources/${encodeURIComponent(id)}/packages?page=0`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function settings(page: Page) {
  await openAppAction(page, 'Einstellungen');
  await expect(modal(page)).toHaveCount(1);
  await expect(modal(page).getByRole('tab', { name: 'Allgemein', exact: true })).toHaveAttribute('aria-selected', 'true');
  await modal(page).getByRole('tab', { name: 'Datenquellen', exact: true }).click();
  await expect(sourcePanel(page).getByRole('heading', { name: 'Deine Datenquellen', exact: true })).toBeVisible();
}
async function detail(page: Page, name: string) {
  await sourcePanel(page).locator('.source-list-item').filter({ has: page.getByText(name, { exact: true }) }).click();
  await expect(sourcePanel(page).getByRole('heading', { name, exact: true })).toBeVisible();
}
async function createInSettings(page: Page, name: string) {
  await sourcePanel(page).getByRole('button', { name: 'Neue Datenquelle', exact: true }).click();
  await sourcePanel(page).getByLabel('Name', { exact: true }).fill(name);
  await sourcePanel(page).getByRole('combobox', { name: 'Typ', exact: true }).selectOption('slack');
  await sourcePanel(page).getByRole('button', { name: 'Datenquelle anlegen', exact: true }).click();
  await expect(sourcePanel(page).getByRole('heading', { name, exact: true })).toBeVisible();
}
async function analyzeFile(page: Page, rows: Activity[], fileName = 'belege.json', directPreview = false) {
  await modal(page).locator('input[type=file]').setInputFiles({ name: fileName, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, activities: rows })) });
  await modal(page).getByRole('button', { name: 'Datei prüfen', exact: true }).click();
  if (directPreview) await expect(modal(page).getByRole('region', { name: 'Importvorschau', exact: true })).toBeVisible();
  else await expect(modal(page).getByRole('heading', { name: 'Quellen zuordnen', exact: true })).toBeVisible();
}
async function preview(page: Page) {
  await modal(page).getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  await expect(modal(page).getByRole('region', { name: 'Importvorschau', exact: true })).toBeVisible();
}
async function acceptImport(page: Page) {
  await modal(page).getByRole('button', { name: 'Import bestätigen', exact: true }).click();
  await expect(modal(page).getByRole('heading', { name: 'Import abgeschlossen', exact: true })).toBeVisible();
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

for (const width of [1440, 390]) {
  test.describe(`named sources at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width === 390 });
    test('two Slack instances keep colliding external IDs separate and filters reset on reload', async ({ page }, info) => {
      await page.goto('/');
      await settings(page);
      await createInSettings(page, 'Slack Arbeit');
      await sourcePanel(page).getByRole('button', { name: 'Alle Datenquellen', exact: true }).click();
      await createInSettings(page, 'Slack Privat');
      const state = await getState(page);
      const work = state.dataSources.find(source => source.name === 'Slack Arbeit')!.id;
      const personal = state.dataSources.find(source => source.name === 'Slack Privat')!.id;
      expect(work).not.toBe(personal);
      await commit(page, input([evidence('shared-id', 'Arbeit: Review')], { slack: work }, 'arbeit.json'));
      await commit(page, input([evidence('shared-id', 'Privat: Planung', 'slack', '2026-09-30T11:00:00+02:00')], { slack: personal }, 'privat.json'));
      await page.reload();
      await settings(page);
      await screenshot(page, info, 'sources-list');
      await detail(page, 'Slack Arbeit');
      await expect(sourcePanel(page).locator('.sources-summary')).toContainText('1 aktuelle Belege');
      await expect(sourcePanel(page).locator('.source-package-row .source-package-period')).toHaveText('Belegzeitraum: 30.09.2026 · 09:00 +02:00');
      await screenshot(page, info, 'source-detail');
      await sourcePanel(page).locator('.source-package-row').click();
      await expect(sourcePanel(page).locator('.source-package-info .source-package-period')).toHaveText('Belegzeitraum: 30.09.2026 · 09:00 +02:00');
      await expect(sourcePanel(page).locator('.source-activities')).toContainText('Arbeit: Review');
      await expect(sourcePanel(page).locator('.source-activities')).not.toContainText('Privat: Planung');
      await screenshot(page, info, 'source-package');
      await sourcePanel(page).getByRole('button', { name: 'Zur Datenquelle', exact: true }).click();
      await sourcePanel(page).getByRole('button', { name: 'Hier importieren', exact: true }).click();
      await analyzeFile(page, [evidence('shared-id', 'Arbeit: Review')], 'zuordnung.json', true);
      await modal(page).getByRole('button', { name: 'Zuordnung bearbeiten', exact: true }).click();
      await expect(modal(page).getByRole('combobox', { name: 'Zielquelle', exact: true })).toHaveValue(work);
      await screenshot(page, info, 'source-assignment');
      page.once('dialog', dialog => dialog.accept());
      await page.keyboard.press('Escape');
      await expect(sourcePanel(page).getByRole('heading', { name: 'Slack Arbeit', exact: true })).toBeVisible();
      await modal(page).getByRole('button', { name: 'Dialog schließen', exact: true }).click();
      await expect(modal(page)).toHaveCount(0);
      await chooseWeek(page, '2026-09-30');
      await openSourceFilters(page);
      await page.getByRole('checkbox', { name: 'Slack Arbeit', exact: true }).uncheck();
      await expect(page.getByRole('checkbox', { name: 'Slack Privat', exact: true })).toBeChecked();
      await screenshot(page, info, 'source-filter');
      await page.getByRole('button', { name: 'Belege filtern', exact: true }).click();
      await expect(page.locator('.ov-activity').filter({ hasText: 'Arbeit: Review' })).toHaveCount(0);
      await expect(page.locator('.ov-activity').filter({ hasText: 'Privat: Planung' })).toHaveCount(1);
      await page.reload();
      await chooseWeek(page, '2026-09-30');
      await openSourceFilters(page);
      await expect(page.getByRole('checkbox', { name: 'Slack Arbeit', exact: true })).toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'Slack Privat', exact: true })).toBeChecked();
      expect((await getState(page)).activities.filter(row => row.id === 'shared-id')).toHaveLength(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  });
}

test('mixed file assignment previews without mutation and commits all changed sources in one revision', async ({ page }, info) => {
  await page.goto('/');
  const slack = await createSource(page, 'Slack Projekt');
  const github = await createSource(page, 'GitHub Projekt', 'github');
  const unchanged = await createSource(page, 'Kalender Projekt', 'google_calendar');
  const calendarRow = evidence('meeting', 'Bestehender Termin', 'google_calendar');
  await commit(page, input([calendarRow], { google_calendar: unchanged }, 'alt.json'));
  await page.reload();
  const before = await getState(page);
  await openAppAction(page, 'Importieren');
  await analyzeFile(page, [evidence('shared-id', 'Slack aus Mischdatei'), evidence('commit', 'GitHub aus Mischdatei', 'github'), calendarRow], 'gemischt.json');
  const assignments = modal(page).locator('.imp-assignment');
  await assignments.filter({ has: page.getByText('Slack', { exact: true }) }).getByRole('combobox', { name: 'Zielquelle', exact: true }).selectOption(slack);
  await assignments.filter({ has: page.getByText('GitHub', { exact: true }) }).getByRole('combobox', { name: 'Zielquelle', exact: true }).selectOption(github);
  await assignments.filter({ has: page.getByText('Kalender', { exact: true }) }).getByRole('combobox', { name: 'Zielquelle', exact: true }).selectOption(unchanged);
  await screenshot(page, info, 'mixed-assignment');
  await preview(page);
  expect(await getState(page)).toEqual(before);
  await expect(modal(page)).toContainText('Slack Projekt');
  await expect(modal(page)).toContainText('GitHub Projekt');
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/import/commit')) requests++; });
  await acceptImport(page);
  const after = await getState(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.activities).toHaveLength(3);
  expect(requests).toBe(1);
  expect((await packages(page, slack)).items).toMatchObject([{ fileName: 'gemischt.json', counts: { new: 1 } }]);
  expect((await packages(page, github)).items).toMatchObject([{ fileName: 'gemischt.json', counts: { new: 1 } }]);
  expect((await packages(page, unchanged)).items).toHaveLength(1);
});

test('package snapshots survive updates and an unchanged reimport preserves revision, history and Undo', async ({ page }) => {
  await page.goto('/');
  const id = await createSource(page, 'Slack Historie');
  await commit(page, input([evidence('same', 'Ursprünglicher Titel')], { slack: id }, 'original.json'));
  const original = (await packages(page, id)).items[0];
  const update = input([evidence('same', 'Aktualisierter Titel')], { slack: id }, 'update.json');
  await commit(page, update);
  await mutate(page, '/api/blocks', { start: '2026-09-30T10:00:00+02:00', end: '2026-09-30T11:00:00+02:00', note: 'Undo behalten' });
  await page.reload();
  await settings(page);
  await detail(page, 'Slack Historie');
  await sourcePanel(page).locator('.source-package-row').filter({ hasText: 'original.json' }).click();
  await expect(sourcePanel(page).locator('.source-activities')).toContainText('Ursprünglicher Titel');
  await expect(sourcePanel(page).locator('.source-activities')).not.toContainText('Aktualisierter Titel');
  const snapshot = await (await page.request.get(`/api/import-packages/${original.id}?page=0`)).json() as ImportPackagePage;
  expect(snapshot.items[0].title).toBe('Ursprünglicher Titel');
  await sourcePanel(page).getByRole('button', { name: 'Zur Datenquelle', exact: true }).click();
  await sourcePanel(page).getByRole('tab', { name: 'Aktuelle Belege', exact: true }).click();
  await expect(sourcePanel(page).locator('.source-activities')).toContainText('Aktualisierter Titel');
  await sourcePanel(page).getByRole('button', { name: 'Hier importieren', exact: true }).click();
  await analyzeFile(page, [evidence('same', 'Aktualisierter Titel')], 'erneut.json', true);
  await modal(page).getByRole('button', { name: 'Zuordnung bearbeiten', exact: true }).click();
  await expect(modal(page).getByRole('combobox', { name: 'Zielquelle', exact: true })).toHaveValue(id);
  await preview(page);
  const before = await getState(page);
  expect(before.undo).not.toBeNull();
  let commits = 0;
  page.on('request', request => { if (request.url().endsWith('/api/import/commit')) commits++; });
  await modal(page).getByRole('button', { name: 'Bereits vorhanden', exact: true }).click();
  await expect(modal(page).getByRole('heading', { name: 'Bereits vorhanden', exact: true })).toBeVisible();
  expect(await getState(page)).toEqual(before);
  expect((await packages(page, id)).total).toBe(2);
  expect(commits).toBe(0);
});

test('renaming preserves source and activity keys and updates calendar and filter names', async ({ page }) => {
  await page.goto('/');
  const id = await createSource(page, 'Slack vorher');
  await commit(page, input([evidence('fixed', 'Stabiler Beleg')], { slack: id }));
  await page.reload();
  const before = await getState(page);
  await chooseWeek(page, '2026-09-30');
  const key = await page.locator('.ov-activity').getAttribute('data-activity-key');
  await settings(page);
  await detail(page, 'Slack vorher');
  await sourcePanel(page).getByRole('button', { name: 'Umbenennen', exact: true }).click();
  await sourcePanel(page).getByLabel('Name', { exact: true }).fill('Slack nachher');
  await sourcePanel(page).getByRole('button', { name: 'Name speichern', exact: true }).click();
  await expect(sourcePanel(page).getByRole('heading', { name: 'Slack nachher', exact: true })).toBeVisible();
  const after = await getState(page);
  expect(after.activities).toEqual(before.activities);
  expect(after.dataSources[0]).toMatchObject({ id, type: 'slack', name: 'Slack nachher' });
  expect((await packages(page, id)).total).toBe(1);
  await sourcePanel(page).getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.locator('.ov-activity')).toHaveAttribute('data-activity-key', key!);
  await expect(page.locator('.ov-activity')).toHaveAccessibleName(/Slack nachher/);
  await openSourceFilters(page);
  await expect(page.getByRole('checkbox', { name: 'Slack nachher', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Slack vorher', exact: true })).toHaveCount(0);
});

test('source and package calendar actions select the exact date and colliding IDs focus their own source', async ({ page }) => {
  await page.goto('/');
  const first = await createSource(page, 'Slack A');
  const second = await createSource(page, 'Slack B');
  await commit(page, input([evidence('collision', 'Erster Beleg', 'slack', '2026-09-30T08:00:00+02:00')], { slack: first }, 'a.json'));
  await commit(page, input([evidence('collision', 'Zweiter Beleg', 'slack', '2026-09-30T12:00:00+02:00')], { slack: second }, 'b.json'));
  await page.reload();
  await settings(page);
  await detail(page, 'Slack B');
  await sourcePanel(page).getByRole('button', { name: 'Im Kalender öffnen', exact: true }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue('2026-09-30');
  await page.getByRole('button', { name: 'Tag prüfen', exact: true }).click();
  await expect(page.getByLabel('Tag wählen', { exact: true })).toHaveValue('2026-09-30');
  const row = page.locator('.dr-activity').filter({ hasText: 'Zweiter Beleg' });
  await row.getByRole('button', { name: 'Im Kalender zeigen', exact: true }).click();
  await expect(page.locator('[data-focused-activity=true]')).toHaveAttribute('data-activity-key', JSON.stringify([second, 'collision']));
  await expect(page.locator('[data-focused-activity=true]')).toBeFocused();
  await settings(page);
  await detail(page, 'Slack A');
  await sourcePanel(page).locator('.source-package-row').click();
  await sourcePanel(page).getByRole('button', { name: 'Im Kalender öffnen', exact: true }).click();
  await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue('2026-09-30');
});

test('concurrent rename keeps the opening name clean and requires confirmation before overwriting a foreign name', async ({ page }) => {
  await page.goto('/');
  const id = await createSource(page, 'Öffnungsname');
  await page.reload();
  await settings(page);
  await detail(page, 'Öffnungsname');
  await sourcePanel(page).getByRole('button', { name: 'Umbenennen', exact: true }).click();
  let prompts = 0;
  let accept = false;
  page.on('dialog', async dialog => { prompts++; await (accept ? dialog.accept() : dialog.dismiss()); });
  await mutate(page, `/api/data-sources/${id}`, { name: 'Fremder Name' }, 'PUT');
  // A stale general-settings mutation refreshes AppState without touching the name draft.
  await modal(page).getByRole('tab', { name: 'Allgemein', exact: true }).click();
  await modal(page).getByLabel('Zeitzone suchen', { exact: true }).fill('UTC');
  const refresh = page.waitForResponse(response => response.url().endsWith('/api/state'));
  await modal(page).getByRole('button', { name: 'Speichern', exact: true }).click();
  await (await refresh).finished();
  await modal(page).getByRole('tab', { name: 'Datenquellen', exact: true }).click();
  await expect(sourcePanel(page).getByLabel('Name', { exact: true })).toHaveValue('Öffnungsname');
  await expect(sourcePanel(page)).toContainText('Fremder Name');
  await page.keyboard.press('Escape');
  expect(prompts).toBe(0);
  await expect(sourcePanel(page).getByRole('heading', { name: 'Fremder Name', exact: true })).toBeVisible();
  await sourcePanel(page).getByRole('button', { name: 'Umbenennen', exact: true }).click();
  await sourcePanel(page).getByLabel('Name', { exact: true }).fill('Eigener Entwurf');
  await mutate(page, `/api/data-sources/${id}`, { name: 'Noch neuerer Name' }, 'PUT');
  const conflicting = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/api/data-sources/'));
  await sourcePanel(page).getByRole('button', { name: 'Name speichern', exact: true }).click();
  expect((await conflicting).status()).toBe(409);
  await expect(sourcePanel(page)).toContainText('Noch neuerer Name');
  await expect(sourcePanel(page).getByLabel('Name', { exact: true })).toHaveValue('Eigener Entwurf');
  expect(prompts).toBe(0);
  await sourcePanel(page).getByRole('button', { name: 'Name speichern', exact: true }).click();
  expect(prompts).toBe(1);
  expect((await getState(page)).dataSources[0].name).toBe('Noch neuerer Name');
  const revision = (await getState(page)).revision;
  accept = true;
  const saving = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes('/api/data-sources/'));
  await sourcePanel(page).getByRole('button', { name: 'Name speichern', exact: true }).click();
  expect((await saving).postDataJSON()).toEqual({ name: 'Eigener Entwurf', expectedRevision: revision });
  await expect(sourcePanel(page).getByRole('heading', { name: 'Eigener Entwurf', exact: true })).toBeVisible();
  expect(prompts).toBe(2);
  expect((await getState(page)).dataSources[0]).toMatchObject({ id, name: 'Eigener Entwurf' });
});

test('source deletion confirms counts and removes only its evidence and packages', async ({ page }) => {
  await page.goto('/');
  const target = await createSource(page, 'Löschen');
  const keep = await createSource(page, 'Behalten');
  await commit(page, input([evidence('one', 'Entfernter Beleg'), evidence('two', 'Zweiter entfernter Beleg')], { slack: target }));
  await commit(page, input([evidence('keep', 'Erhaltener Beleg')], { slack: keep }));
  const packageId = (await packages(page, target)).items[0].id;
  await mutate(page, '/api/blocks', { start: '2026-09-30T08:00:00+02:00', end: '2026-09-30T09:00:00+02:00', note: 'Arbeitsnotiz' });
  await mutate(page, '/api/notes/day/2026-09-30', { text: 'Tagesnotiz bleibt' }, 'PUT');
  await mutate(page, '/api/weeks/2026-09-28', { status: 'closed', confirmCurrent: true, confirmWarnings: true });
  await page.reload();
  await settings(page);
  await detail(page, 'Löschen');
  await sourcePanel(page).getByRole('button', { name: 'Datenquelle löschen', exact: true }).click();
  await expect(sourcePanel(page)).toContainText('2 aktuellen Belegen');
  await expect(sourcePanel(page)).toContainText('1 Importpaketen');
  await expect(sourcePanel(page).getByRole('button', { name: /SQLite-Backup/ })).toBeEnabled();
  const before = await getState(page);
  const deleting = page.waitForRequest(request => request.method() === 'DELETE' && request.url().includes('/api/data-sources/'));
  await sourcePanel(page).getByRole('button', { name: 'Datenquelle endgültig löschen', exact: true }).click();
  expect((await deleting).postDataJSON()).toEqual({ expectedRevision: before.revision });
  await expect(sourcePanel(page).getByRole('heading', { name: 'Deine Datenquellen', exact: true })).toBeVisible();
  const after = await getState(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.dataSources.map(source => source.id)).toEqual([keep]);
  expect(after.activities).toEqual(before.activities.filter(row => row.dataSourceId !== target));
  expect(after.blocks).toEqual(before.blocks);
  expect(after.notes).toEqual(before.notes);
  expect(after.weeks).toEqual(before.weeks);
  expect((await page.request.get(`/api/import-packages/${packageId}?page=0`)).status()).toBe(404);
  expect((await packages(page, keep)).total).toBe(1);
});

test('a concurrent import invalidates delete confirmation and requires fresh counts', async ({ page }) => {
  await page.goto('/');
  const id = await createSource(page, 'Konfliktquelle');
  await commit(page, input([evidence('old', 'Alter Beleg')], { slack: id }));
  await page.reload();
  await settings(page);
  await detail(page, 'Konfliktquelle');
  await sourcePanel(page).getByRole('button', { name: 'Datenquelle löschen', exact: true }).click();
  const shownRevision = (await getState(page)).revision;
  await commit(page, input([evidence('new', 'Zwischenzeitlich importiert')], { slack: id }, 'parallel.json'));
  const response = page.waitForResponse(result => result.request().method() === 'DELETE');
  await sourcePanel(page).getByRole('button', { name: 'Datenquelle endgültig löschen', exact: true }).click();
  expect((await response).status()).toBe(409);
  const state = await getState(page);
  expect(state.revision).toBe(shownRevision + 1);
  expect(state.activities).toHaveLength(2);
  expect(state.dataSources[0].packageCount).toBe(2);
  await expect(sourcePanel(page).getByRole('heading', { name: 'Konfliktquelle', exact: true })).toBeVisible();
  await expect(modal(page).getByRole('alert').first()).toBeVisible();
  await sourcePanel(page).getByRole('button', { name: 'Datenquelle löschen', exact: true }).click();
  await expect(sourcePanel(page)).toContainText('2 aktuellen Belegen');
  await expect(sourcePanel(page)).toContainText('2 Importpaketen');
});

test('a pending backup blocks deleting the source until the download is delivered', async ({ page }) => {
  await page.goto('/');
  const id = await createSource(page, 'Backup vor Löschen');
  await commit(page, input([evidence('backup', 'Vor dem Löschen sichern')], { slack: id }));
  await page.reload();
  await settings(page);
  await detail(page, 'Backup vor Löschen');
  await sourcePanel(page).getByRole('button', { name: 'Datenquelle löschen', exact: true }).click();
  const gate = deferred();
  let backupWaiting = false;
  let deleteRequests = 0;
  page.on('request', request => { if (request.method() === 'DELETE' && request.url().includes('/api/data-sources/')) deleteRequests++; });
  await page.route('**/api/backup', async route => {
    const response = await route.fetch();
    backupWaiting = true;
    await gate.promise;
    await route.fulfill({ response });
  });
  const downloading = page.waitForEvent('download');
  await sourcePanel(page).getByRole('button', { name: 'Vorher ein SQLite-Backup herunterladen', exact: true }).click();
  await expect.poll(() => backupWaiting).toBe(true);
  const deleteButton = sourcePanel(page).getByRole('button', { name: 'Datenquelle endgültig löschen', exact: true });
  await expect(deleteButton).toBeDisabled();
  await deleteButton.click({ force: true });
  await deleteButton.dblclick({ force: true });
  await page.keyboard.press('Enter');
  expect(deleteRequests).toBe(0);
  expect((await getState(page)).dataSources.some(source => source.id === id)).toBe(true);
  gate.release();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('im-overdue-backup.sqlite');
  expect(await download.failure()).toBeNull();
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(sourcePanel(page).getByRole('heading', { name: 'Deine Datenquellen', exact: true })).toBeVisible();
  expect(deleteRequests).toBe(1);
  expect((await getState(page)).dataSources).toHaveLength(0);
});

test('settings stays one modal, dirty source names prompt once and back restores heading focus', async ({ page }) => {
  await page.goto('/');
  await settings(page);
  await createInSettings(page, 'Fokusquelle');
  await sourcePanel(page).getByRole('button', { name: 'Umbenennen', exact: true }).click();
  await sourcePanel(page).getByLabel('Name', { exact: true }).fill('Ungespeichert');
  const prompts: string[] = [];
  let accept = false;
  page.on('dialog', async dialog => { prompts.push(dialog.message()); await (accept ? dialog.accept() : dialog.dismiss()); });
  await modal(page).getByRole('tab', { name: 'Allgemein', exact: true }).click();
  expect(prompts).toEqual(['Ungespeicherten Namen verwerfen?']);
  await expect(sourcePanel(page).getByLabel('Name', { exact: true })).toHaveValue('Ungespeichert');
  await expect(modal(page)).toHaveCount(1);
  accept = true;
  await sourcePanel(page).getByRole('button', { name: 'Zur Datenquelle', exact: true }).click();
  expect(prompts).toHaveLength(2);
  await expect(sourcePanel(page).getByRole('heading', { name: 'Fokusquelle', exact: true })).toBeFocused();
  await sourcePanel(page).getByRole('button', { name: 'Hier importieren', exact: true }).click();
  await expect(modal(page)).toHaveCount(1);
  await expect(modal(page).getByRole('heading', { name: 'Aktivitäten einspielen', exact: true })).toBeFocused();
  await modal(page).getByRole('button', { name: 'Zur Quelle', exact: true }).click();
  await expect(sourcePanel(page).getByRole('heading', { name: 'Fokusquelle', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sourcePanel(page).getByRole('heading', { name: 'Deine Datenquellen', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);
  expect(prompts).toHaveLength(2);
  await expect(page.getByRole('button', { name: 'Einstellungen', exact: true })).toBeFocused();
});

test('pending local source creation blocks leaving and inline source drafts ask exactly once', async ({ page }) => {
  await page.goto('/');
  await settings(page);
  await sourcePanel(page).getByRole('button', { name: 'Neue Datenquelle', exact: true }).click();
  await sourcePanel(page).getByLabel('Name', { exact: true }).fill('Verzögert');
  await sourcePanel(page).getByRole('combobox', { name: 'Typ', exact: true }).selectOption('slack');
  const gate = deferred();
  let held: Route | undefined;
  await page.route('**/api/data-sources', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    held = route;
    await gate.promise;
    await route.continue();
  });
  await sourcePanel(page).getByRole('button', { name: 'Datenquelle anlegen', exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.keyboard.press('Escape');
  await modal(page).getByRole('tab', { name: 'Allgemein', exact: true }).click();
  await expect(sourcePanel(page).getByRole('heading', { name: 'Datenquelle anlegen', exact: true })).toBeVisible();
  await expect(modal(page)).toHaveCount(1);
  gate.release();
  await expect(sourcePanel(page).getByRole('heading', { name: 'Verzögert', exact: true })).toBeVisible();
  await page.unroute('**/api/data-sources');
  await sourcePanel(page).getByRole('button', { name: 'Hier importieren', exact: true }).click();
  await analyzeFile(page, [evidence('draft', 'Inline Quelle')], 'belege.json', true);
  await modal(page).getByRole('button', { name: 'Zuordnung bearbeiten', exact: true }).click();
  await modal(page).getByRole('button', { name: 'Neue Quelle anlegen', exact: true }).click();
  await modal(page).getByLabel('Name der neuen Quelle', { exact: true }).fill('Quellenentwurf');
  let prompts = 0;
  page.on('dialog', async dialog => { prompts++; await dialog.dismiss(); });
  await page.keyboard.press('Escape');
  expect(prompts).toBe(1);
  await expect(modal(page).getByLabel('Name der neuen Quelle', { exact: true })).toHaveValue('Quellenentwurf');
  await expect(modal(page)).toHaveCount(1);
  const inlineGate = deferred();
  let inlinePending = false;
  await page.route('**/api/data-sources', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    inlinePending = true;
    await inlineGate.promise;
    await route.continue();
  });
  await modal(page).getByRole('button', { name: 'Quelle anlegen', exact: true }).click();
  await expect.poll(() => inlinePending).toBe(true);
  await page.keyboard.press('Escape');
  await modal(page).getByRole('tab', { name: 'Allgemein', exact: true }).click();
  expect(prompts).toBe(1);
  await expect(modal(page).getByRole('heading', { name: 'Quellen zuordnen', exact: true })).toBeVisible();
  inlineGate.release();
  await expect(modal(page).getByLabel('Name der neuen Quelle', { exact: true })).toHaveCount(0);
  const created = (await getState(page)).dataSources.find(source => source.name === 'Quellenentwurf')!;
  await expect(modal(page).getByRole('combobox', { name: 'Zielquelle', exact: true })).toHaveValue(created.id);
});

test('late browse responses cannot replace another source and commit may finish after closing its dialog', async ({ page }) => {
  await page.goto('/');
  const first = await createSource(page, 'Langsam');
  const second = await createSource(page, 'Schnell');
  await commit(page, input([evidence('first', 'Langsamer Titel')], { slack: first }, 'langsam.json'));
  await commit(page, input([evidence('second', 'Schneller Titel')], { slack: second }, 'schnell.json'));
  await page.reload();
  await settings(page);
  const readGate = deferred();
  let waiting = false;
  let delivered = false;
  await page.route(`**/api/data-sources/${first}/packages?*`, async route => {
    const response = await route.fetch();
    waiting = true;
    await readGate.promise;
    await route.fulfill({ response });
    delivered = true;
  });
  await detail(page, 'Langsam');
  await expect.poll(() => waiting).toBe(true);
  await sourcePanel(page).getByRole('button', { name: 'Alle Datenquellen', exact: true }).click();
  await detail(page, 'Schnell');
  await expect(sourcePanel(page).locator('.source-package-row')).toContainText('schnell.json');
  readGate.release();
  await expect.poll(() => delivered).toBe(true);
  await page.unroute(`**/api/data-sources/${first}/packages?*`);
  await expect(sourcePanel(page).locator('.source-package-row')).not.toContainText('langsam.json');
  await sourcePanel(page).getByRole('button', { name: 'Hier importieren', exact: true }).click();
  await analyzeFile(page, [evidence('third', 'Nach Dialogschluss gespeichert')], 'belege.json', true);
  const commitGate = deferred();
  let committed = false;
  await page.route('**/api/import/commit', async route => {
    const response = await route.fetch();
    committed = true;
    await commitGate.promise;
    await route.fulfill({ response });
  });
  await modal(page).getByRole('button', { name: 'Import bestätigen', exact: true }).click();
  await expect.poll(() => committed).toBe(true);
  await modal(page).getByRole('button', { name: 'Dialog schließen', exact: true }).click();
  await expect(modal(page)).toHaveCount(0);
  const commitDelivered = page.waitForResponse(response => response.url().endsWith('/api/import/commit'));
  commitGate.release();
  await (await commitDelivered).finished();
  await expect.poll(async () => (await getState(page)).activities.some(row => row.id === 'third')).toBe(true);
  await settings(page);
  await detail(page, 'Schnell');
  await expect(sourcePanel(page).locator('.sources-summary')).toContainText('2 aktuelle Belege');
  await expect(modal(page)).toHaveCount(1);
});

test('source and package paging use zero-based pages, search resets paging and autumn offsets stay explicit', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  const id = await createSource(page, 'Viele Belege');
  const rows = Array.from({ length: 55 }, (_, index) => evidence(`many-${index}`, `Beleg ${String(index).padStart(2, '0')}`, 'slack', `2026-10-25T${String(3 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00+01:00`));
  rows.push(evidence('fold-summer', 'Zeitumstellung Sommer', 'slack', '2026-10-25T02:30:00+02:00'), evidence('fold-winter', 'Zeitumstellung Winter', 'slack', '2026-10-25T02:30:00+01:00'));
  await commit(page, input(rows, { slack: id }, 'umfangreich.json'));
  for (let index = 0; index < 50; index++) await commit(page, input([evidence(`history-${index}`, `Historie ${index}`)], { slack: id }, `historie-${String(index).padStart(2, '0')}.json`));
  await page.reload();
  await settings(page);
  await detail(page, 'Viele Belege');
  await expect(sourcePanel(page).locator('.source-package-row')).toHaveCount(50);
  const nextRequest = page.waitForRequest(request => request.url().includes('/packages?') && new URL(request.url()).searchParams.get('page') === '1');
  await sourcePanel(page).getByRole('button', { name: 'Nächste Seite', exact: true }).click();
  await nextRequest;
  await expect(sourcePanel(page).locator('.sources-pagination')).toContainText('51–51 von 51');
  await sourcePanel(page).getByLabel('Importdatei suchen', { exact: true }).fill('umfangreich');
  await expect(sourcePanel(page).locator('.sources-pagination')).toContainText('1–1 von 1');
  await expect(sourcePanel(page).locator('.source-package-row .source-package-period')).toHaveText('Belegzeitraum: 25.10.2026 · 02:30 +02:00 – 25.10.2026 · 03:54 +01:00');
  await sourcePanel(page).locator('.source-package-row').click();
  await expect(sourcePanel(page).locator('.source-package-info .source-package-period')).toHaveText('Belegzeitraum: 25.10.2026 · 02:30 +02:00 – 25.10.2026 · 03:54 +01:00');
  await expect(sourcePanel(page).locator('.source-activities article')).toHaveCount(50);
  await sourcePanel(page).getByRole('button', { name: 'Nächste Seite', exact: true }).click();
  await expect(sourcePanel(page).locator('.sources-pagination')).toContainText('51–57 von 57');
  await sourcePanel(page).getByLabel('Nach Titel suchen', { exact: true }).fill('Zeitumstellung');
  await expect(sourcePanel(page).locator('.source-activities article')).toHaveCount(2);
  await expect(sourcePanel(page).locator('.source-activities')).toContainText('25.10.2026 · 02:30 +02:00');
  await expect(sourcePanel(page).locator('.source-activities')).toContainText('25.10.2026 · 02:30 +01:00');
  await sourcePanel(page).getByRole('button', { name: 'Zur Datenquelle', exact: true }).click();
  await sourcePanel(page).getByRole('tab', { name: 'Aktuelle Belege', exact: true }).click();
  await expect(sourcePanel(page).locator('.source-activities article')).toHaveCount(50);
  await sourcePanel(page).getByRole('button', { name: 'Nächste Seite', exact: true }).click();
  await expect(sourcePanel(page).locator('.sources-pagination')).toContainText('51–100 von 107');
  await sourcePanel(page).getByLabel('Nach Titel suchen', { exact: true }).fill('Beleg 54');
  await expect(sourcePanel(page).locator('.source-activities article')).toHaveCount(1);
  await expect(sourcePanel(page).locator('.sources-pagination')).toContainText('1–1 von 1');
});
