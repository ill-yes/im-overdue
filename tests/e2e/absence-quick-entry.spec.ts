import type { Locator, Page, Request } from '@playwright/test';
import { test, expect, getState, chooseWeek } from './isolated-fixture';

const MONDAY = '2026-09-28';
const TUESDAY = '2026-09-29';
const WEDNESDAY = '2026-09-30';
const THURSDAY = '2026-10-01';

async function openAbsences(page: Page) {
  await chooseWeek(page, MONDAY);
  await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Abwesenheiten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Abwesenheiten', exact: true });
  await dialog.getByLabel('Von', { exact: true }).fill(MONDAY);
  await dialog.getByLabel('Bis einschließlich', { exact: true }).fill(MONDAY);
  return dialog;
}

const day = (dialog: Locator, index: number) => dialog.locator('.absence-day').nth(index);
const vacation = (scope: Locator) => scope.locator('select').nth(0);
const compensation = (scope: Locator) => scope.locator('select').nth(1);

function captureWrites(page: Page) {
  const requests: Request[] = [];
  const capture = (request: Request) => {
    if (new URL(request.url()).pathname === '/api/absences' && request.method() === 'PUT') requests.push(request);
  };
  page.on('request', capture);
  return { requests, stop: () => page.off('request', capture) };
}

