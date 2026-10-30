import type { Locator, Page, Request } from '@playwright/test';
import type { AbsenceChange, AppState } from '../../shared/types.js';
import { test, expect, getState, chooseWeek } from './isolated-fixture';

const MONDAY = '2026-09-21';
const TUESDAY = '2026-09-22';
const WEDNESDAY = '2026-09-23';
const row = (dialog: Locator, index: number) => dialog.locator('.absence-day').nth(index);
const vacation = (scope: Locator) => scope.getByRole('combobox', { name: /^Urlaub\s*$/ }).or(scope.getByRole('combobox', { name: /^Urlaub .+/ }));
const compensation = (scope: Locator) => scope.getByRole('combobox', { name: /^Freizeitausgleich/ });
const saveButton = (dialog: Locator) => dialog.getByRole('button', { name: 'Abwesenheiten speichern', exact: true });
const applyButton = (dialog: Locator) => dialog.getByRole('button', { name: 'Muster auf ausgewählte Tage übernehmen', exact: true });
const vacationChange = (date: string, vacationFraction: 0 | 0.5 | 1): AbsenceChange => ({ date, vacationFraction, compensation: null, sickness: false });

async function mutate(page: Page, path: string, method: 'PUT' | 'POST', values: object): Promise<AppState> {
  const before = await getState(page);
  const response = await page.request.fetch(path, {
    method, headers: { Origin: new URL(page.url()).origin }, data: { ...values, expectedRevision: before.revision },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function openAbsences(page: Page, through = TUESDAY) {
  await chooseWeek(page, MONDAY);
  await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Abwesenheiten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Abwesenheiten', exact: true });
  await dialog.getByLabel('Von', { exact: true }).fill(MONDAY);
  await dialog.getByLabel('Bis einschließlich', { exact: true }).fill(through);
  return dialog;
}

function captureWrites(page: Page) {
  const requests: Request[] = [];
  const capture = (request: Request) => {
    if (new URL(request.url()).pathname === '/api/absences' && request.method() === 'PUT') requests.push(request);
  };
  page.on('request', capture);
  return { requests, stop: () => page.off('request', capture) };
}

async function staleSave(page: Page, dialog: Locator) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/absences' && response.request().method() === 'PUT');
  await saveButton(dialog).click();
  expect((await response).status()).toBe(409);
  await expect(dialog.getByRole('status').filter({ hasText: 'Daten wurden während dieses Entwurfs geändert' })).toBeVisible();
  await expect(saveButton(dialog)).toBeEnabled();
}

test('Absence regressions: a preselected native option can explicitly apply its pattern to mixed saved days', async ({ page }, testInfo) => {
  await page.goto('/');
  await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(MONDAY, 1)] });
  await page.reload();
  const before = await getState(page);
  const dialog = await openAbsences(page);
  const bulkVacation = vacation(dialog.locator('.absence-bulk'));
  const writes = captureWrites(page);
  await expect(bulkVacation).toHaveValue('1');
  await expect(vacation(row(dialog, 1))).toHaveValue('0');
  await expect(applyButton(dialog)).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await applyButton(dialog).scrollIntoViewIfNeeded();
    await expect(applyButton(dialog)).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`absence-apply-pattern-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A real native re-selection emits no change; the visible action must still work.
  await bulkVacation.scrollIntoViewIfNeeded();
  await expect(bulkVacation).toBeInViewport();
  await bulkVacation.press('Space');
  await bulkVacation.press('End');
  await bulkVacation.press('Enter');
  await expect(vacation(row(dialog, 1))).toHaveValue('0');
  await applyButton(dialog).click();
  await expect(vacation(row(dialog, 1))).toHaveValue('1');
  await expect(applyButton(dialog)).toHaveCount(0);
  expect(writes.requests).toHaveLength(0);
  expect(await getState(page)).toEqual(before);
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.requests).toHaveLength(1);
  expect(writes.requests[0].postDataJSON()).toEqual({ expectedRevision: before.revision, confirmReopen: false, days: [vacationChange(TUESDAY, 1)] });
  const after = await getState(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.vacations).toEqual([MONDAY, TUESDAY].map(date => ({ date, fraction: 1 })));
  writes.stop();
});

test('Absence regressions: reapplying an active pattern replaces selected overrides and preserves excluded days', async ({ page }) => {
  await page.goto('/');
  const before = await getState(page);
  const dialog = await openAbsences(page, WEDNESDAY);
  const bulkVacation = vacation(dialog.locator('.absence-bulk'));
  const writes = captureWrites(page);
  await expect(applyButton(dialog)).toHaveCount(0);
  await bulkVacation.selectOption('1');
  for (const index of [0, 1, 2]) await expect(vacation(row(dialog, index))).toHaveValue('1');
  await vacation(row(dialog, 1)).selectOption('0.5');
  await vacation(row(dialog, 2)).selectOption('0.5');
  await row(dialog, 2).locator('.absence-day-label input').uncheck();
  await expect(applyButton(dialog)).toBeVisible();
  await applyButton(dialog).click();
  await expect(vacation(row(dialog, 1))).toHaveValue('1');
  await expect(vacation(row(dialog, 2))).toHaveValue('0.5');
  await expect(row(dialog, 2).locator('.absence-day-label input')).not.toBeChecked();
  await expect(applyButton(dialog)).toHaveCount(0);
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.requests).toHaveLength(1);
  expect(writes.requests[0].postDataJSON().days).toEqual([MONDAY, TUESDAY].map(date => vacationChange(date, 1)));
  const after = await getState(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.vacations).toEqual([MONDAY, TUESDAY].map(date => ({ date, fraction: 1 })));
  writes.stop();
});

test('Absence regressions: valid individual minutes submit despite an invalid unused global value', async ({ page }) => {
  await page.goto('/');
  const before = await getState(page);
  const dialog = await openAbsences(page);
  const bulk = dialog.locator('.absence-bulk');
  const writes = captureWrites(page);
  await compensation(bulk).selectOption('minutes');
  await bulk.getByRole('spinbutton').fill('0');
  await row(dialog, 0).getByRole('spinbutton').fill('90');
  await row(dialog, 1).getByRole('spinbutton').fill('120');
  await expect(bulk.getByRole('spinbutton')).toHaveValue('0');
  // Native constraints still describe the global input, but selected rows govern submission.
  expect(await dialog.locator('form').evaluate(form => (form as HTMLFormElement).checkValidity())).toBe(false);
  await expect(saveButton(dialog)).toBeEnabled();
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.requests).toHaveLength(1);
  expect(writes.requests[0].postDataJSON()).toEqual({
    expectedRevision: before.revision, confirmReopen: false,
    days: [90, 120].map((value, index) => ({ date: [MONDAY, TUESDAY][index], vacationFraction: 0, compensation: { mode: 'minutes', value }, sickness: false })),
  });
  const after = await getState(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.absences).toEqual([90, 120].map((value, index) => ({ date: [MONDAY, TUESDAY][index], compensation: { mode: 'minutes', value }, sickness: false })));
  writes.stop();
});

test('Absence regressions: manual validation still rejects invalid selected minutes without a request', async ({ page }) => {
  await page.goto('/');
  const before = await getState(page);
  const dialog = await openAbsences(page, MONDAY);
  const writes = captureWrites(page);
  await compensation(row(dialog, 0)).selectOption('minutes');
  for (const value of ['0', '10081', '1.5', '']) {
    await row(dialog, 0).getByRole('spinbutton').fill(value);
    await expect(saveButton(dialog)).toBeDisabled();
    await expect(row(dialog, 0).getByRole('alert')).toBeVisible();
    await dialog.locator('form').evaluate(form => (form as HTMLFormElement).requestSubmit());
    expect(await getState(page)).toEqual(before);
    expect(writes.requests).toHaveLength(0);
  }
  await row(dialog, 0).getByRole('spinbutton').fill('90');
  await expect(saveButton(dialog)).toBeEnabled();
  writes.stop();
});

test('Absence regressions: a 409 retry preserves an untouched external day and work, including after Undo', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/blocks', 'POST', { start: '2026-09-21T08:00:00Z', end: '2026-09-21T09:00:00Z', title: 'Existing work', note: 'Keep this block' });
  await page.reload();
  const before = await getState(page);
  const dialog = await openAbsences(page);
  await vacation(row(dialog, 0)).selectOption('1');
  const external = await mutate(page, '/api/absences', 'PUT', { days: [{ date: TUESDAY, vacationFraction: 0.5, compensation: { mode: 'minutes', value: 90 }, sickness: true }] });
  const writes = captureWrites(page);
  const prompts: string[] = [];
  page.on('dialog', async prompt => { prompts.push(prompt.message()); await prompt.dismiss(); });
  await staleSave(page, dialog);
  await expect(vacation(row(dialog, 0))).toHaveValue('1');
  await expect(vacation(row(dialog, 1))).toHaveValue('0.5');
  await expect(row(dialog, 1).getByRole('spinbutton')).toHaveValue('90');
  await expect(row(dialog, 1).locator('.absence-sickness input')).toBeChecked();
  expect(await getState(page)).toEqual(external);
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(prompts).toEqual([]);
  expect(writes.requests).toHaveLength(2);
  for (const [index, revision] of [before.revision, external.revision].entries()) {
    expect(writes.requests[index].postDataJSON()).toEqual({ expectedRevision: revision, confirmReopen: false, days: [vacationChange(MONDAY, 1)] });
  }
  const after = await getState(page);
  expect(after.revision).toBe(external.revision + 1);
  expect(after.vacations).toEqual([{ date: MONDAY, fraction: 1 }, { date: TUESDAY, fraction: 0.5 }]);
  expect(after.absences).toEqual(external.absences);
  expect(after.blocks).toEqual(before.blocks);
  await page.getByRole('button', { name: /Rückgängig/ }).click();
  await expect.poll(async () => (await getState(page)).revision).toBe(after.revision + 1);
  const undone = await getState(page);
  expect(undone.vacations).toEqual(external.vacations);
  expect(undone.absences).toEqual(external.absences);
  expect(undone.blocks).toEqual(before.blocks);
  expect(writes.requests).toHaveLength(2);
  writes.stop();
});

test('Absence regressions: a genuinely edited conflicting day still requires explicit overwrite confirmation', async ({ page }) => {
  await page.goto('/');
  const dialog = await openAbsences(page);
  const before = await getState(page);
  await vacation(row(dialog, 0)).selectOption('1');
  const external = await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(MONDAY, 0.5), vacationChange(TUESDAY, 1)] });
  const writes = captureWrites(page);
  await staleSave(page, dialog);
  await expect(vacation(row(dialog, 0))).toHaveValue('1');
  await expect(vacation(row(dialog, 1))).toHaveValue('1');
  let declined = '';
  page.once('dialog', async prompt => { declined = prompt.message(); await prompt.dismiss(); });
  await saveButton(dialog).click();
  expect(declined).toContain('Ihre aktuellen Abwesenheiten durch deinen Entwurf ersetzen');
  await expect(dialog).toBeVisible();
  expect(await getState(page)).toEqual(external);
  expect(writes.requests).toHaveLength(1);
  let accepted = '';
  page.once('dialog', async prompt => { accepted = prompt.message(); await prompt.accept(); });
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(accepted).toBe(declined);
  expect(writes.requests).toHaveLength(2);
  expect(writes.requests.map(request => request.postDataJSON())).toEqual([before.revision, external.revision].map(expectedRevision => ({ expectedRevision, confirmReopen: false, days: [vacationChange(MONDAY, 1)] })));
  const after = await getState(page);
  expect(after.revision).toBe(external.revision + 1);
  expect(after.vacations).toEqual([MONDAY, TUESDAY].map(date => ({ date, fraction: 1 })));
  writes.stop();
});

test('Absence regressions: a newly discovered absence on a zero-target day stays visible and untouched after refresh', async ({ page }) => {
  await page.goto('/');
  const dialog = await openAbsences(page);
  await vacation(row(dialog, 0)).selectOption('1');
  await mutate(page, '/api/absences', 'PUT', { days: [{ date: TUESDAY, vacationFraction: 0, compensation: { mode: 'minutes', value: 90 }, sickness: true }] });
  const external = await mutate(page, '/api/profiles', 'POST', { effectiveFrom: null, weeklyMinutes: 480, workdays: [1] });
  const writes = captureWrites(page);
  const prompts: string[] = [];
  page.on('dialog', async prompt => { prompts.push(prompt.message()); await prompt.dismiss(); });
  await staleSave(page, dialog);
  const tuesday = row(dialog, 1);
  await expect(tuesday.locator('.absence-day-label input')).toBeEnabled();
  await expect(tuesday.locator('.absence-day-label input')).toBeChecked();
  await expect(tuesday.getByRole('button', { name: 'Ausgewählte Tage leeren', exact: true })).toBeVisible();
  await expect(tuesday.locator('.absence-calculation')).toBeVisible();
  await expect(tuesday.locator('.absence-day-label')).toContainText('Soll 0');
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(prompts).toEqual([]);
  expect(writes.requests).toHaveLength(2);
  for (const request of writes.requests) expect(request.postDataJSON().days).toEqual([vacationChange(MONDAY, 1)]);
  const after = await getState(page);
  expect(after.revision).toBe(external.revision + 1);
  expect(after.absences).toEqual(external.absences);
  expect(after.profiles).toEqual(external.profiles);
  expect(after.vacations).toEqual([{ date: MONDAY, fraction: 1 }]);
  writes.stop();
});

for (const clear of ['individual selection', 'clear selected days'] as const) {
test(`Absence regressions: ${clear} after conflict retains the clear and requires confirmation`, async ({ page }) => {
  await page.goto('/');
  const dialog = await openAbsences(page, MONDAY);
  await vacation(row(dialog, 0)).selectOption('1');
  const external = await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(MONDAY, 0.5)] });
  const writes = captureWrites(page);
  await staleSave(page, dialog);
  // Zero matches the opening value, but it is a new deliberate edit of the current half-day.
  if (clear === 'individual selection') await vacation(row(dialog, 0)).selectOption('0');
  else await dialog.getByRole('button', { name: 'Ausgewählte Tage leeren', exact: true }).click();
  await expect(vacation(row(dialog, 0))).toHaveValue('0');
  await expect(saveButton(dialog)).toBeEnabled();
  let declined = '';
  page.once('dialog', async prompt => { declined = prompt.message(); await prompt.dismiss(); });
  await saveButton(dialog).click();
  expect(declined).toContain('Ihre aktuellen Abwesenheiten durch deinen Entwurf ersetzen');
  expect(writes.requests).toHaveLength(1);
  expect(await getState(page)).toEqual(external);
  await expect(vacation(row(dialog, 0))).toHaveValue('0');
  page.once('dialog', prompt => prompt.accept());
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.requests).toHaveLength(2);
  expect(writes.requests[1].postDataJSON()).toEqual({ expectedRevision: external.revision, confirmReopen: false, days: [vacationChange(MONDAY, 0)] });
  const after = await getState(page);
  expect(after.revision).toBe(external.revision + 1);
  expect(after.vacations).toEqual([]);
  writes.stop();
});
}

test('Absence regressions: re-entering a range applies the active pattern with a fresh baseline and keeps individual overrides', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(TUESDAY, 1)] });
  await page.reload();
  const before = await getState(page);
  const dialog = await openAbsences(page, WEDNESDAY);
  await vacation(dialog.locator('.absence-bulk')).selectOption('1');
  await vacation(row(dialog, 2)).selectOption('0.5');
  await dialog.getByLabel('Bis einschließlich', { exact: true }).fill(MONDAY);
  const external = await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(TUESDAY, 0.5)] });
  const writes = captureWrites(page);
  await staleSave(page, dialog);
  await dialog.getByLabel('Bis einschließlich', { exact: true }).fill(WEDNESDAY);
  await expect(vacation(row(dialog, 0))).toHaveValue('1');
  await expect(vacation(row(dialog, 1))).toHaveValue('1');
  await expect(vacation(row(dialog, 2))).toHaveValue('0.5');
  const prompts: string[] = [];
  page.on('dialog', async prompt => { prompts.push(prompt.message()); await prompt.dismiss(); });
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(prompts).toEqual([]);
  expect(writes.requests).toHaveLength(2);
  expect(writes.requests[0].postDataJSON()).toEqual({ expectedRevision: before.revision, confirmReopen: false, days: [vacationChange(MONDAY, 1)] });
  expect(writes.requests[1].postDataJSON()).toEqual({
    expectedRevision: external.revision, confirmReopen: false,
    days: [vacationChange(MONDAY, 1), vacationChange(TUESDAY, 1), vacationChange(WEDNESDAY, 0.5)],
  });
  const after = await getState(page);
  expect(after.revision).toBe(external.revision + 1);
  expect(after.vacations).toEqual([{ date: MONDAY, fraction: 1 }, { date: TUESDAY, fraction: 1 }, { date: WEDNESDAY, fraction: 0.5 }]);
  writes.stop();
});

test('Absence regressions: excluding and reselecting a no-op override keeps it until an explicit new pattern', async ({ page }) => {
  await page.goto('/');
  const before = await getState(page);
  const dialog = await openAbsences(page);
  const bulkVacation = vacation(dialog.locator('.absence-bulk'));
  const tuesday = row(dialog, 1);
  const selected = tuesday.locator('.absence-day-label input');
  const writes = captureWrites(page);
  await bulkVacation.selectOption('1');
  await vacation(tuesday).selectOption('0');
  await selected.uncheck();
  await expect(vacation(tuesday)).toHaveValue('0');
  await selected.check();
  await expect(vacation(tuesday)).toHaveValue('0');
  await expect(vacation(row(dialog, 0))).toHaveValue('1');
  await expect(applyButton(dialog)).toBeVisible();
  expect(await getState(page)).toEqual(before);
  expect(writes.requests).toHaveLength(0);
  await bulkVacation.selectOption('0.5');
  await expect(vacation(tuesday)).toHaveValue('0.5');
  await expect(vacation(row(dialog, 0))).toHaveValue('0.5');
  await expect(applyButton(dialog)).toHaveCount(0);
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.requests).toHaveLength(1);
  expect(writes.requests[0].postDataJSON()).toEqual({
    expectedRevision: before.revision, confirmReopen: false,
    days: [MONDAY, TUESDAY].map(date => vacationChange(date, 0.5)),
  });
  const after = await getState(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.vacations).toEqual([MONDAY, TUESDAY].map(date => ({ date, fraction: 0.5 })));
  writes.stop();
});

test('Absence regressions: reselecting an excluded no-op override uses the refreshed remote value', async ({ page }) => {
  await page.goto('/');
  const before = await getState(page);
  const dialog = await openAbsences(page);
  const tuesday = row(dialog, 1);
  const selected = tuesday.locator('.absence-day-label input');
  await vacation(dialog.locator('.absence-bulk')).selectOption('1');
  await vacation(tuesday).selectOption('0');
  await selected.uncheck();
  const external = await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(TUESDAY, 0.5)] });
  const writes = captureWrites(page);
  const prompts: string[] = [];
  page.on('dialog', async prompt => { prompts.push(prompt.message()); await prompt.dismiss(); });
  await staleSave(page, dialog);
  await selected.check();
  await expect(vacation(tuesday)).toHaveValue('0.5');
  await expect(vacation(row(dialog, 0))).toHaveValue('1');
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(prompts).toEqual([]);
  expect(writes.requests.map(request => request.postDataJSON())).toEqual([before.revision, external.revision].map(expectedRevision => ({
    expectedRevision, confirmReopen: false, days: [vacationChange(MONDAY, 1)],
  })));
  const after = await getState(page);
  expect(after.revision).toBe(external.revision + 1);
  expect(after.vacations).toEqual([{ date: MONDAY, fraction: 1 }, { date: TUESDAY, fraction: 0.5 }]);
  writes.stop();
});

test('Absence regressions: a refreshed no-op row remains untouched through selection changes and a second refresh', async ({ page }) => {
  await page.goto('/');
  const before = await getState(page);
  const dialog = await openAbsences(page);
  const tuesday = row(dialog, 1);
  const selected = tuesday.locator('.absence-day-label input');
  await vacation(dialog.locator('.absence-bulk')).selectOption('1');
  await vacation(tuesday).selectOption('0');
  const firstExternal = await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(TUESDAY, 0.5)] });
  const writes = captureWrites(page);
  const prompts: string[] = [];
  page.on('dialog', async prompt => { prompts.push(prompt.message()); await prompt.dismiss(); });
  await staleSave(page, dialog);
  await expect(vacation(tuesday)).toHaveValue('0.5');
  await selected.uncheck();
  await selected.check();
  await expect(vacation(tuesday)).toHaveValue('0.5');
  const secondExternal = await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(TUESDAY, 1)] });
  await staleSave(page, dialog);
  await expect(vacation(tuesday)).toHaveValue('1');
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(prompts).toEqual([]);
  expect(writes.requests.map(request => request.postDataJSON())).toEqual([before.revision, firstExternal.revision, secondExternal.revision].map(expectedRevision => ({
    expectedRevision, confirmReopen: false, days: [vacationChange(MONDAY, 1)],
  })));
  const after = await getState(page);
  expect(after.revision).toBe(secondExternal.revision + 1);
  expect(after.vacations).toEqual([MONDAY, TUESDAY].map(date => ({ date, fraction: 1 })));
  writes.stop();
});

test('Absence regressions: a new pattern applies to a re-entering formerly unchanged day without a stale baseline', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(TUESDAY, 1)] });
  await page.reload();
  const before = await getState(page);
  const dialog = await openAbsences(page);
  const bulkVacation = vacation(dialog.locator('.absence-bulk'));
  await bulkVacation.selectOption('1');
  await dialog.getByLabel('Bis einschließlich', { exact: true }).fill(MONDAY);
  await bulkVacation.selectOption('0.5');
  const external = await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(TUESDAY, 0)] });
  const writes = captureWrites(page);
  const prompts: string[] = [];
  page.on('dialog', async prompt => { prompts.push(prompt.message()); await prompt.dismiss(); });
  await staleSave(page, dialog);
  await dialog.getByLabel('Bis einschließlich', { exact: true }).fill(TUESDAY);
  await expect(vacation(row(dialog, 0))).toHaveValue('0.5');
  await expect(vacation(row(dialog, 1))).toHaveValue('0.5');
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(prompts).toEqual([]);
  expect(writes.requests[0].postDataJSON()).toEqual({ expectedRevision: before.revision, confirmReopen: false, days: [vacationChange(MONDAY, 0.5)] });
  expect(writes.requests).toHaveLength(2);
  expect(writes.requests[1].postDataJSON()).toEqual({ expectedRevision: external.revision, confirmReopen: false, days: [MONDAY, TUESDAY].map(date => vacationChange(date, 0.5)) });
  const after = await getState(page);
  expect(after.revision).toBe(external.revision + 1);
  expect(after.vacations).toEqual([MONDAY, TUESDAY].map(date => ({ date, fraction: 0.5 })));
  writes.stop();
});

test('Absence regressions: an unchanged pattern row keeps its refreshed value across deselection and reselecting', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(TUESDAY, 1)] });
  await page.reload();
  const before = await getState(page);
  const dialog = await openAbsences(page);
  await vacation(dialog.locator('.absence-bulk')).selectOption('1');
  // Tuesday already matched the pattern; there is no individual override.
  const external = await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(TUESDAY, 0.5)] });
  const writes = captureWrites(page);
  const prompts: string[] = [];
  page.on('dialog', async prompt => { prompts.push(prompt.message()); await prompt.dismiss(); });
  await staleSave(page, dialog);
  const tuesday = row(dialog, 1);
  await expect(vacation(tuesday)).toHaveValue('0.5');
  await tuesday.locator('.absence-day-label input').uncheck();
  await tuesday.locator('.absence-day-label input').check();
  await expect(vacation(tuesday)).toHaveValue('0.5');
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(prompts).toEqual([]);
  expect(writes.requests.map(request => request.postDataJSON())).toEqual([before.revision, external.revision].map(expectedRevision => ({
    expectedRevision, confirmReopen: false, days: [vacationChange(MONDAY, 1)],
  })));
  const after = await getState(page);
  expect(after.revision).toBe(external.revision + 1);
  expect(after.vacations).toEqual([{ date: MONDAY, fraction: 1 }, { date: TUESDAY, fraction: 0.5 }]);
  writes.stop();
});

test('Absence regressions: a real pattern edit retains its conflict baseline when re-entering the range', async ({ page }) => {
  await page.goto('/');
  const before = await getState(page);
  const dialog = await openAbsences(page);
  await vacation(dialog.locator('.absence-bulk')).selectOption('1');
  await dialog.getByLabel('Bis einschließlich', { exact: true }).fill(MONDAY);
  const external = await mutate(page, '/api/absences', 'PUT', { days: [vacationChange(TUESDAY, 0.5)] });
  const writes = captureWrites(page);
  await staleSave(page, dialog);
  await dialog.getByLabel('Bis einschließlich', { exact: true }).fill(TUESDAY);
  await expect(vacation(row(dialog, 1))).toHaveValue('1');
  let declined = '';
  page.once('dialog', async prompt => { declined = prompt.message(); await prompt.dismiss(); });
  await saveButton(dialog).click();
  expect(declined).toContain('Ihre aktuellen Abwesenheiten durch deinen Entwurf ersetzen');
  expect(writes.requests).toHaveLength(1);
  expect(await getState(page)).toEqual(external);
  let accepted = '';
  page.once('dialog', async prompt => { accepted = prompt.message(); await prompt.accept(); });
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(accepted).toBe(declined);
  expect(writes.requests).toHaveLength(2);
  expect(writes.requests[0].postDataJSON()).toEqual({ expectedRevision: before.revision, confirmReopen: false, days: [vacationChange(MONDAY, 1)] });
  expect(writes.requests[1].postDataJSON()).toEqual({ expectedRevision: external.revision, confirmReopen: false, days: [MONDAY, TUESDAY].map(date => vacationChange(date, 1)) });
  const after = await getState(page);
  expect(after.revision).toBe(external.revision + 1);
  expect(after.vacations).toEqual([MONDAY, TUESDAY].map(date => ({ date, fraction: 1 })));
  writes.stop();
});
