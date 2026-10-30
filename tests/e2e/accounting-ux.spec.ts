import type { Page, Request } from '@playwright/test';
import type { AppState } from '../../shared/types.js';
import { test, expect, chooseWeek, getState } from './isolated-fixture';

const DATE = '2026-09-21';
const account = (page: Page) => page.getByRole('region', { name: 'Stundenkonto', exact: true });
const opening = (page: Page) => account(page).locator('.hours-account-opening');
const summary = (page: Page) => account(page).locator('.hours-account-opening-summary');
const editor = (page: Page) => account(page).locator('.hours-account-editor');

async function mutate(page: Page, path: string, method: string, values: object): Promise<AppState> {
  const before = await getState(page);
  const response = await page.request.fetch(path, {
    method, headers: { Origin: new URL(page.url()).origin }, data: { ...values, expectedRevision: before.revision },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function openAccount(page: Page, seeded = true) {
  await page.goto('/');
  if (seeded) {
    await mutate(page, '/api/account/opening', 'PUT', { date: DATE, minutes: 1080 });
    await page.reload();
  }
  await chooseWeek(page, DATE);
  await page.getByRole('link', { name: 'Zeitkonto', exact: true }).click();
  await expect(account(page)).toBeVisible();
}

async function editOpening(page: Page, amount: string) {
  await summary(page).getByRole('button', { name: 'Anfangsbestand ändern', exact: true }).click();
  await opening(page).getByLabel('Zeit (h:mm)', { exact: true }).fill(amount);
}

async function draftPayout(page: Page) {
  await account(page).getByRole('button', { name: 'Buchung hinzufügen', exact: true }).click();
  await editor(page).getByLabel('Datum', { exact: true }).fill(DATE);
  await editor(page).getByLabel('Zeit (h:mm)', { exact: true }).fill('3:00');
  await editor(page).getByRole('textbox', { name: 'Begründung', exact: true }).fill('Nicht verlieren');
}

function captureWrites(page: Page, prefix: string) {
  const requests: Request[] = [];
  const capture = (request: Request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith(prefix)) requests.push(request);
  };
  page.on('request', capture);
  return { requests, stop: () => page.off('request', capture) };
}

test('Accounting UX: setup folds, unchanged edit is inert and dirty cancel preserves or discards explicitly', async ({ page }) => {
  await openAccount(page, false);
  await expect(opening(page)).toBeVisible();
  await expect(summary(page)).toHaveCount(0);
  await opening(page).getByLabel('Datum', { exact: true }).fill(DATE);
  await opening(page).getByLabel('Zeit (h:mm)', { exact: true }).fill('18:00');
  await opening(page).getByRole('button', { name: 'Anfangsbestand speichern', exact: true }).click();
  await expect(opening(page)).toHaveCount(0);
  await expect(summary(page)).toContainText('+18 h');
  const edit = summary(page).getByRole('button', { name: 'Anfangsbestand ändern', exact: true });
  await expect(edit).toBeFocused();
  const saved = await getState(page);
  const writes = captureWrites(page, '/api/account/');
  await edit.click();
  await expect(opening(page).getByLabel('Datum', { exact: true })).toBeFocused();
  await expect(opening(page).getByRole('button', { name: 'Anfangsbestand speichern', exact: true })).toBeDisabled();
  await opening(page).evaluate(form => (form as HTMLFormElement).requestSubmit());
  await opening(page).getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(summary(page)).toBeVisible();
  expect(writes.requests).toEqual([]);
  await editOpening(page, '21:30');
  const prompts: string[] = [];
  page.once('dialog', async dialog => { prompts.push(dialog.message()); await dialog.dismiss(); });
  await opening(page).getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(opening(page).getByLabel('Zeit (h:mm)', { exact: true })).toHaveValue('21:30');
  page.once('dialog', async dialog => { prompts.push(dialog.message()); await dialog.accept(); });
  await opening(page).getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(summary(page)).toContainText('+18 h');
  await expect(edit).toBeFocused();
  expect(prompts).toEqual(['Ungespeicherte Änderungen verwerfen?', 'Ungespeicherte Änderungen verwerfen?']);
  await edit.click();
  await expect(opening(page).getByLabel('Zeit (h:mm)', { exact: true })).toHaveValue('18:00');
  expect(await getState(page)).toEqual(saved);
  expect(writes.requests).toEqual([]);
  writes.stop();
});

test('Accounting UX: pending opening save blocks actions and failure retains the expanded draft for retry', async ({ page }) => {
  await openAccount(page);
  await editOpening(page, '21:30');
  page.on('dialog', dialog => dialog.accept());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/account/opening', async route => {
    await gate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporär nicht verfügbar' }) });
  });
  const writes = captureWrites(page, '/api/account/opening');
  try {
    await opening(page).getByRole('button', { name: 'Anfangsbestand speichern', exact: true }).click();
    await expect(opening(page).getByLabel('Zeit (h:mm)', { exact: true })).toBeDisabled();
    await expect(opening(page).getByRole('button', { name: 'Abbrechen', exact: true })).toBeDisabled();
    await expect(account(page).getByRole('button', { name: 'Abwesenheit eintragen', exact: true })).toBeDisabled();
    await expect(account(page).getByRole('button', { name: 'Stundenzettel', exact: true })).toBeDisabled();
    await expect(page.getByRole('tab', { name: 'Auswertungen', exact: true })).toBeDisabled();
    await opening(page).evaluate(form => (form as HTMLFormElement).requestSubmit());
    expect(writes.requests).toHaveLength(1);
  } finally { release(); }
  await expect(account(page).getByRole('alert').first()).toBeVisible();
  await expect(opening(page).getByLabel('Zeit (h:mm)', { exact: true })).toHaveValue('21:30');
  await expect(summary(page)).toHaveCount(0);
  expect((await getState(page)).accountOpening?.minutes).toBe(1080);
  await page.unroute('**/api/account/opening');
  await opening(page).getByRole('button', { name: 'Anfangsbestand speichern', exact: true }).click();
  await expect(opening(page)).toHaveCount(0);
  await expect(summary(page)).toContainText('+21:30 h');
  expect((await getState(page)).accountOpening?.minutes).toBe(1290);
  expect(writes.requests).toHaveLength(2);
  writes.stop();
});

