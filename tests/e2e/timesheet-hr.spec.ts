import type { Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { parse } from 'csv-parse/sync';
import { test, expect, chooseWeek, getState } from './isolated-fixture';
import { datesInRange, Temporal } from '../../shared/time.js';
import type { AppState } from '../../shared/types.js';

const run = promisify(execFile);
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Stundenzettel exportieren', exact: true });
const preview = (page: Page) => dialog(page).getByRole('region', { name: 'Exportvorschau', exact: true });
const report = (page: Page) => preview(page).locator('.timesheet-document');
const closedOnly = (page: Page) => dialog(page).getByRole('checkbox', { name: 'Nur abgeschlossene Wochen', exact: true });
async function mutate(page: Page, path: string, method: string, values: object): Promise<AppState> {
  const before = await getState(page);
  const response = await page.request.fetch(path, { method, headers: { Origin: new URL(page.url()).origin }, data: { ...values, expectedRevision: before.revision } });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function open(page: Page, date: string) {
  await page.reload();
  await chooseWeek(page, date);
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Zeitkonto', exact: true }).click();
  await page.getByRole('region', { name: 'Zeitkonto', exact: true }).getByRole('button', { name: 'Stundenzettel', exact: true }).click();
  await loaded(page);
}
async function loaded(page: Page) {
  await expect(preview(page)).toHaveAttribute('aria-busy', 'false');
  await expect(report(page)).toBeVisible();
}
async function range(page: Page, from: string, through: string) {
  await dialog(page).getByRole('group', { name: 'Zeitraumart' }).getByRole('button', { name: 'Eigener Zeitraum', exact: true }).click();
  await dialog(page).getByLabel('Von', { exact: true }).fill(from);
  await dialog(page).getByLabel('Bis einschließlich', { exact: true }).fill(through);
  await loaded(page);
}
async function csv(page: Page): Promise<Record<string, string>[]> {
  const downloaded = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'CSV', exact: true }).click();
  const path = await (await downloaded).path();
  if (!path) throw new Error('Missing HR CSV');
  const bytes = await readFile(path);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return parse(bytes, { bom: true, columns: true, delimiter: ';' });
}
function local(date: string, time: string) {
  return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime('Europe/Berlin').toInstant().toString();
}
async function close(page: Page, week: string) {
  // Explicit API confirmations exercise the real backend rather than mocking
  // status labels or directly manufacturing a confirmed snapshot.
  await mutate(page, `/api/weeks/${week}`, 'POST', { status: 'closed', confirmWarnings: true, confirmCurrent: true });
}
function pdfPages(bytes: Buffer) {
  return (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
}
function expectA4Portrait(bytes: Buffer) {
  const media = [...bytes.toString('latin1').matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  expect(media.length).toBeGreaterThan(0);
  for (const box of media) {
    expect(Number(box[3]) - Number(box[1])).toBeCloseTo(595, 0);
    expect(Number(box[4]) - Number(box[2])).toBeCloseTo(842, 0);
  }
}
async function pdfText(path: string) {
  // Optional external inspection adds no npm dependency. The actual PDF,
  // dimensions and DOM assertions remain mandatory when Poppler is unavailable.
  try {
    return (await run('pdftotext', ['-layout', path, '-'], { maxBuffer: 8 * 1024 * 1024 })).stdout;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
function normalize(value: string) { return value.replace(/\s+/g, ' ').trim(); }

test('HR defaults filter open days globally, disable empty exports and restore an honest provisional preview', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/blocks', 'POST', { start: local('2026-03-02', '08:00'), end: local('2026-03-02', '09:00'), title: 'Noch offen', note: '' });
  await open(page, '2026-03-02');
  await expect(closedOnly(page)).toBeChecked();
  await expect(dialog(page).getByRole('button', { name: 'CSV', exact: true })).toBeDisabled();
  await expect(dialog(page).getByRole('button', { name: 'PDF / Drucken', exact: true })).toBeDisabled();
  await expect(preview(page)).toContainText(/Keine abgeschlossenen Wochen/);
  await expect(dialog(page)).toContainText('31 nicht abgeschlossene Tage ausgeblendet');
  await expect(preview(page)).not.toContainText('Noch offen');
  await closedOnly(page).uncheck();
  await expect(dialog(page).getByRole('button', { name: 'CSV', exact: true })).toBeEnabled();
  await expect(dialog(page).getByRole('button', { name: 'PDF / Drucken', exact: true })).toBeEnabled();
  await expect(preview(page)).toContainText('Noch offen');
  await expect(report(page).locator('tfoot')).toContainText('Summe vorläufig');
  await expect(report(page).locator('tfoot')).not.toContainText('Summe bestätigt');
  const untouched = report(page).locator('tbody tr').filter({ hasText: /So\.?\s*01\.03/ });
  await expect(untouched).toHaveCount(1);
  // Untouched days are not falsely reported as a confirmed zero balance.
  await expect(untouched.locator('td').last()).toHaveText('');
  const rows = await csv(page);
  expect(rows).toHaveLength(33);
  expect(rows.find(row => row.Datum === '2026-03-01')?.['Saldo (Minuten)']).toBe('');
  expect(rows.at(-2)?.Datum).toBe('Summe bestätigt');
  expect(rows.at(-1)?.Datum).toBe('Summe vorläufig');
});

test('partial custom periods count excluded calendar days and share the same confirmed rows across preview CSV and print', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => { (window as Window & { printedHr?: string }).printedHr = document.querySelector('.timesheet-print')?.textContent ?? ''; };
  });
  await page.goto('/');
  await mutate(page, '/api/blocks', 'POST', { start: local('2026-03-02', '08:00'), end: local('2026-03-02', '09:00'), title: 'Bestätigter Teil', note: '' });
  await mutate(page, '/api/blocks', 'POST', { start: local('2026-03-09', '08:00'), end: local('2026-03-09', '09:00'), title: 'Offener Teil', note: '' });
  await close(page, '2026-03-02');
  await open(page, '2026-03-02');
  await range(page, '2026-03-04', '2026-03-10');
  const before = await getState(page);
  await expect(dialog(page)).toContainText('2 nicht abgeschlossene Tage ausgeblendet');
  await expect(report(page).locator('tbody tr')).toHaveCount(5);
  await expect(report(page).locator('tfoot th')).toHaveText(['Gesamt']);
  await expect(report(page).locator('tfoot')).not.toContainText('Summe vorläufig');
  await expect(preview(page)).not.toContainText('Offener Teil');
  const rows = await csv(page);
  expect(rows.slice(0, -2).map(row => row.Datum)).toEqual(['2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']);
  expect(rows.slice(0, -2).every(row => row.Status === 'Bestätigt')).toBe(true);
  expect(rows.at(-2)?.['Soll (Minuten)']).toBe('1440');
  expect(rows.at(-1)?.['Soll (Minuten)']).toBe('0');
  await dialog(page).getByRole('button', { name: 'PDF / Drucken', exact: true }).click();
  expect(await page.evaluate(() => (window as Window & { printedHr?: string }).printedHr)).toBe(await report(page).textContent());
  expect(await getState(page)).toEqual(before);
});

