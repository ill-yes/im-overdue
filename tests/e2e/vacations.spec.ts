import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { test, expect, chooseWeek, getState, newBlock } from './isolated-fixture';
import type { AppState } from '../../shared/types.js';

const vacation = (page: Page) => page.getByRole('dialog', { name: 'Abwesenheiten', exact: true });
const day = (page: Page, date: string) => page.locator(`[data-calendar-day="${date}"]`);

async function mutate(page: Page, path: string, method: string, values: object): Promise<AppState> {
  const before = await getState(page);
  const response = await page.request.fetch(path, { method, headers: { Origin: new URL(page.url()).origin }, data: { ...values, expectedRevision: before.revision } });
  expect(response.status()).toBe(200);
  return response.json();
}
async function openVacation(page: Page, from: string, to = from) {
  await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Abwesenheiten', exact: true }).click();
  await vacation(page).getByLabel('Von', { exact: true }).fill(from);
  await vacation(page).getByLabel('Bis einschließlich', { exact: true }).fill(to);
  await applyVacation(page, '1');
  return vacation(page);
}
async function applyVacation(page: Page, fraction: '0.5' | '1') {
  await vacation(page).locator('.absence-bulk').getByRole('combobox', { name: 'Urlaub', exact: true }).selectOption(fraction);
}
async function saveVacation(page: Page) {
  await vacation(page).getByRole('button', { name: 'Abwesenheiten speichern', exact: true }).click();
  await expect(vacation(page)).toHaveCount(0);
}
async function closeWeek(page: Page) {
  await page.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Woche abschließen', exact: true });
  await expect(review).toBeVisible();
  await expect(review.locator('form')).toHaveAttribute('aria-busy', 'false');
  for (const checkbox of await review.getByRole('checkbox').all()) await checkbox.check();
  await review.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect(review).toHaveCount(0);
}

