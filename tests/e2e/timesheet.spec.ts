import type { APIResponse, Page, Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect, chooseWeek, getState } from './isolated-fixture';
import type { AppState } from '../../shared/types.js';

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Stundenzettel exportieren', exact: true });
const preview = (page: Page) => sheet(page).getByRole('region', { name: 'Exportvorschau', exact: true });
async function mutate(page: Page, path: string, method: string, values: object): Promise<AppState> {
  const before = await getState(page);
  const response = await page.request.fetch(path, { method, headers: { Origin: new URL(page.url()).origin }, data: { ...values, expectedRevision: before.revision } });
  expect(response.status()).toBe(200);
  return response.json();
}
async function openSheet(page: Page) {
  await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Stundenzettel', exact: true }).click();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('group', { name: 'Zeitraumart' }).getByRole('button', { name: 'Monat', exact: true }).click();
  // These legacy cases deliberately exercise open/untouched weeks. The HR
  // default is tested independently in timesheet-hr.spec.ts.
  await sheet(page).getByRole('checkbox', { name: 'Nur abgeschlossene Wochen', exact: true }).uncheck();
}
async function loaded(page: Page) {
  await expect(preview(page)).toHaveAttribute('aria-busy', 'false');
  await expect(preview(page).locator('.timesheet-document')).toBeVisible();
}
async function seed(page: Page) {
  await page.goto('/');
  await mutate(page, '/api/blocks', 'POST', { start: '2026-09-28T06:00:00Z', end: '2026-09-28T07:00:00Z', title: 'Konzeptarbeit', note: 'Vertrauliche Blocknotiz' });
  await mutate(page, '/api/blocks', 'POST', { start: '2026-09-28T08:00:00Z', end: '2026-09-28T09:00:00Z', title: 'Zweiter Block', note: 'Zweite private Notiz' });
  await mutate(page, '/api/notes/day/2026-09-28', 'PUT', { text: 'Vertrauliche Tagesnotiz' });
  await mutate(page, '/api/notes/week/2026-09-28', 'PUT', { text: 'Vertrauliche Wochennotiz' });
  await mutate(page, '/api/vacations', 'PUT', { days: [{ date: '2026-09-29', fraction: 1 }] });
  await page.reload();
  await chooseWeek(page, '2026-09-28');
}
async function csvDownload(page: Page): Promise<Buffer> {
  const download = page.waitForEvent('download');
  await sheet(page).getByRole('button', { name: 'CSV', exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error('Missing downloaded CSV');
  return readFile(path);
}
// Parse the download as a consumer, including quoted semicolons and embedded CRLFs.
function csvRows(bytes: Buffer): string[][] {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted;
    } else if (!quoted && char === ';') { row.push(field); field = ''; }
    else if (!quoted && char === '\r' && text[index + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; index++; }
    else field += char;
  }
  expect(quoted).toBe(false);
  return rows;
}

test('default exports include titles but protect all notes; option changes only affect the export', async ({ page }, testInfo) => {
  await seed(page);
  const before = await getState(page);
  let loads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/timesheet') { expect(request.method()).toBe('GET'); loads++; } });
  await openSheet(page);
  await loaded(page);
  await expect(sheet(page).getByRole('checkbox', { name: 'Tätigkeiten', exact: true })).toBeChecked();
  for (const label of ['Blocknotizen', 'Tagesnotizen', 'Wochennotizen']) await expect(sheet(page).getByRole('checkbox', { name: label, exact: true })).not.toBeChecked();
  await expect(preview(page)).toContainText('Konzeptarbeit');
  await expect(preview(page)).not.toContainText('Vertrauliche');
  await page.screenshot({ path: testInfo.outputPath('timesheet-preview-desktop.png') });
  const initial = (await csvDownload(page)).toString('utf8');
  expect(initial).toContain('Konzeptarbeit');
  expect(initial).not.toContain('Vertrauliche');
  const initialLoads = loads;
  for (const label of ['Blocknotizen', 'Tagesnotizen', 'Wochennotizen']) await sheet(page).getByRole('checkbox', { name: label, exact: true }).check();
  await expect(preview(page)).toContainText('Vertrauliche Blocknotiz');
  await expect(preview(page)).toContainText('Vertrauliche Tagesnotiz');
  await expect(preview(page)).toContainText('Vertrauliche Wochennotiz');
  await sheet(page).getByRole('checkbox', { name: 'Tätigkeiten', exact: true }).uncheck();
  await expect(preview(page)).not.toContainText('Konzeptarbeit');
  expect(loads).toBe(initialLoads);
  expect(await getState(page)).toEqual(before);
  await sheet(page).getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true })).toBeFocused();
});

