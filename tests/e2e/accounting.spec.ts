import type { Page, Request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect, getState, chooseWeek, openAppAction } from './isolated-fixture';
import type { AppState } from '../../shared/types.js';

const DATE = '2026-09-28';

test('Accounting: historical holiday review prepares an explicit override without saving automatically', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/holiday-profiles', 'POST', { effectiveFrom: '1990-01-01', region: 'ST' });
  await page.reload();
  await openAppAction(page, 'Einstellungen');
  await page.getByRole('tab', { name: 'Feiertage', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Einstellungen', exact: true });
  await expect(settings).toContainText('7. Juni 1992');
  const before = await getState(page);
  await settings.getByRole('button', { name: 'Dieses Datum prüfen', exact: true }).click();
  await expect(settings.locator('.holiday-exceptions input[type="date"]')).toHaveValue('1992-06-07');
  await expect(settings.locator('.holiday-name input')).toHaveValue('Pfingstsonntag');
  expect(await getState(page)).toEqual(before);
  page.on('dialog', dialog => dialog.accept());
  await settings.getByRole('button', { name: 'Datum speichern', exact: true }).click();
  await expect.poll(async () => (await getState(page)).holidayOverrides).toEqual([{ date: '1992-06-07', name: 'Pfingstsonntag' }]);
  await expect(settings.getByRole('button', { name: 'Dieses Datum prüfen', exact: true })).toHaveCount(0);
});

test('Accounting: long absence ranges keep the header and save actions visible on desktop and mobile', async ({ page }, testInfo) => {
  await page.goto('/');
  page.on('dialog', dialog => dialog.accept());
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Abwesenheiten', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Abwesenheiten', exact: true });
    await dialog.getByLabel('Von', { exact: true }).fill(DATE);
    await dialog.getByLabel('Bis einschließlich', { exact: true }).fill('2026-10-11');
    const body = dialog.locator('.absence-body');
    expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.getByRole('heading', { name: 'Abwesenheiten', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Abwesenheiten speichern', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`absence-sticky-${width}.png`) });
    await dialog.getByRole('button', { name: 'Dialog schließen', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  expect((await getState(page)).absences).toEqual([]);
});
const account = (page: Page) => page.getByRole('region', { name: 'Stundenkonto', exact: true });
const opening = (page: Page) => account(page).locator('.hours-account-opening');
const editor = (page: Page) => account(page).locator('.hours-account-editor');
const balance = (page: Page) => account(page).locator('.hours-account-balance > div > strong');
async function mutate(page: Page, path: string, method: string, values: object): Promise<AppState> {
  const before = await getState(page);
  const response = await page.request.fetch(path, {
    method, headers: { Origin: new URL(page.url()).origin }, data: { ...values, expectedRevision: before.revision },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function openAccount(page: Page) {
  await page.getByRole('link', { name: 'Zeitkonto', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Stundenkonto', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(account(page)).toBeVisible();
}
async function setOpening(page: Page, amount = '18:00') {
  await opening(page).getByLabel('Datum', { exact: true }).fill(DATE);
  await opening(page).getByLabel('Zeit (h:mm)', { exact: true }).fill(amount);
  await opening(page).getByRole('button', { name: 'Anfangsbestand speichern', exact: true }).click();
  await expect(opening(page)).toHaveCount(0);
  await expect(account(page).locator('.hours-account-opening-summary')).toBeVisible();
}
async function draftPayout(page: Page, reason = 'Auszahlung September') {
  await account(page).getByRole('button', { name: 'Buchung hinzufügen', exact: true }).click();
  await editor(page).getByLabel('Datum', { exact: true }).fill(DATE);
  await editor(page).getByLabel('Zeit (h:mm)', { exact: true }).fill('8:00');
  await editor(page).getByRole('textbox', { name: 'Begründung', exact: true }).fill(reason);
}
async function seedOpening(page: Page) {
  await page.goto('/');
  await mutate(page, '/api/account/opening', 'PUT', { date: DATE, minutes: 1080 });
  await page.reload();
  await openAccount(page);
}
function captureWrites(page: Page, prefix: string) {
  const requests: Request[] = [];
  const capture = (request: Request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith(prefix)) requests.push(request);
  };
  page.on('request', capture);
  return { requests, stop: () => page.off('request', capture) };
}

for (const mobile of [false, true]) {
  test.describe(mobile ? '390 touch' : 'desktop', () => {
    test.use(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
    test(`Accounting: opening and payout persist with a +10 h balance (${mobile ? 'touch' : 'desktop'})`, async ({ page }, testInfo) => {
      await page.goto('/');
      await openAccount(page);
      await expect(balance(page)).toHaveText('—');
      await setOpening(page);
      await expect(balance(page)).toHaveText('+18 h');
      await draftPayout(page);
      await editor(page).getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
      await expect(editor(page)).toHaveCount(0);
      await expect(balance(page)).toHaveText('+10 h');
      const saved = await getState(page);
      expect(saved.accountOpening).toEqual({ date: DATE, minutes: 1080 });
      expect(saved.accountEntries).toEqual([expect.objectContaining({ date: DATE, kind: 'payout', minutes: -480, reason: 'Auszahlung September' })]);
      expect(saved.blocks).toEqual([]);
      await page.reload();
      await openAccount(page);
      await expect(balance(page)).toHaveText('+10 h');
      await expect(account(page).locator('.hours-account-ledger')).toContainText('Auszahlung September');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('account-saved.png'), fullPage: true });
    });
  });
}

test('Accounting: mixed absence reopens, undoes atomically and contributes -2 h after closing', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/profiles', 'POST', { effectiveFrom: null, weeklyMinutes: 480, workdays: [1] });
  await mutate(page, '/api/account/opening', 'PUT', { date: DATE, minutes: 0 });
  await mutate(page, `/api/weeks/${DATE}`, 'POST', { status: 'closed', confirmWarnings: true });
  await page.reload();
  await chooseWeek(page, DATE);
  const fillAbsence = async () => {
    await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Abwesenheiten', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Abwesenheiten', exact: true });
    await dialog.getByLabel('Von', { exact: true }).fill(DATE);
    await dialog.getByLabel('Bis einschließlich', { exact: true }).fill(DATE);
    const row = dialog.locator('.absence-day');
    await row.getByRole('combobox', { name: /^Urlaub / }).selectOption('0.5');
    await row.getByRole('combobox', { name: /^Freizeitausgleich / }).selectOption('minutes');
    await row.getByRole('spinbutton', { name: /^Minuten / }).fill('120');
    await row.getByRole('checkbox', { name: 'Krankheit füllt Rest', exact: true }).check();
    await expect(row.locator('.absence-calculation')).toContainText('−2 h');
    return dialog;
  };
  const first = await fillAbsence();
  const prompts: string[] = [];
  page.on('dialog', async dialog => { prompts.push(dialog.message()); await dialog.accept(); });
  await first.getByRole('button', { name: 'Abwesenheiten speichern', exact: true }).click();
  await expect(first).toHaveCount(0);
  expect(prompts.some(message => message.includes('wieder'))).toBe(true);
  const changed = await getState(page);
  expect(changed.weeks.find(week => week.weekStart === DATE)?.status).toBe('open');
  expect(changed.vacations).toContainEqual({ date: DATE, fraction: 0.5 });
  expect(changed.absences).toContainEqual({ date: DATE, sickness: true, compensation: { mode: 'minutes', value: 120 } });
  expect(changed.blocks).toEqual([]);
  await page.getByRole('button', { name: /Rückgängig/ }).click();
  await expect.poll(async () => (await getState(page)).absences).toEqual([]);
  const undone = await getState(page);
  expect(undone.vacations).toEqual([]);
  expect(undone.weeks.find(week => week.weekStart === DATE)?.status).toBe('closed');
  const second = await fillAbsence();
  await second.getByRole('button', { name: 'Abwesenheiten speichern', exact: true }).click();
  await expect(second).toHaveCount(0);
  await mutate(page, `/api/weeks/${DATE}`, 'POST', { status: 'closed', confirmWarnings: true });
  await page.reload();
  await openAccount(page);
  await expect(balance(page)).toHaveText('−2 h');
});

test('Accounting: holiday profiles and exceptions persist, no-op saves do not write, credit changes reopen', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/profiles', 'POST', { effectiveFrom: null, weeklyMinutes: 480, workdays: [1] });
  await mutate(page, '/api/absences', 'PUT', { days: [{ date: DATE, vacationFraction: 0.5, sickness: true, compensation: { mode: 'minutes', value: 120 } }] });
  await mutate(page, `/api/weeks/${DATE}`, 'POST', { status: 'closed', confirmWarnings: true });
  await page.reload();
  await openAppAction(page, 'Einstellungen');
  await page.getByRole('tab', { name: 'Feiertage', exact: true }).click();
  const holidays = page.getByRole('region', { name: 'Feiertage', exact: true });
  page.on('dialog', dialog => dialog.accept());
  await holidays.getByLabel('Gültig ab', { exact: true }).fill(DATE);
  await holidays.getByRole('combobox', { name: 'Bundesland', exact: true }).selectOption('HE');
  await holidays.getByRole('button', { name: 'Feiertagsregel speichern', exact: true }).click();
  await expect.poll(async () => (await getState(page)).holidayProfiles?.[0]?.region).toBe('HE');
  expect((await getState(page)).weeks.find(week => week.weekStart === DATE)?.status).toBe('closed');
  const writes = captureWrites(page, '/api/holiday-');
  await expect(holidays.getByRole('button', { name: 'Feiertagsregel speichern', exact: true })).toBeDisabled();
  await holidays.locator('form').first().evaluate(form => (form as HTMLFormElement).requestSubmit());
  await page.waitForTimeout(100);
  expect(writes.requests).toEqual([]);
  await holidays.getByLabel('Datum', { exact: true }).fill(DATE);
  await holidays.getByLabel('Name des Feiertags', { exact: true }).fill('Lokaler Feiertag');
  await holidays.getByRole('button', { name: 'Datum speichern', exact: true }).click();
  await expect.poll(async () => (await getState(page)).holidayOverrides).toEqual([{ date: DATE, name: 'Lokaler Feiertag' }]);
  const changed = await getState(page);
  expect(changed.weeks.find(week => week.weekStart === DATE)?.status).toBe('open');
  expect(changed.absences?.[0]).toEqual({ date: DATE, sickness: true, compensation: { mode: 'minutes', value: 120 } });
  expect(changed.vacations).toEqual([{ date: DATE, fraction: 0.5 }]);
  writes.stop();
  await page.reload();
  await openAppAction(page, 'Einstellungen');
  await page.getByRole('tab', { name: 'Feiertage', exact: true }).click();
  await expect(holidays).toContainText('Hessen');
  const exception = holidays.locator('li').filter({ hasText: 'Lokaler Feiertag' });
  await expect(exception).toBeVisible();
  await exception.getByRole('button', { name: 'Auf Bundeslandregel zurücksetzen', exact: true }).click();
  await expect.poll(async () => (await getState(page)).holidayOverrides).toEqual([]);
});

test('Accounting: pending save blocks duplicate requests and navigation until delayed success', async ({ page }) => {
  await seedOpening(page);
  await draftPayout(page);
  const writes = captureWrites(page, '/api/account/entries');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/account/entries', async route => { await gate; await route.continue(); });
  const save = editor(page).getByRole('button', { name: 'Änderungen speichern', exact: true });
  await save.click();
  await expect(save).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Auswertungen', exact: true })).toBeDisabled();
  await editor(page).evaluate(form => (form as HTMLFormElement).requestSubmit());
  await page.getByRole('link', { name: 'Kalender', exact: true }).click();
  await expect(account(page)).toBeVisible();
  expect(writes.requests).toHaveLength(1);
  release();
  await expect(editor(page)).toHaveCount(0);
  await expect(balance(page)).toHaveText('+10 h');
  expect((await getState(page)).accountEntries).toHaveLength(1);
  writes.stop();
});

test('Accounting: delayed failure retains payout draft and allows one successful retry', async ({ page }) => {
  await seedOpening(page);
  await draftPayout(page, 'Entwurf bleibt');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/account/entries', async route => { await gate; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporär nicht verfügbar' }) }); });
  await editor(page).getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(editor(page).getByRole('textbox', { name: 'Begründung', exact: true })).toBeDisabled();
  release();
  await expect(account(page).getByRole('alert').first()).toBeVisible();
  await expect(editor(page).getByRole('textbox', { name: 'Begründung', exact: true })).toHaveValue('Entwurf bleibt');
  await expect(editor(page).getByLabel('Zeit (h:mm)', { exact: true })).toHaveValue('8:00');
  expect((await getState(page)).accountEntries).toEqual([]);
  await page.unroute('**/api/account/entries');
  await editor(page).getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  expect((await getState(page)).accountEntries).toHaveLength(1);
});