test('closed March reference is a complete compact one-page A4 HR document at desktop and mobile sizes', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.goto('/');
  await mutate(page, '/api/profiles', 'POST', { effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] });
  await mutate(page, '/api/vacations', 'PUT', { days: [{ date: '2026-03-10', fraction: 1 }, { date: '2026-03-19', fraction: 0.5 }] });
  for (const date of datesInRange('2026-03-01', '2026-04-01')) {
    if (Temporal.PlainDate.from(date).dayOfWeek > 5 || date === '2026-03-10') continue;
    await mutate(page, '/api/blocks', 'POST', { start: local(date, '08:00'), end: local(date, '12:00'), title: 'Projektarbeit', note: '' });
    if (date !== '2026-03-19') await mutate(page, '/api/blocks', 'POST', { start: local(date, '13:00'), end: local(date, '17:00'), title: 'Abstimmung', note: '' });
  }
  for (const week of ['2026-02-23', '2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']) await close(page, week);
  const before = await getState(page);
  await open(page, '2026-03-02');
  await dialog(page).getByRole('textbox', { name: /Name/ }).fill('Example Person');
  await expect(report(page).getByRole('heading', { name: 'Arbeitszeitnachweis', exact: true })).toBeVisible();
  await expect(report(page).locator('thead th')).toHaveText(['Datum', 'Arbeitszeiten / Tätigkeit', 'Arbeit', 'Urlaub', 'Soll', 'Saldo']);
  await expect(report(page).locator('tbody tr')).toHaveCount(31);
  await expect(report(page).locator('.timesheet-document-header')).toContainText('01.03.2026');
  await expect(report(page).locator('.timesheet-document-header')).toContainText('31.03.2026');
  await expect(report(page)).not.toContainText('Datenstand');
  await expect(report(page)).not.toContainText('Summe vorläufig');
  await expect(report(page).locator('tfoot')).toContainText('164:00');
  await expect(report(page).locator('tfoot')).toContainText('12:00');
  await expect(report(page).locator('tfoot')).toContainText('176:00');
  const monday = report(page).locator('tbody tr').filter({ hasText: /Mo\.?\s*02\.03/ });
  await expect(monday).toHaveCount(1);
  await expect(monday).toContainText('08:00');
  await expect(monday).toContainText('Projektarbeit');
  await expect(monday).not.toContainText(/\+0[12]:00/);
  const dateCell = monday.locator('th').first();
  expect(await dateCell.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(55);
  await page.screenshot({ path: testInfo.outputPath('hr-month-desktop-1440.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(dialog(page).getByRole('button', { name: 'CSV', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('hr-month-mobile-390.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ media: 'print' });
  const print = page.locator('.timesheet-print');
  await expect(print).toBeVisible();
  expect(await print.locator('thead').evaluate(element => getComputedStyle(element).display)).toBe('table-header-group');
  const minimumFont = await print.locator('tbody td, tbody th').evaluateAll(elements => Math.min(...elements.map(element => parseFloat(getComputedStyle(element).fontSize))));
  expect(minimumFont).toBeGreaterThanOrEqual(12); // 9pt at 96 CSS px/in.
  const pdfPath = testInfo.outputPath('hr-month-march-2026-a4.pdf');
  const bytes = await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
  expect(pdfPages(bytes)).toBe(1);
  expectA4Portrait(bytes);
  const text = await pdfText(pdfPath);
  if (text !== undefined) {
    const flat = normalize(text);
    for (const expected of ['Arbeitszeitnachweis', 'Example Person', '01.03.2026', '31.03.2026', 'Projektarbeit', 'Abstimmung', '164:00', '176:00', 'Europe/Berlin']) expect(flat).toContain(expected);
    for (let day = 1; day <= 31; day++) expect(flat).toContain(`${String(day).padStart(2, '0')}.03`);
    expect((text.match(/Projektarbeit/g) ?? []).length).toBe(21);
    expect((text.match(/Abstimmung/g) ?? []).length).toBe(20);
  }
  expect(await getState(page)).toEqual(before);
});