test('vacation preview skips non-workdays and lets a holiday and individual half-day be selected explicitly', async ({ page }, testInfo) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await mutate(page, '/api/holiday-overrides/2026-10-01', 'PUT', { name: 'Prüffeiertag' });
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  const before = await getState(page);
  const dialog = await openVacation(page, '2026-09-28', '2026-10-04');
  await expect(dialog.locator('.absence-bulk').getByRole('combobox', { name: 'Urlaub', exact: true })).toHaveValue('1');
  await expect(dialog.locator('.absence-day-label input[type=checkbox]')).toHaveCount(7);
  await expect(dialog.locator('.absence-day-label input[type=checkbox]').nth(5)).toBeDisabled();
  await expect(dialog.locator('.absence-day-label input[type=checkbox]').nth(6)).toBeDisabled();
  await expect(dialog).toContainText('Prüffeiertag: Feiertagsgutschrift gilt');
  await dialog.getByRole('checkbox', { name: /Donnerstag, 1. Oktober 2026/ }).uncheck();
  await dialog.getByRole('combobox', { name: 'Urlaub Dienstag, 29. September 2026', exact: true }).selectOption('0.5');
  expect(await getState(page)).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('vacation-preview-mobile.png') });
  await page.screenshot({ path: testInfo.outputPath('vacation-preview-mobile-viewport.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await saveVacation(page);
  const saved = await getState(page);
  expect(saved.vacations).toEqual([
    { date: '2026-09-28', fraction: 1 }, { date: '2026-09-29', fraction: 0.5 },
    { date: '2026-09-30', fraction: 1 }, { date: '2026-10-02', fraction: 1 },
  ]);
  expect(saved.blocks).toEqual(before.blocks);
  expect(saved.activities).toEqual(before.activities);
  await expect(day(page, '2026-09-29')).toContainText('½ Urlaub');
  await page.reload();
  expect((await getState(page)).vacations).toEqual(saved.vacations);
});

test('full vacation credits the target while real work stays additional; half-days use the part-time target', async ({ page }, testInfo) => {
  await page.goto('/');
  await mutate(page, '/api/profiles', 'POST', { effectiveFrom: null, weeklyMinutes: 1200, workdays: [1, 2, 3, 4, 5] });
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  await newBlock(page, '2026-09-28', '08:00', '09:00', 'Arbeit trotz Urlaub');
  await newBlock(page, '2026-09-28', '10:00', '11:00', 'Zweiter Block trotz Urlaub');
  const blocks = (await getState(page)).blocks;
  const full = await openVacation(page, '2026-09-28');
  await expect(full.locator('.absence-day-label')).toContainText('Soll 4 h · Arbeit 2 h');
  await expect(full.locator('.absence-calculation > div').filter({ hasText: /^Urlaub/ })).toContainText('4 h');
  await expect(full.locator('.absence-calculation > div').filter({ hasText: /^Tagessaldo/ })).toContainText('+2 h');
  await saveVacation(page);
  await expect(day(page, '2026-09-28').locator('.ov-day-totals')).toContainText('Arbeit 2:00 h');
  await expect(day(page, '2026-09-28').locator('[data-absence-kind=vacation]')).toContainText('4 h Gutschrift');
  const half = await openVacation(page, '2026-09-29');
  await applyVacation(page, '0.5');
  await expect(half.locator('.absence-calculation > div').filter({ hasText: /^Urlaub/ })).toContainText('2 h');
  await saveVacation(page);
  expect((await getState(page)).blocks).toEqual(blocks);
  await page.screenshot({ path: testInfo.outputPath('vacation-gap-desktop.png') });
  await page.getByRole('group', { name: 'Kalenderansicht' }).getByRole('button', { name: 'Monat', exact: true }).click();
  await page.getByLabel('Monat wählen', { exact: true }).fill('2026-09');
  await expect(page.locator('[data-month-day="2026-09-28"] .mo-day-balance strong')).toHaveText('+2 h');
});

test('editing a badge can refuse reopening, then undo restores vacation and closure through backup restore', async ({ page, localApp }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await openVacation(page, '2026-09-28');
  await saveVacation(page);
  await closeWeek(page);
  const before = await getState(page);
  await day(page, '2026-09-28').getByRole('button', { name: 'Aktionen für Montag, 28. September 2026', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Abwesenheiten am 28.09.2026', exact: true }).click();
  await vacation(page).getByRole('combobox', { name: 'Urlaub Montag, 28. September 2026', exact: true }).selectOption('0.5');
  const refuse = async (prompt: import('@playwright/test').Dialog) => { if (/ersetzen/.test(prompt.message())) await prompt.accept(); else await prompt.dismiss(); };
  page.on('dialog', refuse);
  await vacation(page).getByRole('button', { name: 'Abwesenheiten speichern', exact: true }).click();
  await expect(vacation(page).getByRole('button', { name: 'Abwesenheiten speichern', exact: true })).toBeEnabled();
  expect(await getState(page)).toEqual(before);
  page.off('dialog', refuse);
  page.on('dialog', prompt => prompt.accept());
  await saveVacation(page);
  expect((await getState(page)).weeks.find(week => week.weekStart === '2026-09-28')?.status).toBe('open');
  await page.getByRole('button', { name: /Rückgängig/ }).click();
  await expect.poll(async () => (await getState(page)).vacations).toEqual(before.vacations);
  expect((await getState(page)).weeks).toEqual(before.weeks);
  const restored = await getState(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'SQLite-Backup herunterladen' }).click();
  const path = join(localApp.directory, 'vacation-restore.sqlite');
  await (await download).saveAs(path);
  await localApp.restart(path);
  await page.goto(localApp.url);
  expect(await getState(page)).toEqual(restored);
});

test('a stale vacation submission retains its selection and cannot overwrite a concurrent write', async ({ page }) => {
  await page.goto('/');
  const dialog = await openVacation(page, '2026-09-28', '2026-09-29');
  await applyVacation(page, '0.5');
  const concurrent = await mutate(page, '/api/templates', 'POST', { title: 'Zweiter Tab', note: '', durationMinutes: 15 });
  await dialog.getByRole('button', { name: 'Abwesenheiten speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('zwischenzeitlich geändert');
  await expect(dialog.getByLabel('Von', { exact: true })).toHaveValue('2026-09-28');
  await expect(dialog.locator('.absence-bulk').getByRole('combobox', { name: 'Urlaub', exact: true })).toHaveValue('0.5');
  await expect(dialog.getByRole('combobox', { name: 'Urlaub Montag, 28. September 2026', exact: true })).toHaveValue('0.5');
  await expect(dialog.getByRole('combobox', { name: 'Urlaub Dienstag, 29. September 2026', exact: true })).toHaveValue('0.5');
  expect((await getState(page)).vacations).toEqual([]);
  expect((await getState(page)).templates).toEqual(concurrent.templates);
});

test('pending vacation saves lock closing and repeat submits; a failed response retains the draft', async ({ page }) => {
  await page.goto('/');
  const dialog = await openVacation(page, '2026-09-28');
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  await page.route('**/api/absences', async route => {
    writes++;
    await held;
    await route.fulfill({ status: 503, json: { message: 'Urlaubsspeicherung fehlgeschlagen' } });
  });
  const before = await getState(page);
  try {
    await dialog.getByRole('button', { name: 'Abwesenheiten speichern', exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Dialog schließen', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.locator('.modal-backdrop').dispatchEvent('mousedown');
    await dialog.locator('form').dispatchEvent('submit');
    expect(writes).toBe(1);
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog.getByRole('alert')).toContainText('Urlaubsspeicherung fehlgeschlagen');
    await expect(dialog.getByLabel('Von', { exact: true })).toHaveValue('2026-09-28');
    expect(await getState(page)).toEqual(before);
  } finally { release(); }
});

test('future vacation spanning a year boundary remains planning without future time debt', async ({ page }) => {
  await page.goto('/');
  const dialog = await openVacation(page, '2028-12-29', '2029-01-01');
  await expect(dialog.locator('.absence-day-label input[type=checkbox]')).toHaveCount(4);
  await saveVacation(page);
  expect((await getState(page)).vacations).toEqual([{ date: '2028-12-29', fraction: 1 }, { date: '2029-01-01', fraction: 1 }]);
  expect((await getState(page)).weeks).toEqual([]);
  await page.getByRole('group', { name: 'Kalenderansicht' }).getByRole('button', { name: 'Monat', exact: true }).click();
  for (const [month, date] of [['2028-12', '2028-12-29'], ['2029-01', '2029-01-01']]) {
    await page.getByLabel('Monat wählen', { exact: true }).fill(month);
    await expect(page.locator(`[data-month-day="${date}"]`)).toHaveAttribute('data-day-status', 'untouched');
    await expect(page.locator(`[data-month-day="${date}"] .mo-day-balance strong`)).toHaveText('—');
    await expect(page.getByRole('region', { name: 'Monatsbilanz' }).locator('.summary-item').nth(2).locator('strong')).toHaveText('—');
  }
});

test('yearly account distinguishes unknown allowance, taken and planned days; negative remaining days warn but allow saving', async ({ page }, testInfo) => {
  await page.goto('/');
  await mutate(page, '/api/vacations', 'PUT', { days: [
    { date: '2026-09-28', fraction: 1 }, { date: '2026-09-29', fraction: 0.5 },
    { date: '2026-12-28', fraction: 1 }, { date: '2027-01-04', fraction: 1 },
  ] });
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Zeitkonto', exact: true }).click();
  await page.getByRole('tablist', { name: 'Kontoansicht' }).getByRole('tab', { name: 'Urlaubskonto', exact: true }).click();
  const account = page.getByRole('region', { name: 'Urlaubskonto', exact: true });
  await expect(account.getByRole('combobox', { name: 'Urlaubsjahr', exact: true })).toHaveValue('2026');
  const stats = account.locator('.vacation-account-stats');
  await expect(stats.locator('div').nth(0)).toContainText('1,5 Tage');
  await expect(stats.locator('div').nth(1)).toContainText('1 Tag');
  await expect(stats.locator('div').nth(2)).toContainText('Unbekannt');
  expect((await getState(page)).vacationAllowances).toEqual([]);
  await account.getByLabel('Jahresanspruch in Tagen', { exact: true }).fill('1');
  await account.getByLabel('Übertrag in Tagen', { exact: true }).fill('0.5');
  await account.getByRole('button', { name: 'Anspruch speichern', exact: true }).click();
  await expect(account.getByText('Anspruch gespeichert.', { exact: true })).toBeVisible();
  await expect(stats.locator('div').nth(2)).toContainText('-1 Tag');
  await expect(account).toContainText('übersteigen den Anspruch');
  const saved = await getState(page);
  expect(saved.vacationAllowances).toEqual([{ year: 2026, entitlementDays: 1, carryoverDays: 0.5 }]);
  await expect(account.getByRole('button', { name: 'Anspruch speichern', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('vacation-account-mobile.png') });
  await page.screenshot({ path: testInfo.outputPath('vacation-account-mobile-viewport.png') });
  await account.getByRole('combobox', { name: 'Urlaubsjahr', exact: true }).selectOption('2027');
  await expect(stats.locator('div').nth(0)).toContainText('0 Tage');
  await expect(stats.locator('div').nth(1)).toContainText('1 Tag');
  await expect(stats.locator('div').nth(2)).toContainText('Unbekannt');
  expect((await getState(page)).vacationAllowances).toEqual(saved.vacationAllowances);
});

async function openAccount(page: Page) {
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Zeitkonto', exact: true }).click();
  const report = page.getByRole('region', { name: 'Zeitkonto', exact: true });
  await report.getByRole('tablist', { name: 'Kontoansicht' }).getByRole('tab', { name: 'Urlaubskonto', exact: true }).click();
  return { report, account: report.getByRole('region', { name: 'Urlaubskonto', exact: true }) };
}

test('unsaved annual allowance survives refused year, tab, vacation and page navigation; accepting discards once', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/vacation-allowances/2026', 'PUT', { entitlementDays: 20, carryoverDays: 2 });
  await mutate(page, '/api/vacation-allowances/2027', 'PUT', { entitlementDays: 30, carryoverDays: 3 });
  await mutate(page, '/api/vacations', 'PUT', { days: [{ date: '2026-09-28', fraction: 1 }] });
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  const { report, account } = await openAccount(page);
  const before = await getState(page);
  await account.getByLabel('Jahresanspruch in Tagen', { exact: true }).fill('25.5');
  let confirmations = 0;
  let accept = false;
  let expectedDiscard = 'Ungespeicherten Urlaubsanspruch verwerfen?';
  page.on('dialog', async prompt => {
    confirmations++;
    expect(prompt.message()).toBe(expectedDiscard);
    await (accept ? prompt.accept() : prompt.dismiss());
  });
  const attempts = [
    () => account.getByRole('combobox', { name: 'Urlaubsjahr', exact: true }).selectOption('2027'),
    () => account.getByRole('button', { name: 'Vorheriges Urlaubsjahr', exact: true }).click(),
    () => account.getByRole('button', { name: 'Nächstes Urlaubsjahr', exact: true }).click(),
    () => report.getByRole('tab', { name: 'Stundenkonto', exact: true }).click(),
    () => account.getByRole('button', { name: 'Urlaub eintragen', exact: true }).click(),
    () => account.getByRole('button', { name: 'Urlaub am Montag, 28. September 2026 bearbeiten', exact: true }).click(),
    () => page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Kalender', exact: true }).click(),
    () => page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Vorlagen', exact: true }).click(),
    async () => {
      await page.evaluate(() => { window.location.hash = '#/kalender'; });
      await expect(page).toHaveURL(/#\/zeitkonto$/);
    },
  ];
  for (const [index, attempt] of attempts.entries()) {
    expectedDiscard = index < 3 ? 'Ungespeicherten Urlaubsanspruch verwerfen?' : 'Ungespeicherte Änderungen verwerfen?';
    await attempt();
    expect(confirmations).toBe(index + 1);
    await expect(report).toBeVisible();
    await expect(account.getByRole('combobox', { name: 'Urlaubsjahr', exact: true })).toHaveValue('2026');
    await expect(account.getByLabel('Jahresanspruch in Tagen', { exact: true })).toHaveValue('25.5');
    await expect(account.getByLabel('Übertrag in Tagen', { exact: true })).toHaveValue('2');
    expect(await getState(page)).toEqual(before);
  }
  accept = true;
  expectedDiscard = 'Ungespeicherten Urlaubsanspruch verwerfen?';
  await account.getByRole('button', { name: 'Nächstes Urlaubsjahr', exact: true }).click();
  expect(confirmations).toBe(attempts.length + 1);
  await expect(account.getByRole('combobox', { name: 'Urlaubsjahr', exact: true })).toHaveValue('2027');
  await expect(account.getByLabel('Jahresanspruch in Tagen', { exact: true })).toHaveValue('30');
  await expect(account.getByLabel('Übertrag in Tagen', { exact: true })).toHaveValue('3');
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Kalender', exact: true }).click();
  await expect(report).toBeHidden();
  expect(confirmations).toBe(attempts.length + 1);
  expect(await getState(page)).toEqual(before);
});

test('unchanged, numerically equivalent and successfully saved annual allowances close without discard prompts', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/vacation-allowances/2026', 'PUT', { entitlementDays: 20, carryoverDays: 2 });
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  let confirmations = 0;
  page.on('dialog', async prompt => { confirmations++; await prompt.dismiss(); });
  for (const mode of ['unchanged', 'equivalent', 'saved'] as const) {
    const { report, account } = await openAccount(page);
    if (mode === 'equivalent') {
      await account.getByLabel('Jahresanspruch in Tagen', { exact: true }).fill('20.0');
      await account.getByLabel('Übertrag in Tagen', { exact: true }).fill('2.0');
      await expect(account.getByRole('button', { name: 'Anspruch speichern', exact: true })).toBeDisabled();
    }
    if (mode === 'saved') {
      await account.getByLabel('Jahresanspruch in Tagen', { exact: true }).fill('21');
      await account.getByRole('button', { name: 'Anspruch speichern', exact: true }).click();
      await expect(account.getByText('Anspruch gespeichert.', { exact: true })).toBeVisible();
    }
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Kalender', exact: true }).click();
    await expect(report).toBeHidden();
    expect(confirmations).toBe(0);
  }
  expect((await getState(page)).vacationAllowances).toEqual([{ year: 2026, entitlementDays: 21, carryoverDays: 2 }]);
});

test('pending annual allowance locks year, fields, navigation and closing; failure retains the unsaved draft', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  const { report, account } = await openAccount(page);
  await account.getByLabel('Jahresanspruch in Tagen', { exact: true }).fill('25.5');
  await account.getByLabel('Übertrag in Tagen', { exact: true }).fill('2');
  const before = await getState(page);
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  await page.route('**/api/vacation-allowances/2026', async route => {
    writes++;
    await held;
    await route.fulfill({ status: 503, json: { message: 'Anspruchsspeicherung fehlgeschlagen' } });
  });
  try {
    await account.getByRole('button', { name: 'Anspruch speichern', exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    for (const label of ['Jahresanspruch in Tagen', 'Übertrag in Tagen']) await expect(account.getByLabel(label, { exact: true })).toBeDisabled();
    await expect(account.getByRole('combobox', { name: 'Urlaubsjahr', exact: true })).toBeDisabled();
    for (const name of ['Vorheriges Urlaubsjahr', 'Nächstes Urlaubsjahr', 'Urlaub eintragen', 'Anspruch speichern']) await expect(account.getByRole('button', { name, exact: true })).toBeDisabled();
    for (const name of ['Stundenkonto', 'Urlaubskonto']) await expect(report.getByRole('tab', { name, exact: true })).toBeDisabled();
    await expect(report.getByRole('button', { name: 'Stundenzettel', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Kalender', exact: true }).click();
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Vorlagen', exact: true }).click();
    await page.evaluate(() => { window.location.hash = '#/kalender'; });
    await expect(page).toHaveURL(/#\/zeitkonto$/);
    await account.locator('form').dispatchEvent('submit');
    expect(writes).toBe(1);
    await expect(report).toBeVisible();
    release();
    await expect(account.getByRole('alert')).toContainText('Anspruchsspeicherung fehlgeschlagen');
    await expect(account.getByLabel('Jahresanspruch in Tagen', { exact: true })).toHaveValue('25.5');
    await expect(account.getByLabel('Übertrag in Tagen', { exact: true })).toHaveValue('2');
    await expect(account.getByRole('button', { name: 'Anspruch speichern', exact: true })).toBeEnabled();
    await expect(report.getByRole('tab', { name: 'Stundenkonto', exact: true })).toBeEnabled();
    let confirmations = 0;
    page.once('dialog', async prompt => { confirmations++; await prompt.dismiss(); });
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Kalender', exact: true }).click();
    expect(confirmations).toBe(1);
    await expect(report).toBeVisible();
    expect(await getState(page)).toEqual(before);
    page.once('dialog', prompt => prompt.accept());
    await account.getByRole('combobox', { name: 'Urlaubsjahr', exact: true }).selectOption('2027');
    await expect(account.getByRole('combobox', { name: 'Urlaubsjahr', exact: true })).toHaveValue('2027');
    await expect(account.getByLabel('Jahresanspruch in Tagen', { exact: true })).toBeEmpty();
    await expect(account.getByRole('alert')).toHaveCount(0);
    expect(await getState(page)).toEqual(before);
  } finally { release(); }
});

test('vacation and DST notes keep all seven calendar headers and work axes aligned on desktop and mobile', async ({ page }, testInfo) => {
  await page.goto('/');
  await mutate(page, '/api/profiles', 'POST', { effectiveFrom: null, weeklyMinutes: 2880, workdays: [1, 2, 3, 4, 5, 7] });
  await mutate(page, '/api/vacations', 'PUT', { days: [{ date: '2026-03-29', fraction: 1 }, { date: '2026-09-28', fraction: 1 }, { date: '2026-10-25', fraction: 1 }] });
  await page.reload();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const [date, hours] of [['2026-03-29', 23], ['2026-09-28', 24], ['2026-10-25', 25]] as const) {
      await chooseWeek(page, date);
      const selected = day(page, date);
      if (hours === 24) await expect(page.locator('.ov-dst-note')).toHaveCount(0);
      else await expect(selected.locator('.ov-dst-note')).toContainText(`${hours} reale Std.`);
      const longLabel = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
      await selected.getByRole('button', { name: `Aktionen für ${longLabel}`, exact: true }).click();
      await expect(page.getByRole('menuitem', { name: `Abwesenheiten am ${date.slice(8)}.${date.slice(5, 7)}.${date.slice(0, 4)}`, exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      const measurements = await page.locator('[data-calendar-day]').evaluateAll(elements => elements.map(element => {
        const head = element.querySelector('.ov-calendar-dayhead')!.getBoundingClientRect();
        const lane = element.querySelector('[data-work-lane]')!.getBoundingClientRect();
        return { height: head.height, top: lane.top };
      }));
      expect(measurements).toHaveLength(7);
      const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
      expect(spread(measurements.map(value => value.height)), `${date} at ${width}px header heights ${measurements.map(value => value.height).join(', ')}`).toBeLessThanOrEqual(0.5);
      expect(spread(measurements.map(value => value.top)), `${date} at ${width}px work lane tops ${measurements.map(value => value.top).join(', ')}`).toBeLessThanOrEqual(0.5);
      await page.locator('.ov-calendar-scroll').evaluate((element, showStart) => { element.scrollLeft = showStart ? 0 : element.scrollWidth; }, hours === 24);
      await selected.locator('.ov-calendar-dayhead').scrollIntoViewIfNeeded();
      await expect(selected.locator('.ov-day-date')).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`vacation-dst-${date}-${width}-viewport.png`) });
    }
  }
});

test('the yearly leave list shows no credit for leave on a public holiday, matching the account totals', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/holiday-profiles', 'POST', { effectiveFrom: '2026-01-01', region: 'HE' });
  await mutate(page, '/api/vacations', 'PUT', { days: [{ date: '2026-12-24', fraction: 1 }, { date: '2026-12-25', fraction: 1 }] });
  await page.reload();
  await chooseWeek(page, '2026-12-21');
  const { account } = await openAccount(page);
  await account.getByRole('combobox', { name: 'Urlaubsjahr', exact: true }).selectOption('2026');
  await expect(account.locator('.vacation-account-stats div').nth(1)).toContainText('1 Tag');
  const items = account.locator('.vacation-account-list li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('8 h Gutschrift');
  await expect(items.nth(0)).not.toContainText('Feiertag');
  await expect(items.nth(1)).toContainText('0 h Gutschrift · am Feiertag ausgesetzt');
});