test('Accounting: stale edited row requires explicit replacement and unchanged edit sends no request', async ({ page }) => {
  await seedOpening(page);
  const seeded = await mutate(page, '/api/account/entries', 'POST', { date: DATE, kind: 'payout', minutes: -480, reason: 'Ursprünglich' });
  const id = seeded.accountEntries![0].id;
  await page.reload();
  await openAccount(page);
  await account(page).getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const writes = captureWrites(page, '/api/account/');
  await expect(editor(page).getByRole('button', { name: 'Änderungen speichern', exact: true })).toBeDisabled();
  await editor(page).evaluate(form => (form as HTMLFormElement).requestSubmit());
  await page.waitForTimeout(100);
  expect(writes.requests).toEqual([]);
  await editor(page).getByRole('textbox', { name: 'Begründung', exact: true }).fill('Mein offener Entwurf');
  await mutate(page, `/api/account/entries/${id}`, 'PUT', { date: DATE, kind: 'payout', minutes: -360, reason: 'Extern geändert' });
  await editor(page).getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(account(page).getByRole('status').filter({ hasText: 'Daten wurden' })).toBeVisible();
  await expect(editor(page).getByRole('textbox', { name: 'Begründung', exact: true })).toHaveValue('Mein offener Entwurf');
  expect((await getState(page)).accountEntries?.[0].reason).toBe('Extern geändert');
  let prompt = '';
  page.once('dialog', async dialog => { prompt = dialog.message(); await dialog.dismiss(); });
  const count = writes.requests.length;
  await editor(page).getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  expect(prompt).toContain('während der Bearbeitung geändert');
  expect(writes.requests).toHaveLength(count);
  page.once('dialog', dialog => dialog.accept());
  await editor(page).getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  expect((await getState(page)).accountEntries?.[0]).toMatchObject({ id, minutes: -480, reason: 'Mein offener Entwurf' });
  writes.stop();
});