test('Absence quick entry: global controls update the preview and save once without applying', async ({ page }, testInfo) => {
  await page.goto('/');
  const before = await getState(page);
  const writes = captureWrites(page);
  const dialog = await openAbsences(page);
  await dialog.getByLabel('Bis einschließlich', { exact: true }).fill(TUESDAY);
  const bulk = dialog.locator('.absence-bulk');
  await vacation(bulk).selectOption('0.5');
  await compensation(bulk).selectOption('minutes');
  await bulk.getByRole('spinbutton').fill('120');
  await bulk.getByRole('checkbox').check();
  await expect(dialog.getByRole('button', { name: 'Auf ausgewählte Tage anwenden', exact: true })).toHaveCount(0);
  for (const index of [0, 1]) {
    await expect(vacation(day(dialog, index))).toHaveValue('0.5');
    await expect(day(dialog, index).getByRole('spinbutton')).toHaveValue('120');
    await expect(day(dialog, index).locator('.absence-sickness input')).toBeChecked();
  }
  expect(writes.requests).toHaveLength(0);
  expect((await getState(page)).revision).toBe(before.revision);
  await page.screenshot({ path: testInfo.outputPath('absence-immediate-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('absence-immediate-mobile.png') });
  await dialog.getByRole('button', { name: 'Abwesenheiten speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.requests).toHaveLength(1);
  expect(writes.requests[0].postDataJSON()).toEqual({
    expectedRevision: before.revision,
    confirmReopen: false,
    days: [MONDAY, TUESDAY].map(date => ({ date, vacationFraction: 0.5, compensation: { mode: 'minutes', value: 120 }, sickness: true })),
  });
  const saved = await getState(page);
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.vacations).toEqual([MONDAY, TUESDAY].map(date => ({ date, fraction: 0.5 })));
  expect(saved.absences).toEqual([MONDAY, TUESDAY].map(date => ({ date, compensation: { mode: 'minutes', value: 120 }, sickness: true })));
  writes.stop();
});

test('Absence quick entry: extension preserves individual days and exclusions until a new bulk edit', async ({ page }) => {
  await page.goto('/');
  const dialog = await openAbsences(page);
  const through = dialog.getByLabel('Bis einschließlich', { exact: true });
  const bulk = dialog.locator('.absence-bulk');
  await vacation(bulk).selectOption('1');
  await through.fill(TUESDAY);
  await expect(vacation(day(dialog, 1))).toHaveValue('1');
  await vacation(day(dialog, 0)).selectOption('0.5');
  await day(dialog, 1).locator('.absence-day-label input').uncheck();
  await through.fill(THURSDAY);
  await expect(vacation(day(dialog, 0))).toHaveValue('0.5');
  await expect(vacation(day(dialog, 2))).toHaveValue('1');
  await expect(day(dialog, 1).locator('.absence-day-label input')).not.toBeChecked();
  await vacation(bulk).selectOption('0.5');
  await expect(vacation(day(dialog, 0))).toHaveValue('0.5');
  await expect(vacation(day(dialog, 2))).toHaveValue('0.5');
  await expect(vacation(day(dialog, 1))).toHaveValue('1');
  // Returning a date that previously inherited the pattern uses the latest pattern.
  await through.fill(WEDNESDAY);
  await compensation(bulk).selectOption('half');
  await through.fill(THURSDAY);
  await expect(compensation(day(dialog, 3))).toHaveValue('half');
  // A new explicit bulk edit replaces selected individual overrides.
  await vacation(day(dialog, 0)).selectOption('1');
  await expect(day(dialog, 0).locator('.absence-day-adjustment')).toBeVisible();
  await bulk.getByRole('checkbox').check();
  await expect(vacation(day(dialog, 0))).toHaveValue('0.5');
  await expect(day(dialog, 0).locator('.absence-day-adjustment')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Abwesenheiten speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await getState(page);
  expect(saved.vacations).toEqual([MONDAY, WEDNESDAY, THURSDAY].map(date => ({ date, fraction: 0.5 })));
  expect(saved.absences).toEqual([MONDAY, WEDNESDAY, THURSDAY].map(date => ({ date, compensation: { mode: 'fraction', value: 0.5 }, sickness: true })));
});

test('Absence quick entry: opening and extending mixed saved days is a no-op', async ({ page }) => {
  await page.goto('/');
  const state = await getState(page);
  const response = await page.request.put('/api/absences', {
    headers: { Origin: new URL(page.url()).origin },
    data: { expectedRevision: state.revision, days: [
      { date: MONDAY, vacationFraction: 1, compensation: null, sickness: false },
      { date: TUESDAY, vacationFraction: 0, compensation: { mode: 'minutes', value: 90 }, sickness: true },
    ] },
  });
  expect(response.status()).toBe(200);
  await page.reload();
  const before = await getState(page);
  const writes = captureWrites(page);
  const dialog = await openAbsences(page);
  await dialog.getByLabel('Bis einschließlich', { exact: true }).fill(WEDNESDAY);
  await expect(dialog.locator('.absence-pattern-help')).toContainText('unterschiedliche Werte');
  await expect(vacation(day(dialog, 0))).toHaveValue('1');
  await expect(vacation(day(dialog, 1))).toHaveValue('0');
  await expect(day(dialog, 1).getByRole('spinbutton')).toHaveValue('90');
  await expect(vacation(day(dialog, 2))).toHaveValue('0');
  await expect(dialog.getByRole('button', { name: 'Abwesenheiten speichern', exact: true })).toBeDisabled();
  await dialog.locator('form').evaluate(form => (form as HTMLFormElement).requestSubmit());
  expect(await getState(page)).toEqual(before);
  expect(writes.requests).toHaveLength(0);
  writes.stop();
});

test('Absence quick entry: invalid minutes block saving and pending failure retains one draft', async ({ page }) => {
  await page.goto('/');
  const before = await getState(page);
  const dialog = await openAbsences(page);
  const bulk = dialog.locator('.absence-bulk');
  await compensation(bulk).selectOption('minutes');
  await bulk.getByRole('spinbutton').fill('0');
  const save = dialog.getByRole('button', { name: 'Abwesenheiten speichern', exact: true });
  await expect(save).toBeDisabled();
  await bulk.getByRole('spinbutton').fill('90');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/absences', async route => {
    await gate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporär nicht verfügbar' }) });
  });
  const writes = captureWrites(page);
  await dialog.locator('form').evaluate(form => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  await expect(dialog.locator('form')).toHaveAttribute('aria-busy', 'true');
  await expect(save).toBeDisabled();
  await expect(bulk.getByRole('spinbutton')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeDisabled();
  await expect.poll(() => writes.requests.length).toBe(1);
  release();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(bulk.getByRole('spinbutton')).toHaveValue('90');
  await expect(day(dialog, 0).getByRole('spinbutton')).toHaveValue('90');
  expect((await getState(page)).revision).toBe(before.revision);
  await page.unroute('**/api/absences');
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(writes.requests).toHaveLength(2);
  expect((await getState(page)).revision).toBe(before.revision + 1);
  writes.stop();
});

test.describe('English absence quick entry', () => {
  test.use({ appLanguage: 'en' });
  test('the global pattern updates selected days directly', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'More calendar actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Absences', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Absences', exact: true });
    await dialog.getByLabel('From', { exact: true }).fill(MONDAY);
    await dialog.getByLabel('Through', { exact: true }).fill(TUESDAY);
    await vacation(dialog.locator('.absence-bulk')).selectOption('1');
    await expect(vacation(day(dialog, 1))).toHaveValue('1');
    await expect(dialog.locator('.absence-pattern-help')).toContainText('extend the range');
    await dialog.getByRole('button', { name: 'Save absences', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await getState(page)).vacations).toHaveLength(2);
  });
});