test('Accounting UX: a stale opening draft requires explicit replacement and cancel reloads the latest saved value', async ({ page }) => {
  await openAccount(page);
  await editOpening(page, '21:00');
  await mutate(page, '/api/account/opening', 'PUT', { date: DATE, minutes: 1500 });
  page.once('dialog', dialog => dialog.accept());
  await opening(page).getByRole('button', { name: 'Anfangsbestand speichern', exact: true }).click();
  await expect(account(page).getByRole('status').filter({ hasText: 'Daten wurden' })).toBeVisible();
  await expect(opening(page).getByLabel('Zeit (h:mm)', { exact: true })).toHaveValue('21:00');
  expect((await getState(page)).accountOpening?.minutes).toBe(1500);
  const writes = captureWrites(page, '/api/account/opening');
  let prompt = '';
  page.once('dialog', async dialog => { prompt = dialog.message(); await dialog.dismiss(); });
  await opening(page).getByRole('button', { name: 'Anfangsbestand speichern', exact: true }).click();
  expect(prompt).toContain('während der Bearbeitung geändert');
  expect(writes.requests).toEqual([]);
  page.once('dialog', dialog => dialog.accept());
  await opening(page).getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(summary(page)).toContainText('+25 h');
  await editOpening(page, '21:00');
  page.once('dialog', dialog => dialog.accept());
  await opening(page).getByRole('button', { name: 'Anfangsbestand speichern', exact: true }).click();
  await expect(summary(page)).toContainText('+21 h');
  expect((await getState(page)).accountOpening?.minutes).toBe(1260);
  expect(writes.requests).toHaveLength(1);
  writes.stop();
});

for (const action of [
  { button: 'Abwesenheit eintragen', dialog: 'Abwesenheiten' },
  { button: 'Stundenzettel', dialog: 'Stundenzettel exportieren' },
]) {
  test(`Accounting UX: ${action.button} uses one discard guard and keeps a declined draft`, async ({ page }) => {
    await openAccount(page);
    await draftPayout(page);
    const before = await getState(page);
    const prompts: string[] = [];
    let discard = false;
    page.on('dialog', async dialog => {
      prompts.push(dialog.message());
      if (discard) await dialog.accept(); else await dialog.dismiss();
    });
    await account(page).getByRole('button', { name: action.button, exact: true }).click();
    await expect(page.getByRole('dialog', { name: action.dialog, exact: true })).toHaveCount(0);
    await expect(editor(page).getByRole('textbox', { name: 'Begründung', exact: true })).toHaveValue('Nicht verlieren');
    expect(prompts).toEqual(['Ungespeicherte Änderungen verwerfen?']);
    discard = true;
    await account(page).getByRole('button', { name: action.button, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: action.dialog, exact: true });
    await expect(dialog).toBeVisible();
    expect(prompts).toEqual(['Ungespeicherte Änderungen verwerfen?', 'Ungespeicherte Änderungen verwerfen?']);
    if (action.button === 'Abwesenheit eintragen') await expect(dialog.getByLabel('Von', { exact: true })).toHaveValue(DATE);
    await dialog.getByRole('button', { name: 'Dialog schließen', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(account(page).getByRole('button', { name: action.button, exact: true })).toBeFocused();
    await expect(editor(page)).toHaveCount(0);
    expect(await getState(page)).toEqual(before);
  });

  test(`Accounting UX: ${action.button} keeps modal focus after discarding an edited opening balance`, async ({ page }) => {
    await openAccount(page);
    const before = await getState(page);
    await editOpening(page, '21:30');
    await opening(page).getByLabel('Datum', { exact: true }).fill('2026-09-20');
    const prompts: string[] = [];
    page.on('dialog', async dialog => { prompts.push(dialog.message()); await dialog.accept(); });
    const trigger = account(page).getByRole('button', { name: action.button, exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: action.dialog, exact: true });
    await expect(dialog).toBeVisible();
    await expect(opening(page)).toHaveCount(0);
    expect(prompts).toEqual(['Ungespeicherte Änderungen verwerfen?']);
    const initialFocus = action.button === 'Abwesenheit eintragen'
      ? dialog.getByLabel('Von', { exact: true })
      : dialog.getByRole('button', { name: 'Dialog schließen', exact: true });
    await expect(initialFocus).toBeFocused();
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await dialog.getByRole('button', { name: 'Dialog schließen', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(summary(page)).toContainText('+18 h');
    expect(await getState(page)).toEqual(before);
  });
}

test('Accounting UX: a new payout survives an external revision and retries once without replacing other entries', async ({ page }) => {
  await openAccount(page);
  await draftPayout(page);
  await mutate(page, '/api/account/entries', 'POST', { date: DATE, kind: 'correction', minutes: 60, reason: 'Extern erfasst' });
  const writes = captureWrites(page, '/api/account/entries');
  await editor(page).getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(account(page).getByRole('alert').first()).toBeVisible();
  await expect(editor(page).getByRole('textbox', { name: 'Begründung', exact: true })).toHaveValue('Nicht verlieren');
  expect((await getState(page)).accountEntries).toEqual([expect.objectContaining({ reason: 'Extern erfasst' })]);
  await editor(page).getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  const entries = (await getState(page)).accountEntries;
  expect(entries).toHaveLength(2);
  expect(entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'correction', minutes: 60, reason: 'Extern erfasst' }),
    expect.objectContaining({ kind: 'payout', minutes: -180, reason: 'Nicht verlieren' }),
  ]));
  expect(writes.requests).toHaveLength(2);
  expect(writes.requests[1].postDataJSON().expectedRevision).toBeGreaterThan(writes.requests[0].postDataJSON().expectedRevision);
  writes.stop();
});