test('CSV uses BOM and semicolon quoting, safe text cells, one numeric row per day and separate totals', async ({ page }) => {
  await seed(page);
  let state = await getState(page);
  const block = state.blocks[0];
  await mutate(page, `/api/blocks/${block.id}`, 'PUT', { ...block, title: ' \t=SUM(1;2)', note: 'Zitat "eins";\nzweite Zeile' });
  await mutate(page, '/api/notes/day/2026-09-28', 'PUT', { text: '\t@private' });
  await mutate(page, '/api/notes/week/2026-09-28', 'PUT', { text: '  -private' });
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  await openSheet(page);
  await loaded(page);
  await sheet(page).getByRole('group', { name: 'Zeitraumart' }).getByRole('button', { name: 'Woche', exact: true }).click();
  await loaded(page);
  await sheet(page).getByRole('textbox', { name: /Name/ }).fill(' +Name; "Test"');
  for (const label of ['Blocknotizen', 'Tagesnotizen', 'Wochennotizen']) await sheet(page).getByRole('checkbox', { name: label, exact: true }).check();
  state = await getState(page);
  const bytes = await csvDownload(page);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const rows = csvRows(bytes);
  expect(rows).toHaveLength(10);
  expect(rows[0]).toEqual(['Name', 'Datum', 'Status', 'Ist (Minuten)', 'Urlaub (Minuten)', 'Soll (Minuten)', 'Saldo (Minuten)', 'Arbeitszeiten', 'Titel', 'Blocknotizen', 'Tagesnotiz', 'Wochennotiz', 'Feiertag (Minuten)', 'Krankheit (Minuten)', 'Freizeitausgleich (Minuten)', 'Ungedeckt (Minuten)']);
  const monday = rows.find(row => row[1] === '2026-09-28')!;
  expect(monday[0]).toBe("' +Name; \"Test\"");
  expect(monday.slice(3, 7)).toEqual(['120', '0', '480', '-360']);
  expect(monday[8]).toContain("'=SUM(1;2)");
  expect(monday[9]).toContain('Zitat "eins";\r\nzweite Zeile');
  expect(monday[10]).toBe("'\t@private");
  expect(monday[11]).toBe("'  -private");
  expect(rows.find(row => row[1] === '2026-09-29')!.slice(3, 7)).toEqual(['0', '480', '480', '0']);
  expect(rows.slice(-2).map(row => row[1])).toEqual(['Summe bestätigt', 'Summe vorläufig']);
  expect(rows.at(-1)!.slice(3, 7)).toEqual(['120', '480', '2400', '-1800']);
  expect(await getState(page)).toEqual(state);
});