test('a 31-day month with 23 full workdays and two activities per day also fits one A4 page', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.goto('/');
  for (const date of datesInRange('2026-07-01', '2026-08-01')) {
    if (Temporal.PlainDate.from(date).dayOfWeek > 5) continue;
    await mutate(page, '/api/blocks', 'POST', { start: local(date, '08:00'), end: local(date, '12:00'), title: 'Projektarbeit', note: '' });
    await mutate(page, '/api/blocks', 'POST', { start: local(date, '13:00'), end: local(date, '17:00'), title: 'Abstimmung', note: '' });
  }
  for (const week of ['2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']) await close(page, week);
  await open(page, '2026-07-01');
  await dialog(page).getByRole('textbox', { name: /Name/ }).fill('Example Person');
  await expect(report(page).locator('tbody tr')).toHaveCount(31);
  await expect(report(page).locator('tfoot')).toContainText('184:00');
  await page.emulateMedia({ media: 'print' });
  const path = testInfo.outputPath('hr-month-july-2026-23-workdays-a4.pdf');
  const bytes = await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
  expect(pdfPages(bytes)).toBe(1);
  expectA4Portrait(bytes);
  const text = await pdfText(path);
  if (text !== undefined) {
    expect((text.match(/Projektarbeit/g) ?? []).length).toBe(23);
    expect((text.match(/Abstimmung/g) ?? []).length).toBe(23);
    expect(text).toContain('184:00');
    for (let day = 1; day <= 31; day++) expect(text).toContain(`${String(day).padStart(2, '0')}.07`);
  }
});