test('Accounting UX: reports and export sum vacation, sickness and holidays while compensation stays outside credits', async ({ page }) => {
  await page.goto('/');
  await mutate(page, '/api/profiles', 'POST', { effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] });
  await mutate(page, '/api/account/opening', 'PUT', { date: DATE, minutes: 1080 });
  await mutate(page, '/api/holiday-overrides/2026-09-23', 'PUT', { name: 'Lokaler Feiertag' });
  await mutate(page, '/api/absences', 'PUT', { days: [
    { date: DATE, vacationFraction: 0.5, sickness: true, compensation: { mode: 'minutes', value: 120 } },
    { date: '2026-09-22', vacationFraction: 0, sickness: true, compensation: null },
    { date: '2026-09-24', vacationFraction: 0, sickness: false, compensation: { mode: 'fraction', value: 1 } },
    { date: '2026-09-25', vacationFraction: 1, sickness: false, compensation: null },
  ] });
  await mutate(page, `/api/weeks/${DATE}`, 'POST', { status: 'closed', confirmWarnings: true });
  await page.reload();
  await chooseWeek(page, DATE);
  await page.getByRole('link', { name: 'Zeitkonto', exact: true }).click();
  await page.getByRole('tab', { name: 'Auswertungen', exact: true }).click();
  const confirmed = page.locator('.reports-confirmed');
  const credits = confirmed.locator('.reports-totals > div').filter({ has: page.locator('dt', { hasText: /^Gutschriften$/ }) });
  await expect(credits.locator('dd')).toHaveText('30 h');
  await expect(confirmed.locator('.reports-balance > strong')).toHaveText('−10 h');
  const breakdown = page.locator('.reports-credit-breakdown[aria-label="Im Saldo enthaltene Gutschriften"]');
  for (const [label, value] of [['Urlaub', '12 h'], ['Krankheit', '10 h'], ['Feiertage', '8 h']]) {
    await expect(breakdown.locator('div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')).toHaveText(value);
  }
  await page.locator('.reports-export').click();
  const sheet = page.getByRole('dialog', { name: 'Stundenzettel exportieren', exact: true });
  const table = sheet.locator('.timesheet-table');
  await expect(table.getByRole('columnheader', { name: 'Gutschriften', exact: true })).toBeVisible();
  for (const [date, credit, balance] of [
    [DATE, '6:00', '−2:00'], ['2026-09-22', '8:00', '0:00'], ['2026-09-23', '8:00', '0:00'],
    ['2026-09-24', '0:00', '−8:00'], ['2026-09-25', '8:00', '0:00'],
  ]) {
    const row = table.locator(`[data-timesheet-day="${date}"]`);
    await expect(row.locator('td').nth(2)).toHaveText(credit);
    await expect(row.locator('td').nth(4)).toHaveText(balance);
  }
  await expect(table.locator('tfoot tr').first().locator('td').nth(1)).toHaveText('30:00');
  await expect(table.locator('[data-timesheet-day="2026-09-24"] .timesheet-absence')).toContainText('Freizeitausgleich');
});