test('week, month and custom selections request exclusive bounds and closed-only keeps confirmed totals separate', async ({ page }) => {
  await seed(page);
  await mutate(page, '/api/weeks/2026-09-28', 'POST', { status: 'closed', confirmWarnings: true, confirmCurrent: true });
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  const ranges: string[][] = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/api/timesheet') ranges.push([url.searchParams.get('from')!, url.searchParams.get('to')!]); });
  await openSheet(page);
  await loaded(page);
  expect(ranges.at(-1)).toEqual(['2026-09-01', '2026-10-01']);
  await sheet(page).getByRole('group', { name: 'Zeitraumart' }).getByRole('button', { name: 'Woche', exact: true }).click();
  await loaded(page);
  expect(ranges.at(-1)).toEqual(['2026-09-28', '2026-10-05']);
  await sheet(page).getByRole('group', { name: 'Zeitraumart' }).getByRole('button', { name: 'Eigener Zeitraum', exact: true }).click();
  await sheet(page).getByLabel('Von', { exact: true }).fill('2026-09-28');
  await sheet(page).getByLabel('Bis einschließlich', { exact: true }).fill('2026-10-05');
  await loaded(page);
  expect(ranges.at(-1)).toEqual(['2026-09-28', '2026-10-06']);
  await sheet(page).getByRole('checkbox', { name: 'Nur abgeschlossene Wochen', exact: true }).check();
  const rows = csvRows(await csvDownload(page));
  expect(rows).toHaveLength(10);
  expect(rows.slice(1, 8).every(row => row[2] === 'Bestätigt')).toBe(true);
  expect(rows.at(-2)!.slice(3, 7)).toEqual(['120', '480', '2400', '-1800']);
  expect(rows.at(-1)!.slice(3, 7)).toEqual(['0', '0', '0', '0']);
  await sheet(page).getByLabel('Bis einschließlich', { exact: true }).fill('2026-09-27');
  await expect(sheet(page).getByRole('button', { name: 'CSV', exact: true })).toBeDisabled();
  await expect(preview(page).locator('.timesheet-document')).toHaveCount(0);
});

test('preview, CSV and mocked print stay on one snapshot after concurrent work changes', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { printedTimesheet?: string }).printedTimesheet = '';
    window.print = () => { (window as Window & { printedTimesheet?: string }).printedTimesheet = document.querySelector('.timesheet-print')?.textContent ?? ''; };
  });
  await seed(page);
  await openSheet(page);
  await loaded(page);
  const previewText = await preview(page).locator('.timesheet-document').textContent();
  const block = (await getState(page)).blocks[0];
  const newer = await mutate(page, `/api/blocks/${block.id}`, 'PUT', { ...block, title: 'Nachträgliche Änderung', end: '2026-09-28T07:30:00Z' });
  const bytes = await csvDownload(page);
  expect(bytes.toString('utf8')).toContain('Konzeptarbeit');
  expect(bytes.toString('utf8')).not.toContain('Nachträgliche Änderung');
  expect(csvRows(bytes).find(row => row[1] === '2026-09-28')![3]).toBe('120');
  await sheet(page).getByRole('button', { name: 'PDF / Drucken', exact: true }).click();
  expect(await page.evaluate(() => (window as Window & { printedTimesheet?: string }).printedTimesheet)).toBe(previewText);
  expect(await preview(page).locator('.timesheet-document').textContent()).toBe(previewText);
  expect(await getState(page)).toEqual(newer);
});

for (const result of ['success', 'failure'] as const) {
  test(`late ${result} of an older range cannot replace the current preview or re-enable the wrong export`, async ({ page }) => {
    await seed(page);
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let oldFinished = () => {};
    const settled = new Promise<void>(resolve => { oldFinished = resolve; });
    let firstReceived = false;
    await page.route('**/api/timesheet?*', async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('from') === '2026-09-01') {
        firstReceived = true;
        await held;
        if (result === 'failure') await route.fulfill({ status: 503, json: { message: 'Alter Exportfehler' } });
        else await route.fulfill({ response: await route.fetch() });
        oldFinished();
      } else await route.fulfill({ response: await route.fetch() });
    });
    try {
      await openSheet(page);
      await expect.poll(() => firstReceived).toBe(true);
      await expect(sheet(page).getByRole('button', { name: 'CSV', exact: true })).toBeDisabled();
      await sheet(page).getByRole('group', { name: 'Zeitraumart' }).getByRole('button', { name: 'Woche', exact: true }).click();
      await loaded(page);
      const currentText = await preview(page).textContent();
      release();
      await settled;
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect((await csvDownload(page)).toString('utf8')).toContain('2026-10-04');
      expect(await preview(page).textContent()).toBe(currentText);
      await expect(sheet(page).getByRole('alert')).toHaveCount(0);
      expect(csvRows(await csvDownload(page))).toHaveLength(10);
    } finally { release(); }
  });
}

