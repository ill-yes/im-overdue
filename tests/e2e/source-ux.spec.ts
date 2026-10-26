import type { Page } from '@playwright/test';
import type { Activity, AppState, DataPage, ImportPackage, Source } from '../../shared/types.js';
import { test, expect, assignImportSources, getState, openAppAction, openSourceFilters } from './isolated-fixture';

const dialog = (page: Page) => page.getByRole('dialog');
const panel = (page: Page) => dialog(page).locator('.sources-panel');
const preview = (page: Page) => dialog(page).getByRole('region', { name: 'Importvorschau', exact: true });
const activity = (id = 'source-ux', title = 'Quellenbeleg', source: Source = 'slack', start = '2026-09-30T09:00:00+02:00'): Activity =>
  ({ id, title, source, start, end: null, url: null });
const json = (rows = [activity()]) => JSON.stringify({ schemaVersion: 1, activities: rows });

async function mutate(page: Page, path: string, data: object): Promise<AppState> {
  const state = await getState(page);
  const response = await page.request.post(path, {
    headers: { Origin: new URL(page.url()).origin }, data: { ...data, expectedRevision: state.revision },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function seedSource(page: Page, name: string, type: Source = 'slack') {
  return (await mutate(page, '/api/data-sources', { name, type })).dataSources.find(source => source.name === name)!.id;
}
async function sourcePackages(page: Page, id: string): Promise<DataPage<ImportPackage>> {
  const response = await page.request.get(`/api/data-sources/${id}/packages?page=0`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function openSettings(page: Page) {
  await openAppAction(page, 'Einstellungen');
  await dialog(page).getByRole('tab', { name: 'Datenquellen', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: 'Deine Datenquellen', exact: true })).toBeVisible();
}
async function openDetail(page: Page, name: string) {
  await panel(page).locator('.source-list-item').filter({ has: page.getByText(name, { exact: true }) }).click();
  await expect(panel(page).getByRole('heading', { name, exact: true })).toBeVisible();
}
async function openEmbedded(page: Page, name: string) {
  await openSettings(page);
  await openDetail(page, name);
  await panel(page).getByRole('button', { name: 'Hier importieren', exact: true }).click();
}
async function enterFile(page: Page, rows = [activity()], name = 'quelle.json') {
  await dialog(page).locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(json(rows)) });
  await expect(dialog(page).getByRole('button', { name: 'Datei prüfen', exact: true })).toBeEnabled();
}
async function enterPaste(page: Page, text = json()) {
  await dialog(page).getByRole('button', { name: 'Daten einfügen', exact: true }).click();
  await dialog(page).getByRole('textbox', { name: 'Daten einfügen', exact: true }).fill(text);
}
async function analyze(page: Page, direct = false) {
  await dialog(page).getByRole('button', { name: 'Datei prüfen', exact: true }).click();
  if (direct) await expect(preview(page)).toBeVisible();
  else await expect(dialog(page).getByRole('region', { name: 'Importquellen zuordnen', exact: true })).toBeVisible();
}
async function commit(page: Page) {
  await dialog(page).getByRole('button', { name: 'Import bestätigen', exact: true }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Import abgeschlossen', exact: true })).toBeVisible();
}
function confirmations(page: Page) {
  const messages: string[] = [];
  let accept = false;
  page.on('dialog', async native => {
    expect(native.type()).toBe('confirm');
    messages.push(native.message());
    await (accept ? native.accept() : native.dismiss());
  });
  return { messages, accept: () => { accept = true; } };
}
function deferred() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

for (const width of [1440, 390]) {
  test.describe(`source UX at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width === 390 });
    test('create, direct preview, historical package and explicit reveal preserve other filters and persisted state', async ({ page }, info) => {
      await page.goto('/');
      const other = await seedSource(page, 'Andere ausgeblendete Quelle');
      await mutate(page, '/api/import/commit', { format: 'json', text: json([activity('other', 'Anderer Beleg')]), assignments: { slack: other }, fileName: 'andere.json' });
      await page.reload();
      await openSettings(page);
      await panel(page).getByRole('button', { name: 'Neue Datenquelle', exact: true }).click();
      await panel(page).getByLabel('Name', { exact: true }).fill('Slack Projekt');
      await panel(page).getByRole('combobox', { name: 'Typ', exact: true }).selectOption('slack');
      if (width === 390) {
        await page.evaluate(() => {
          document.documentElement.dataset.sourceUxTouch = 'waiting';
          document.addEventListener('touchstart', () => { document.documentElement.dataset.sourceUxTouch = 'received'; }, { once: true });
        });
        await panel(page).getByRole('button', { name: 'Datenquelle anlegen', exact: true }).tap();
        await expect(page.locator('html')).toHaveAttribute('data-source-ux-touch', 'received');
      } else await panel(page).getByRole('button', { name: 'Datenquelle anlegen', exact: true }).click();
      await expect(panel(page).getByRole('heading', { name: 'Slack Projekt', exact: true })).toBeVisible();
      const id = (await getState(page)).dataSources.find(source => source.name === 'Slack Projekt')!.id;
      await panel(page).getByRole('button', { name: 'Hier importieren', exact: true }).click();
      const before = await getState(page);
      await enterFile(page, [activity('same', 'Historischer Stand', 'slack', '2026-09-23T09:00:00+02:00')], 'historisch.json');
      await analyze(page, true);
      await expect(dialog(page).getByRole('heading', { name: 'Quellen zuordnen', exact: true })).toHaveCount(0);
      await expect(preview(page)).toContainText('Slack Projekt');
      expect(await getState(page)).toEqual(before);
      await page.screenshot({ path: info.outputPath('direct-preview.png'), fullPage: true });
      await commit(page);
      await expect(dialog(page).getByRole('button', { name: 'Schließen', exact: true })).toBeVisible();
      await expect(dialog(page).getByRole('button', { name: 'Zeitraum öffnen', exact: true })).toBeVisible();
      await dialog(page).getByRole('button', { name: 'Zur Datenquelle', exact: true }).click();
      await expect(panel(page).getByRole('heading', { name: 'Slack Projekt', exact: true })).toBeFocused();
      await panel(page).getByRole('button', { name: 'Hier importieren', exact: true }).click();
      await enterFile(page, [activity('same', 'Aktueller Stand', 'slack', '2026-09-30T09:00:00+02:00')], 'aktuell.json');
      await analyze(page, true);
      await commit(page);
      await dialog(page).getByRole('button', { name: 'Zur Datenquelle', exact: true }).click();
      await expect(panel(page).locator('.source-package-row')).toHaveCount(2);
      await panel(page).getByRole('button', { name: 'Schließen', exact: true }).click();
      await openSourceFilters(page);
      await page.getByRole('checkbox', { name: 'Slack Projekt', exact: true }).uncheck();
      await page.getByRole('checkbox', { name: 'Andere ausgeblendete Quelle', exact: true }).uncheck();
      await page.getByRole('button', { name: 'Belege filtern', exact: true }).click();
      const persisted = await getState(page);
      let writes = 0;
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) writes++; });
      await openSettings(page);
      await openDetail(page, 'Slack Projekt');
      await expect(panel(page).getByText('Diese Datenquelle ist im Kalender ausgeblendet.', { exact: true })).toBeVisible();
      await expect(panel(page).getByRole('button', { name: 'Im Kalender öffnen', exact: true })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('hidden-source.png'), fullPage: true });
      await panel(page).locator('.source-package-row').filter({ hasText: 'historisch.json' }).click();
      await expect(panel(page).locator('.source-activities')).toContainText('Historischer Stand');
      await expect(panel(page).locator('.source-activities')).not.toContainText('Aktueller Stand');
      await expect(panel(page).getByText('Diese Datenquelle ist im Kalender ausgeblendet.', { exact: true })).toBeVisible();
      await expect(panel(page).getByRole('button', { name: 'Im Kalender öffnen', exact: true })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('hidden-package.png'), fullPage: true });
      await panel(page).getByRole('button', { name: 'Quelle einblenden und öffnen', exact: true }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue('2026-09-23');
      await openSourceFilters(page);
      await expect(page.getByRole('checkbox', { name: 'Slack Projekt', exact: true })).toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'Andere ausgeblendete Quelle', exact: true })).not.toBeChecked();
      await page.getByRole('checkbox', { name: 'Slack Projekt', exact: true }).uncheck();
      await page.getByRole('button', { name: 'Belege filtern', exact: true }).click();
      await openSettings(page);
      await openDetail(page, 'Slack Projekt');
      await panel(page).getByRole('button', { name: 'Quelle einblenden und öffnen', exact: true }).click();
      await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue('2026-09-30');
      await expect(page.locator('.ov-activity').filter({ hasText: 'Aktueller Stand' })).toHaveCount(1);
      await openSourceFilters(page);
      await expect(page.getByRole('checkbox', { name: 'Slack Projekt', exact: true })).toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'Andere ausgeblendete Quelle', exact: true })).not.toBeChecked();
      await page.getByRole('button', { name: 'Belege filtern', exact: true }).click();
      await openSettings(page);
      await openDetail(page, 'Slack Projekt');
      await expect(panel(page).getByRole('button', { name: 'Im Kalender öffnen', exact: true })).toBeVisible();
      await expect(panel(page).getByRole('button', { name: 'Quelle einblenden und öffnen', exact: true })).toHaveCount(0);
      expect(await getState(page)).toEqual(persisted);
      expect((await sourcePackages(page, id)).total).toBe(2);
      expect(writes).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  });
}

for (const format of ['json', 'csv'] as const) {
  test(`unchanged published ${format.toUpperCase()} stays global assignment and reimport preserves revision, package history and Undo`, async ({ page }) => {
    await page.goto('/');
    const before = await getState(page);
    await openAppAction(page, 'Importieren');
    await dialog(page).locator('input[type=file]').setInputFiles(`examples/activities.${format}`);
    await analyze(page);
    await assignImportSources(page);
    await dialog(page).getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
    await expect(preview(page)).toBeVisible();
    let commits = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/import/commit') commits++; });
    await commit(page);
    const imported = await getState(page);
    expect(imported.activities).toHaveLength(13);
    expect(imported.revision).toBe(before.revision + imported.dataSources.length + 1);
    expect(commits).toBe(1);
    await dialog(page).getByRole('button', { name: 'Schließen', exact: true }).click();
    await mutate(page, '/api/blocks', { start: '2026-09-30T08:00:00+02:00', end: '2026-09-30T09:00:00+02:00', note: 'Undo erhalten' });
    await page.reload();
    const stable = await getState(page);
    expect(stable.undo).not.toBeNull();
    const history = await Promise.all(stable.dataSources.map(source => sourcePackages(page, source.id)));
    await openAppAction(page, 'Importieren');
    await dialog(page).locator('input[type=file]').setInputFiles(`examples/activities.${format}`);
    await analyze(page);
    await assignImportSources(page);
    await dialog(page).getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
    await expect(preview(page)).toContainText('13 unverändert');
    await dialog(page).getByRole('button', { name: 'Bereits vorhanden', exact: true }).click();
    await expect(dialog(page).getByRole('heading', { name: 'Bereits vorhanden', exact: true })).toBeVisible();
    const prompts = confirmations(page);
    await dialog(page).getByRole('button', { name: 'Schließen', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(prompts.messages).toEqual([]);
    expect(commits).toBe(1);
    expect(await getState(page)).toEqual(stable);
    expect(await Promise.all(stable.dataSources.map(source => sourcePackages(page, source.id)))).toEqual(history);
  });
}

for (const [step, exit] of [['file', 'header'], ['paste', 'escape'], ['assignment', 'backdrop'], ['preview', 'header']] as const) {
  test(`${step} draft asks once on ${exit}; cancellation retains the input, step and assignment`, async ({ page }) => {
    await page.goto('/');
    const id = await seedSource(page, 'Zielquelle');
    await page.reload();
    const stable = await getState(page);
    await openAppAction(page, 'Importieren');
    if (step === 'paste') await enterPaste(page);
    else await enterFile(page);
    if (step === 'assignment' || step === 'preview') {
      await analyze(page);
      await dialog(page).getByRole('combobox', { name: 'Zielquelle', exact: true }).selectOption(id);
      if (step === 'preview') {
        await dialog(page).getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
        await expect(preview(page)).toBeVisible();
      }
    }
    const prompts = confirmations(page);
    const leave = async () => {
      if (exit === 'header') await dialog(page).getByRole('button', { name: 'Dialog schließen', exact: true }).click();
      else if (exit === 'escape') await page.keyboard.press('Escape');
      else await page.locator('.modal-backdrop').dispatchEvent('mousedown');
    };
    await leave();
    expect(prompts.messages).toHaveLength(1);
    await expect(dialog(page)).toHaveCount(1);
    if (step === 'paste') await expect(dialog(page).getByRole('textbox', { name: 'Daten einfügen', exact: true })).toHaveValue(json());
    else if (step === 'file') await expect(dialog(page).locator('.imp-file strong')).toHaveText('quelle.json');
    else if (step === 'assignment') await expect(dialog(page).getByRole('combobox', { name: 'Zielquelle', exact: true })).toHaveValue(id);
    else {
      await expect(preview(page)).toContainText('Quellenbeleg');
      await dialog(page).getByRole('button', { name: 'Zuordnung bearbeiten', exact: true }).click();
      await expect(dialog(page).getByRole('combobox', { name: 'Zielquelle', exact: true })).toHaveValue(id);
    }
    prompts.accept();
    await leave();
    expect(prompts.messages).toHaveLength(2);
    await expect(dialog(page)).toHaveCount(0);
    expect(await getState(page)).toEqual(stable);
  });
}

for (const inactive of ['file', 'paste'] as const) {
  test(`an inactive ${inactive} draft remains protected and is retained after cancelling discard`, async ({ page }) => {
    await page.goto('/');
    await openAppAction(page, 'Importieren');
    if (inactive === 'file') {
      await enterFile(page);
      await dialog(page).getByRole('button', { name: 'Daten einfügen', exact: true }).click();
      await expect(dialog(page).getByRole('textbox', { name: 'Daten einfügen', exact: true })).toHaveValue('');
    } else {
      await enterPaste(page);
      await dialog(page).getByRole('button', { name: 'Datei auswählen', exact: true }).click();
    }
    const prompts = confirmations(page);
    await page.keyboard.press('Escape');
    expect(prompts.messages).toHaveLength(1);
    if (inactive === 'file') {
      await dialog(page).getByRole('button', { name: 'Datei auswählen', exact: true }).click();
      await expect(dialog(page).locator('.imp-file strong')).toHaveText('quelle.json');
    } else {
      await dialog(page).getByRole('button', { name: 'Daten einfügen', exact: true }).click();
      await expect(dialog(page).getByRole('textbox', { name: 'Daten einfügen', exact: true })).toHaveValue(json());
    }
    prompts.accept();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(prompts.messages).toHaveLength(2);
  });
}

test('inline source name and import draft share one discard confirmation on leaving Settings', async ({ page }) => {
  await page.goto('/');
  await seedSource(page, 'Bestehende Quelle');
  await page.reload();
  await openEmbedded(page, 'Bestehende Quelle');
  await enterFile(page);
  await analyze(page, true);
  await dialog(page).getByRole('button', { name: 'Zuordnung bearbeiten', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Neue Quelle anlegen', exact: true }).click();
  await dialog(page).getByLabel('Name der neuen Quelle', { exact: true }).fill('Inline Entwurf');
  const prompts = confirmations(page);
  await dialog(page).getByRole('tab', { name: 'Allgemein', exact: true }).click();
  expect(prompts.messages).toHaveLength(1);
  await expect(dialog(page).getByRole('tab', { name: 'Datenquellen', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog(page).getByLabel('Name der neuen Quelle', { exact: true })).toHaveValue('Inline Entwurf');
  prompts.accept();
  await dialog(page).getByRole('tab', { name: 'Allgemein', exact: true }).click();
  expect(prompts.messages).toHaveLength(2);
  await expect(dialog(page).getByRole('tab', { name: 'Allgemein', exact: true })).toHaveAttribute('aria-selected', 'true');
});

for (const embedded of [false, true]) {
  test(`${embedded ? 'embedded Zur Quelle' : 'global Schließen'} footer asks exactly once across flow and parent guards`, async ({ page }) => {
    await page.goto('/');
    if (embedded) {
      await seedSource(page, 'Footerquelle');
      await page.reload();
      await openEmbedded(page, 'Footerquelle');
    } else await openAppAction(page, 'Importieren');
    await enterPaste(page);
    const prompts = confirmations(page);
    const close = () => dialog(page).getByRole('button', { name: embedded ? 'Zur Quelle' : 'Schließen', exact: true }).click();
    await close();
    expect(prompts.messages).toHaveLength(1);
    await expect(dialog(page).getByRole('textbox', { name: 'Daten einfügen', exact: true })).toHaveValue(json());
    prompts.accept();
    await close();
    expect(prompts.messages).toHaveLength(2);
    if (embedded) await expect(panel(page).getByRole('heading', { name: 'Footerquelle', exact: true })).toBeVisible();
    else await expect(dialog(page)).toHaveCount(0);
    expect((await getState(page)).activities).toEqual([]);
  });
}

test('pending commit can cross Settings tabs and receives its result without another confirmation', async ({ page }) => {
  await page.goto('/');
  const target = await seedSource(page, 'Commit läuft weiter');
  await page.reload();
  await openEmbedded(page, 'Commit läuft weiter');
  await enterFile(page);
  await analyze(page, true);
  const gate = deferred();
  let waiting = false;
  let delivered = false;
  let commits = 0;
  await page.route('**/api/import/commit', async route => {
    commits++;
    const response = await route.fetch();
    waiting = true;
    await gate.promise;
    await route.fulfill({ response });
    delivered = true;
  });
  const prompts = confirmations(page);
  try {
    await dialog(page).getByRole('button', { name: 'Import bestätigen', exact: true }).click();
    await expect.poll(() => waiting).toBe(true);
    await dialog(page).getByRole('tab', { name: 'Allgemein', exact: true }).click();
    await expect(dialog(page).getByRole('tab', { name: 'Allgemein', exact: true })).toHaveAttribute('aria-selected', 'true');
    await dialog(page).getByRole('tab', { name: 'Datenquellen', exact: true }).click();
    await expect(dialog(page).getByRole('button', { name: 'Importieren …', exact: true })).toBeDisabled();
    expect(prompts.messages).toEqual([]);
    gate.release();
    await expect.poll(() => delivered).toBe(true);
    await expect(dialog(page).getByRole('heading', { name: 'Import abgeschlossen', exact: true })).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Schließen', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(prompts.messages).toEqual([]);
    expect(commits).toBe(1);
    expect((await getState(page)).activities).toMatchObject([{ dataSourceId: target, id: 'source-ux' }]);
  } finally { gate.release(); }
});

test('empty input and completed embedded import close without confirmation', async ({ page }) => {
  await page.goto('/');
  const prompts = confirmations(page);
  await openAppAction(page, 'Importieren');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await seedSource(page, 'Ergebnisquelle');
  await page.reload();
  await openEmbedded(page, 'Ergebnisquelle');
  await enterFile(page);
  await analyze(page, true);
  await commit(page);
  await dialog(page).getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(prompts.messages).toEqual([]);
});

test('opening an imported period preserves hidden source filters until explicit reveal', async ({ page }) => {
  await page.goto('/');
  const target = await seedSource(page, 'Import bleibt ausgeblendet');
  await seedSource(page, 'Weitere ausgeblendete Quelle');
  await page.reload();
  await openSourceFilters(page);
  await page.getByRole('checkbox', { name: 'Import bleibt ausgeblendet', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Weitere ausgeblendete Quelle', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Belege filtern', exact: true }).click();
  await openEmbedded(page, 'Import bleibt ausgeblendet');
  await enterFile(page);
  await analyze(page, true);
  await expect(preview(page)).toContainText('ausgeblendet');
  await commit(page);
  await expect(dialog(page).getByRole('region', { name: 'Importergebnis', exact: true })).toContainText('ausgeblendet');
  const stable = await getState(page);
  expect(stable.activities).toMatchObject([{ dataSourceId: target }]);
  await dialog(page).getByRole('button', { name: 'Zeitraum öffnen', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue('2026-09-30');
  await expect(page.locator('.ov-activity').filter({ hasText: 'Quellenbeleg' })).toHaveCount(0);
  await openSourceFilters(page);
  await expect(page.getByRole('checkbox', { name: 'Import bleibt ausgeblendet', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Weitere ausgeblendete Quelle', exact: true })).not.toBeChecked();
  expect(await getState(page)).toEqual(stable);
});

for (const scenario of ['global-single', 'embedded-mixed', 'embedded-wrong', 'embedded-errors'] as const) {
  test(`${scenario} retains explicit assignment instead of automatic preview`, async ({ page }) => {
    await page.goto('/');
    const slack = await seedSource(page, 'Slack Ziel');
    await seedSource(page, 'GitHub Ziel', 'github');
    await page.reload();
    if (scenario === 'global-single') await openAppAction(page, 'Importieren');
    else await openEmbedded(page, 'Slack Ziel');
    const rows = scenario === 'embedded-mixed' ? [activity(), activity('github', 'GitHub Beleg', 'github')]
      : scenario === 'embedded-wrong' ? [activity('github', 'GitHub Beleg', 'github')]
      : scenario === 'embedded-errors' ? [activity(), { ...activity('invalid'), start: 'kein-datum' }]
      : [activity()];
    await enterFile(page, rows);
    let previews = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/import/preview') previews++; });
    await analyze(page);
    await expect(preview(page)).toHaveCount(0);
    expect(previews).toBe(0);
    if (scenario === 'embedded-errors') {
      await expect(dialog(page).getByRole('alert')).toContainText('Datei korrigieren');
      await expect(dialog(page).getByRole('button', { name: 'Vorschau prüfen', exact: true })).toBeDisabled();
    } else if (scenario === 'global-single') await expect(dialog(page).getByRole('combobox', { name: 'Zielquelle', exact: true })).toHaveValue(slack);
    expect((await getState(page)).activities).toEqual([]);
  });
}

test('editing an automatic target requires a fresh preview and commits once to the selected source', async ({ page }) => {
  await page.goto('/');
  const first = await seedSource(page, 'Ursprüngliches Ziel');
  const second = await seedSource(page, 'Gewähltes Ziel');
  await page.reload();
  await openEmbedded(page, 'Ursprüngliches Ziel');
  await enterFile(page);
  await analyze(page, true);
  await dialog(page).getByRole('button', { name: 'Zuordnung bearbeiten', exact: true }).click();
  await expect(dialog(page).getByRole('combobox', { name: 'Zielquelle', exact: true })).toHaveValue(first);
  await dialog(page).getByRole('combobox', { name: 'Zielquelle', exact: true }).selectOption(second);
  await expect(dialog(page).getByRole('button', { name: 'Import bestätigen', exact: true })).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  await expect(preview(page)).toContainText('Gewähltes Ziel');
  let commits = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/import/commit') commits++; });
  await dialog(page).getByRole('button', { name: 'Import bestätigen', exact: true }).dblclick();
  await expect(dialog(page).getByRole('heading', { name: 'Import abgeschlossen', exact: true })).toBeVisible();
  expect((await getState(page)).activities).toMatchObject([{ dataSourceId: second, id: 'source-ux' }]);
  expect((await sourcePackages(page, first)).total).toBe(0);
  expect((await sourcePackages(page, second)).total).toBe(1);
  expect(commits).toBe(1);
});

test('an automatic preview failure keeps explicit assignment available and retry does not commit', async ({ page }) => {
  await page.goto('/');
  const target = await seedSource(page, 'Vorschau erneut prüfen');
  await page.reload();
  const stable = await getState(page);
  await openEmbedded(page, 'Vorschau erneut prüfen');
  await enterFile(page);
  let previews = 0;
  await page.route('**/api/import/preview', async route => {
    previews++;
    if (previews === 1) await route.fulfill({ status: 500, json: { message: 'Vorschau vorübergehend nicht verfügbar' } });
    else await route.continue();
  });
  await analyze(page);
  await expect(dialog(page).getByRole('alert')).toContainText('Vorschau vorübergehend nicht verfügbar');
  await expect(dialog(page).getByRole('combobox', { name: 'Zielquelle', exact: true })).toHaveValue(target);
  await expect(preview(page)).toHaveCount(0);
  await expect(dialog(page).getByRole('button', { name: 'Import bestätigen', exact: true })).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  await expect(preview(page)).toBeVisible();
  expect(previews).toBe(2);
  expect(await getState(page)).toEqual(stable);
});

for (const operation of ['analyze', 'preview'] as const) {
  test(`discarding a pending embedded ${operation} on tab switch prevents late output in a newer import session`, async ({ page }) => {
    await page.goto('/');
    await seedSource(page, 'Langsame Importquelle');
    await page.reload();
    await openEmbedded(page, 'Langsame Importquelle');
    await enterFile(page, [activity('old', 'Veraltete Analyse')], 'alt.json');
    const gate = deferred();
    let waiting = false;
    let delivered = false;
    await page.route(`**/api/import/${operation}`, async route => {
      const response = await route.fetch();
      waiting = true;
      await gate.promise;
      await route.fulfill({ response });
      delivered = true;
    });
    const prompts = confirmations(page);
    try {
      await dialog(page).getByRole('button', { name: 'Datei prüfen', exact: true }).click();
      await expect.poll(() => waiting).toBe(true);
      await dialog(page).getByRole('tab', { name: 'Allgemein', exact: true }).click();
      expect(prompts.messages).toHaveLength(1);
      await expect(dialog(page).getByRole('tab', { name: 'Datenquellen', exact: true })).toHaveAttribute('aria-selected', 'true');
      prompts.accept();
      await dialog(page).getByRole('tab', { name: 'Allgemein', exact: true }).click();
      expect(prompts.messages).toHaveLength(2);
      await dialog(page).getByRole('tab', { name: 'Datenquellen', exact: true }).click();
      await expect(dialog(page).locator('.imp-file strong')).not.toHaveText('alt.json');
      await expect(dialog(page).getByRole('button', { name: 'Daten einfügen', exact: true })).toBeDisabled();
      await expect(dialog(page).locator('input[type=file]')).toBeDisabled();
      gate.release();
      await expect.poll(() => delivered).toBe(true);
      await expect(dialog(page).getByRole('button', { name: 'Daten einfügen', exact: true })).toBeEnabled();
      await enterPaste(page, json([activity('new', 'Neue Sitzung')]));
      await expect(preview(page)).toHaveCount(0);
      await expect(dialog(page).getByRole('heading', { name: 'Quellen zuordnen', exact: true })).toHaveCount(0);
      await expect(dialog(page).getByRole('textbox', { name: 'Daten einfügen', exact: true })).toHaveValue(json([activity('new', 'Neue Sitzung')]));
      await page.unroute(`**/api/import/${operation}`);
      await analyze(page, true);
      await expect(preview(page)).toContainText('Neue Sitzung');
      await expect(preview(page)).not.toContainText('Veraltete Analyse');
      expect((await getState(page)).activities).toEqual([]);
    } finally { gate.release(); }
  });
}

test('discarding a file read on Settings tab switch cannot replace a newer pasted draft', async ({ page }) => {
  await page.addInitScript(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== 'langsam.json') return original.call(this);
      const file = this;
      return new Promise<string>((resolve, reject) => {
        (window as unknown as { releaseImportFile: () => void }).releaseImportFile = () => { void original.call(file).then(resolve, reject); };
      });
    };
  });
  await page.goto('/');
  await seedSource(page, 'Datei wird gelesen');
  await page.reload();
  await openEmbedded(page, 'Datei wird gelesen');
  await dialog(page).locator('input[type=file]').setInputFiles({ name: 'langsam.json', mimeType: 'application/json', buffer: Buffer.from(json([activity('old', 'Alte Datei')])) });
  await expect(dialog(page).getByRole('status')).toContainText('Datei wird gelesen');
  const prompts = confirmations(page);
  prompts.accept();
  await dialog(page).getByRole('tab', { name: 'Allgemein', exact: true }).click();
  expect(prompts.messages).toHaveLength(1);
  await dialog(page).getByRole('tab', { name: 'Datenquellen', exact: true }).click();
  await enterPaste(page, json([activity('new', 'Neuer Text bleibt')]));
  await page.evaluate(() => (window as unknown as { releaseImportFile: () => void }).releaseImportFile());
  await expect(dialog(page).getByRole('textbox', { name: 'Daten einfügen', exact: true })).toHaveValue(json([activity('new', 'Neuer Text bleibt')]));
  await analyze(page, true);
  await expect(preview(page)).toContainText('Neuer Text bleibt');
  await expect(preview(page)).not.toContainText('Alte Datei');
  expect((await getState(page)).activities).toEqual([]);
});
