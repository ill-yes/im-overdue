import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect, getState } from './isolated-fixture';
import type { AppState } from '../../shared/types.js';

// A German browser still receives the explicitly English-first product default.
test.use({ appLanguage: null, locale: 'de-DE' });
const language = (page: Page) => page.getByLabel('Language / Sprache', { exact: true });
async function settings(page: Page) {
  await page.getByRole('button', { name: /^(Settings|Einstellungen)$/, exact: true }).click();
  await expect(language(page)).toBeVisible();
}
async function selectLanguage(page: Page, value: 'en' | 'de') {
  await language(page).selectOption(value);
  await expect(page.locator('html')).toHaveAttribute('lang', value);
}
async function mutate(page: Page, path: string, method: string, values: object): Promise<AppState> {
  const state = await getState(page);
  const response = await page.request.fetch(path, { method, headers: { Origin: new URL(page.url()).origin }, data: { ...values, expectedRevision: state.revision } });
  expect(response.status()).toBe(200);
  return response.json();
}

test('English is the first-run default and a persisted switch updates metadata and navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle("I'm Overdue – Your time account");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Your activities, working time and balance. Self-hosted and private.');
  const route = new URL(page.url()).hash;
  await settings(page);
  await selectLanguage(page, 'de');
  await expect(page.getByRole('dialog', { name: 'Einstellungen', exact: true })).toBeVisible();
  await expect(page).toHaveTitle("I'm Overdue – Dein Zeitkonto");
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe(route);
  expect(await page.evaluate(() => localStorage.getItem('im-overdue-language'))).toBe('de');
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
  await settings(page);
  await selectLanguage(page, 'en');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});

test('invalid saved language falls back to English', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('im-overdue-language', 'invalid-locale'));
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('blocked storage still allows an in-memory switch and retains an unsaved draft', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage disabled', 'SecurityError'); } }));
  await page.goto('/');
  await settings(page);
  await page.getByLabel('Find a time zone', { exact: true }).fill('UTC');
  await selectLanguage(page, 'de');
  await expect(page.getByLabel('Zeitzone suchen', { exact: true })).toHaveValue('UTC');
  await selectLanguage(page, 'en');
  await expect(page.getByLabel('Find a time zone', { exact: true })).toHaveValue('UTC');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await getState(page)).settings.timezone).toBe('Europe/Berlin');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('a visible server error retranslates while the settings draft and pending response stay intact', async ({ page }) => {
  await page.goto('/');
  const before = await getState(page);
  await settings(page);
  await page.getByLabel('Find a time zone', { exact: true }).fill('UTC');
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/settings', async route => {
    requests++;
    await held;
    await route.fulfill({ status: 400, json: { message: 'Ungueltige Zeitzone.', messageKey: 'error.validation.timezone' } });
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await selectLanguage(page, 'de');
  await expect(page.getByLabel('Zeitzone suchen', { exact: true })).toHaveValue('UTC');
  release();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Ungültige Zeitzone.');
  await selectLanguage(page, 'en');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Invalid time zone.');
  await expect(page.getByLabel('Find a time zone', { exact: true })).toHaveValue('UTC');
  expect(requests).toBe(1);
  expect(await getState(page)).toEqual(before);
});