test('Accounting: export account is opt-in and CSV uses the persisted ledger', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/account/opening', 'PUT', { date: DATE, minutes: 1080 });
  await mutate(page, '/api/account/entries', 'POST', { date: DATE, kind: 'payout', minutes: -480, reason: 'Auszahlung Export' });
  await page.reload();
  await chooseWeek(page, DATE);
  await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Stundenzettel', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Stundenzettel exportieren', exact: true });
  const toggle = sheet.getByRole('checkbox', { name: 'Zeitkonto ergänzen', exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(sheet.getByRole('button', { name: 'Zeitkonto-CSV', exact: true })).toHaveCount(0);
  await expect(sheet.locator('.timesheet-document')).not.toContainText('Auszahlung Export');
  await toggle.check();
  await expect(sheet.locator('.timesheet-document')).toContainText('Auszahlung Export');
  const download = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Zeitkonto-CSV', exact: true }).click();
  const path = await (await download).path();
  expect(path).toBeTruthy();
  const csv = await readFile(path!, 'utf8');
  expect(csv).toContain('Auszahlung Export');
  expect(csv).toContain('-480');
  expect(csv).toContain('1080');
  expect(csv).toContain('600');
  await toggle.uncheck();
  await expect(sheet.locator('.timesheet-document')).not.toContainText('Auszahlung Export');
  expect((await getState(page)).accountEntries).toHaveLength(1);
});

test('Accounting: a saved holiday rule does not report its own save as a concurrent change', async ({ page }) => {
  await page.goto('/');
  await openAppAction(page, 'Einstellungen');
  await page.getByRole('tab', { name: 'Feiertage', exact: true }).click();
  const holidays = page.getByRole('region', { name: 'Feiertage', exact: true });
  page.on('dialog', dialog => dialog.accept());
  await holidays.getByLabel('Gültig ab', { exact: true }).fill(DATE);
  await holidays.getByRole('combobox', { name: 'Bundesland', exact: true }).selectOption('HE');
  await holidays.getByRole('button', { name: 'Feiertagsregel speichern', exact: true }).click();
  await expect(holidays.getByText('Gespeichert.', { exact: true })).toBeVisible();
  await holidays.getByLabel('Name des Feiertags', { exact: true }).fill('Lokaler Feiertag');
  await expect(holidays.locator('.holiday-settings-notice')).toHaveCount(0);
});