test('selected long notes and long activities flow completely through multiple PDF pages with repeating headers', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.goto('/');
  const notes: string[] = [];
  const titles: string[] = [];
  for (const [dayIndex, date] of ['2026-03-02', '2026-03-03', '2026-03-04'].entries()) {
    const words = Array.from({ length: 455 }, (_, index) => `N${dayIndex}_${String(index).padStart(4, '0')}_abc`);
    const endMarker = ` DAY_END_${date}`;
    const note = words.join(' ').slice(0, 5000 - endMarker.length) + endMarker;
    expect(note).toHaveLength(5000); // The real day-note API's maximum.
    notes.push(note);
    await mutate(page, `/api/notes/day/${date}`, 'PUT', { text: note });
    for (let block = 0; block < 8; block++) {
      const title = `Tätigkeit ${dayIndex}-${block} ${'vollständig sichtbarer Projektname '.repeat(3)}TITLE_END_${dayIndex}_${block}`;
      titles.push(title);
      await mutate(page, '/api/blocks', 'POST', { start: local(date, `${String(8 + block).padStart(2, '0')}:00`), end: local(date, `${String(8 + block).padStart(2, '0')}:30`), title, note: `BLOCK_NOTE_END_${dayIndex}_${block}` });
    }
  }
  await mutate(page, '/api/notes/week/2026-03-02', 'PUT', { text: 'WEEK_NOTE_BEGIN vollständige Wochennotiz WEEK_NOTE_END' });
  await close(page, '2026-03-02');
  await open(page, '2026-03-02');
  await range(page, '2026-03-02', '2026-03-04');
  for (const label of ['Blocknotizen', 'Tagesnotizen', 'Wochennotizen']) await dialog(page).getByRole('checkbox', { name: label, exact: true }).check();
  for (const note of notes) await expect(report(page)).toContainText(note);
  for (const title of titles) await expect(report(page)).toContainText(title);
  await page.emulateMedia({ media: 'print' });
  const pdfPath = testInfo.outputPath('hr-long-notes-multipage-a4.pdf');
  const bytes = await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
  expect(pdfPages(bytes)).toBeGreaterThan(1);
  expectA4Portrait(bytes);
  const text = await pdfText(pdfPath);
  if (text !== undefined) {
    const flat = normalize(text);
    for (const note of notes) for (const word of note.split(' ')) expect(flat).toContain(word);
    // Layout extraction can interleave neighboring numeric cells on the first
    // visual line; every title token including its unique final marker survives.
    for (const title of titles) for (const word of title.split(' ')) expect(flat).toContain(word);
    for (let day = 0; day < 3; day++) for (let block = 0; block < 8; block++) expect(flat).toContain(`BLOCK_NOTE_END_${day}_${block}`);
    expect(flat).toContain('WEEK_NOTE_END');
    const pages = text.split('\f').filter(value => value.trim());
    expect(pages).toHaveLength(pdfPages(bytes));
    for (const content of pages) expect(content).toMatch(/Datum\s+Arbeitszeiten/);
  }
});

test('DST fold offsets and midnight endpoints remain unambiguous and profile remainder minutes stay exact', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/profiles', 'POST', { effectiveFrom: null, weeklyMinutes: 1, workdays: [1, 2] });
  await mutate(page, '/api/blocks', 'POST', { start: '2025-10-20T06:00:00Z', end: '2025-10-20T06:01:00Z', title: 'Eine Minute', note: '' });
  await mutate(page, '/api/blocks', 'POST', { start: '2025-10-26T00:30:00Z', end: '2025-10-26T01:30:00Z', title: 'Zeitumstellung', note: '' });
  await mutate(page, '/api/blocks', 'POST', { start: '2025-10-26T22:30:00Z', end: '2025-10-26T23:00:00Z', title: 'Mitternacht', note: '' });
  await close(page, '2025-10-20');
  await open(page, '2025-10-20');
  await range(page, '2025-10-20', '2025-10-26');
  const minute = report(page).locator('tbody tr').filter({ hasText: 'Eine Minute' });
  await expect(minute.locator('td')).toHaveText(['08:00-08:01Eine Minute', '0:01', '0:00', '0:01', '0:00']);
  await expect(minute).not.toContainText('+02:00');
  const fold = report(page).locator('tbody tr').filter({ hasText: 'Zeitumstellung' });
  await expect(fold).toContainText('02:30 +02:00');
  await expect(fold).toContainText('02:30 +01:00');
  await expect(fold).toContainText('24:00');
  const rows = await csv(page);
  const monday = rows.find(row => row.Datum === '2025-10-20');
  expect(monday?.['Ist (Minuten)']).toBe('1');
  expect(monday?.['Soll (Minuten)']).toBe('1');
  expect(rows.find(row => row.Datum === '2025-10-21')?.['Soll (Minuten)']).toBe('0');
  expect(rows.find(row => row.Datum === '2025-10-26')?.Arbeitszeiten).toContain('24:00 +01:00');
});