test('English import errors and week review preserve the technical contract', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('button', { name: 'Paste data', exact: true }).click();
  await page.locator('textarea').fill(JSON.stringify({ schemaVersion: 1, activities: [{ source: 'slack', id: 'invalid-url', title: 'Untouched user text', start: '2026-09-28T08:00:00Z', url: 'javascript:alert(1)' }] }));
  await page.getByRole('button', { name: 'Check file', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Assign import sources', exact: true })).toContainText('Only HTTP/HTTPS URLs are allowed.');
  await expect(page.getByRole('button', { name: 'Check preview', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Confirm import', exact: true })).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect((await getState(page)).activities).toEqual([]);
  await page.getByLabel('Choose week by date', { exact: true }).fill('2026-09-28');
  await expect(page.locator('[data-calendar-day="2026-09-28"]')).toBeVisible();
  const before = await getState(page);
  await page.getByRole('button', { name: 'Close week', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Close week', exact: true });
  await expect(review).toContainText('Workday with a target but no recorded working time.');
  await review.getByRole('checkbox').check();
  let body: Record<string, unknown> | undefined;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/weeks/2026-09-28') body = request.postDataJSON(); });
  await review.getByRole('button', { name: 'Close week', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(body).toMatchObject({ expectedRevision: before.revision, confirmWarnings: true, status: 'closed' });
  expect(typeof body?.reviewKey).toBe('string');
  expect((await getState(page)).weeks.find(week => week.weekStart === '2026-09-28')?.status).toBe('closed');
});

for (const locale of ['en', 'de'] as const) {
  test(`print and CSV use ${locale} labels while preserving data, numbers and formula protection`, async ({ page }) => {
    const words = locale === 'en'
      ? { more: 'More calendar actions', sheet: 'Timesheet', dialog: 'Export timesheet', closed: 'Closed weeks only', preview: 'Export preview', title: 'Timesheet', print: 'PDF / Print' }
      : { more: 'Weitere Kalenderaktionen', sheet: 'Stundenzettel', dialog: 'Stundenzettel exportieren', closed: 'Nur abgeschlossene Wochen', preview: 'Exportvorschau', title: 'Arbeitszeitnachweis', print: 'PDF / Drucken' };
    await page.addInitScript(value => localStorage.setItem('im-overdue-language', value), locale);
    await page.addInitScript(() => { window.print = () => { (window as Window & { printed?: string }).printed = document.querySelector('.timesheet-print')?.textContent ?? ''; }; });
    await page.goto('/');
    await mutate(page, '/api/blocks', 'POST', { start: '2026-09-28T06:00:00Z', end: '2026-09-28T08:00:00Z', title: '=SUM(1;2)', note: 'User text bleibt gleich' });
    const before = await getState(page);
    await page.reload();
    await page.getByLabel(locale === 'en' ? 'Choose week by date' : 'Woche über Datum wählen', { exact: true }).fill('2026-09-28');
    await page.getByRole('button', { name: words.more, exact: true }).click();
    await page.getByRole('menuitem', { name: words.sheet, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: words.dialog, exact: true });
    await dialog.getByRole('checkbox', { name: words.closed, exact: true }).uncheck();
    const preview = dialog.getByRole('region', { name: words.preview, exact: true });
    await expect(preview).toHaveAttribute('aria-busy', 'false');
    await expect(preview.locator('.timesheet-document')).toContainText(words.title);
    await expect(preview).toContainText('=SUM(1;2)');
    await page.screenshot({ path: `output/i18n/timesheet-${locale}-preview.png` });
    const pendingDownload = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'CSV', exact: true }).click();
    const download = await pendingDownload;
    const path = await download.path();
    if (!path) throw new Error('Missing CSV');
    const bytes = await readFile(path);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = bytes.toString('utf8');
    expect(csv.split('\r\n')[0].replaceAll('"', '').replace(/^\uFEFF/, '')).toContain(locale === 'en' ? 'Name;Date;Status;Work (minutes);Leave (minutes);Target (minutes);Balance (minutes)' : 'Name;Datum;Status;Ist (Minuten);Urlaub (Minuten);Soll (Minuten);Saldo (Minuten)');
    expect(csv).toContain('2026-09-28');
    expect(csv).toContain(';120;0;480;-360;');
    expect(csv).toContain("'=SUM(1;2)");
    await dialog.getByRole('button', { name: words.print, exact: true }).click();
    expect(await page.evaluate(() => (window as Window & { printed?: string }).printed)).toBe(await preview.locator('.timesheet-document').textContent());
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.timesheet-print')).toBeVisible();
    await page.screenshot({ path: `output/i18n/timesheet-${locale}-print.png`, fullPage: true });
    expect(await getState(page)).toEqual(before);
  });
}

for (const locale of ['en', 'de'] as const) {
  test(`capture ${locale} calendar and settings at desktop and mobile sizes`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('im-overdue-language', value), locale);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto('/');
      await expect(page.locator('.calendar-workspace')).toBeVisible();
      await page.screenshot({ path: `output/i18n/main-${locale}-${width}.png` });
      const direct = page.getByRole('button', { name: locale === 'en' ? 'Settings' : 'Einstellungen', exact: true });
      if (await direct.isVisible()) await direct.click();
      else {
        await page.getByRole('button', { name: locale === 'en' ? 'App actions' : 'App-Aktionen', exact: true }).click();
        await page.getByRole('menuitem', { name: locale === 'en' ? 'Settings' : 'Einstellungen', exact: true }).click();
      }
      await expect(language(page)).toBeVisible();
      await page.screenshot({ path: `output/i18n/settings-${locale}-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