for (const order of ['original-first', 'latest-first'] as const) {
  test(`A to B to A range changes use the newest snapshot when responses arrive ${order}`, async ({ page }) => {
    await seed(page);
    const held: { route: Route; response: APIResponse }[] = [];
    await page.route('**/api/timesheet?*', async route => {
      if (new URL(route.request().url()).searchParams.get('from') === '2026-09-01') {
        held.push({ route, response: await route.fetch() });
      } else await route.fulfill({ response: await route.fetch() });
    });
    const settle = async (entry: typeof held[number]) => {
      const response = entry.route.request().response();
      await entry.route.fulfill({ response: entry.response });
      await (await response)?.finished();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    };
    await openSheet(page);
    await expect.poll(() => held.length).toBe(1);
    await sheet(page).getByRole('group', { name: 'Zeitraumart' }).getByRole('button', { name: 'Woche', exact: true }).click();
    await loaded(page);
    const block = (await getState(page)).blocks[0];
    await mutate(page, `/api/blocks/${block.id}`, 'PUT', { ...block, title: 'Aktueller Monatsstand' });
    await sheet(page).getByRole('group', { name: 'Zeitraumart' }).getByRole('button', { name: 'Monat', exact: true }).click();
    await expect.poll(() => held.length).toBe(2);
    await expect(sheet(page).getByRole('button', { name: 'CSV', exact: true })).toBeDisabled();
    if (order === 'original-first') {
      await settle(held[0]);
      await expect(preview(page).locator('.timesheet-document')).toHaveCount(0);
      await expect(sheet(page).getByRole('button', { name: 'CSV', exact: true })).toBeDisabled();
      await settle(held[1]);
    } else {
      await settle(held[1]);
      await loaded(page);
      await expect(preview(page)).toContainText('Aktueller Monatsstand');
      await settle(held[0]);
    }
    await loaded(page);
    await expect(preview(page)).toContainText('Aktueller Monatsstand');
    await expect(preview(page)).not.toContainText('Konzeptarbeit');
    const csv = (await csvDownload(page)).toString('utf8');
    expect(csv).toContain('Aktueller Monatsstand');
    expect(csv).not.toContain('Konzeptarbeit');
    expect(csvRows(Buffer.from(csv, 'utf8'))).toHaveLength(33);
  });
}

test('390px export scrolls internally and print media exposes the complete table', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await openSheet(page);
  await loaded(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await preview(page).locator('.timesheet-table-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(sheet(page).getByRole('button', { name: 'CSV', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('timesheet-mobile.png') });
  await page.screenshot({ path: testInfo.outputPath('timesheet-mobile-viewport.png') });
  await page.emulateMedia({ media: 'print' });
  const print = page.locator('.timesheet-print');
  await expect(print).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(255, 255, 255)');
  await expect(page.locator('#root')).toBeHidden();
  expect(await print.locator('thead').evaluate(element => getComputedStyle(element).display)).toBe('table-header-group');
  expect(await print.locator('tbody tr').first().evaluate(element => getComputedStyle(element).breakInside)).toBe('avoid');
  expect(await print.locator('.timesheet-table-scroll').evaluate(element => getComputedStyle(element).overflowX)).toBe('visible');
  await page.screenshot({ path: testInfo.outputPath('timesheet-print-media.png') });
  const pdf = await page.pdf({ path: testInfo.outputPath('timesheet-print.pdf'), preferCSSPageSize: true, printBackground: true });
  expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
  await page.emulateMedia({ media: 'screen' });
  await expect(print).toBeHidden();
});
