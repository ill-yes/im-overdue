import { seedGermanLanguage } from './language-fixture';
import type { Page } from '@playwright/test';
import { test, expect, chooseWeek, getState, newBlock, openSourceFilters, previewImport } from './isolated-fixture';
import type { AppState } from '../../shared/types.js';

async function showMonth(page: Page, month?: string) {
  await page.getByRole('group', { name: 'Kalenderansicht' }).getByRole('button', { name: 'Monat', exact: true }).click();
  if (month) await page.getByLabel('Monat wählen', { exact: true }).fill(month);
  await expect(page.getByRole('region', { name: 'Monatskalender', exact: true })).toBeVisible();
}
async function mutate(page: Page, path: string, method: string, values: object): Promise<AppState> {
  return page.evaluate(async ({ path, method, values }) => {
    const current = await (await fetch('/api/state')).json();
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: current.revision, ...values }) });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body;
  }, { path, method, values });
}

test('month grid, month-first navigation, today, leap years and adjacent dates', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Kalender', exact: true })).toBeVisible();
  await chooseWeek(page, '2026-01-31');
  await showMonth(page);
  await expect(page.getByLabel('Monat wählen', { exact: true })).toHaveValue('2026-01');
  await page.getByRole('button', { name: 'Nächster Monat', exact: true }).click();
  await expect(page.getByLabel('Monat wählen', { exact: true })).toHaveValue('2026-02');
  await page.getByRole('button', { name: 'Nächster Monat', exact: true }).click();
  await expect(page.getByLabel('Monat wählen', { exact: true })).toHaveValue('2026-03');
  await page.getByRole('button', { name: 'Vorheriger Monat', exact: true }).click();
  await expect(page.getByLabel('Monat wählen', { exact: true })).toHaveValue('2026-02');
  await page.getByLabel('Monat wählen', { exact: true }).fill('2026-08');
  await expect(page.locator('[data-month-day]')).toHaveCount(42);
  await expect(page.locator('[data-month-day="2026-07-27"]')).toHaveAttribute('data-in-month', 'false');
  await expect(page.locator('[data-month-day="2026-09-06"]')).toHaveAttribute('data-in-month', 'false');
  await page.screenshot({ path: testInfo.outputPath('six-week-empty.png') });
  await page.getByLabel('Monat wählen', { exact: true }).fill('2027-02');
  await expect(page.locator('[data-month-day]')).toHaveCount(28);
  await page.getByLabel('Monat wählen', { exact: true }).fill('2028-02');
  await expect(page.locator('[data-month-day]')).toHaveCount(35);
  await expect(page.locator('[data-month-day="2028-02-29"]')).toHaveAttribute('data-in-month', 'true');
  await page.getByRole('button', { name: 'Heute', exact: true }).click();
  await expect(page.getByLabel('Monat wählen', { exact: true })).toHaveValue('2026-10');
  await expect(page.locator('[data-month-day="2026-10-15"]')).toHaveAttribute('aria-current', 'date');
  await expect(page.getByRole('button', { name: 'Woche abschließen', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-calendar-day]')).toHaveCount(0);
  expect((await getState(page)).revision).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Kalender', exact: true })).toBeVisible();
});

test('day selection preserves month/year and focuses the correct week day', async ({ page }) => {
  await page.goto('/');
  for (const [month, day, monday] of [['2026-10', '2026-10-01', '2026-09-28'], ['2027-01', '2027-01-01', '2026-12-28']]) {
    await showMonth(page, month);
    const selected = page.locator(`[data-month-day="${day}"]`);
    await selected.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue(day);
    await expect(page.locator('[data-calendar-day]').first()).toHaveAttribute('data-calendar-day', monday);
    const heading = page.locator(`[data-calendar-day="${day}"] .ov-calendar-dayhead`);
    await expect(heading).toBeFocused();
    await expect(page.locator(`[data-calendar-day="${day}"]`)).toHaveAttribute('data-selected-day', 'true');
    await expect(page.locator('[data-month-day]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
    await expect(page.getByLabel('Beginn · Datum')).toHaveValue(day);
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await showMonth(page);
    await expect(page.getByLabel('Monat wählen', { exact: true })).toHaveValue(month);
  }
  await showMonth(page, '2026-10');
  await page.locator('[data-month-day="2026-09-28"]').click();
  await showMonth(page);
  await expect(page.getByLabel('Monat wählen', { exact: true })).toHaveValue('2026-09');
});

test('example monthly balances, imported activity filters and reopened weeks', async ({ page }, testInfo) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await page.getByRole('button', { name: 'Importieren', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles('examples/activities.json');
  await previewImport(page);
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await page.getByRole('dialog', { name: 'Aktivitäten importieren' }).getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await showMonth(page, '2026-10');
  const first = page.locator('[data-month-day="2026-10-01"]');
  await expect(first).toHaveAttribute('data-day-status', 'untouched');
  await expect(first.locator('.mo-day-times')).toContainText('Ist 0 h');
  await expect(first.locator('.mo-day-balance strong')).toHaveText('—');
  await expect(first.locator('.mo-day-activity')).toContainText('4 Aktivitäten');
  await page.locator('[data-month-day="2026-09-28"]').click();
  for (const [day, end] of [['2026-09-28', '17:00'], ['2026-09-29', '16:00'], ['2026-09-30', '18:00'], ['2026-10-01', '16:00'], ['2026-10-02', '15:00'], ['2026-10-03', '10:00']]) {
    await newBlock(page, day, '08:00', end);
  }
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  const closeConfirmation = page.getByRole('dialog', { name: 'Woche abschließen', exact: true });
  await expect(closeConfirmation.locator('form')).toHaveAttribute('aria-busy', 'false');
  for (const checkbox of await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect(page.locator('.status-pill')).toHaveText('Abgeschlossen');
  await showMonth(page, '2026-09');
  const summary = page.getByRole('region', { name: 'Monatsbilanz' });
  await expect(summary.locator('.summary-item').nth(0)).toContainText('27 h');
  await expect(summary.locator('.summary-item').nth(1)).toContainText('+3 h');
  await page.getByRole('button', { name: 'Nächster Monat', exact: true }).click();
  await expect(summary.locator('.summary-item').nth(0)).toContainText('17 h');
  await expect(summary.locator('.summary-item').nth(1)).toContainText('+1 h');
  await expect(summary.locator('.summary-item').nth(2).locator('strong')).toHaveText('—');
  await expect(first).toHaveAttribute('data-day-status', 'closed');
  await expect(page.locator('[data-month-day="2026-10-03"] .mo-day-balance strong')).toHaveText('+2 h');
  await expect(page.locator('[data-month-day="2026-10-05"]')).toHaveAttribute('data-day-status', 'untouched');
  await page.screenshot({ path: testInfo.outputPath('month-desktop.png') });
  const monthlyTotals = await summary.innerText();
  await openSourceFilters(page);
  await page.getByRole('checkbox', { name: 'Slack', exact: true }).uncheck();
  await expect(first.locator('.mo-day-activity')).toContainText('2 Aktivitäten');
  expect(await summary.innerText()).toBe(monthlyTotals);
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Zeitkonto', exact: true }).click();
  await expect(page.locator('.period-nav:visible')).toContainText('Oktober 2026');
  await expect(page.locator('.reports-balance strong')).toHaveText('+1 h');
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Kalender', exact: true }).click();
  await first.click();
  await openSourceFilters(page);
  await expect(page.getByRole('checkbox', { name: 'Slack', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Woche wieder öffnen', exact: true }).click();
  await expect(page.locator('.status-pill')).toHaveText('Vorläufig');
  await showMonth(page);
  await expect(page.getByLabel('Monat wählen', { exact: true })).toHaveValue('2026-10');
  await expect(first).toHaveAttribute('data-day-status', 'open');
  await expect(summary.locator('.summary-item').nth(1).locator('strong')).toHaveText('—');
  await expect(summary.locator('.summary-item').nth(2)).toContainText('+1 h');
  await expect(summary.locator('.summary-item').nth(3).locator('strong')).toHaveText('1');
});

test('mobile month scrolls internally and reveals the selected Sunday for time entry', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await showMonth(page, '2026-10');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const monthScroll = page.locator('.mo-calendar-scroll');
  expect(await monthScroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  const sunday = page.locator('[data-month-day="2026-10-04"]');
  expect((await sunday.boundingBox())!.width).toBeGreaterThanOrEqual(120);
  await monthScroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await sunday.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('month-mobile.png') });
  await sunday.click();
  const weekSunday = page.locator('[data-calendar-day="2026-10-04"]');
  await expect(weekSunday.locator('.ov-day-date')).toBeInViewport();
  await expect(weekSunday.locator('.ov-calendar-dayhead')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('week-selected-mobile.png') });
  await weekSunday.getByRole('button', { name: 'Zeit am 4. Okt. 2026 eintragen' }).click();
  await expect(page.getByLabel('Beginn · Datum')).toHaveValue('2026-10-04');
  await page.getByLabel('Beginn · Uhrzeit').fill('08:07');
  await page.getByLabel('Ende · Uhrzeit').fill('09:23');
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await showMonth(page);
  await expect(page.locator('[data-month-day="2026-10-04"] .mo-day-balance strong')).toHaveText('+1:16 h');
});

test('touch selection opens Sunday and mouse drawing still works after a month-to-week switch', async ({ page, browser, localApp }) => {
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await seedGermanLanguage(touch);
  try {
    const mobile = await touch.newPage();
    await mobile.goto(localApp.url);
    await showMonth(mobile, '2026-10');
    const day = mobile.locator('[data-month-day="2026-10-04"]');
    await day.tap();
    const heading = mobile.locator('[data-calendar-day="2026-10-04"] .ov-calendar-dayhead');
    await expect(heading).toBeInViewport();
    await heading.getByRole('button', { name: /Zeit am .* eintragen/ }).tap();
    await expect(mobile.getByLabel('Beginn · Datum')).toHaveValue('2026-10-04');
    await mobile.getByLabel('Ende · Uhrzeit').fill('10:00');
    await mobile.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).tap();
    await expect(mobile.getByRole('dialog')).toHaveCount(0);
    expect((await getState(mobile)).blocks).toHaveLength(1);
  } finally { await touch.close(); }

  await page.goto('/');
  await showMonth(page, '2026-10');
  await page.locator('[data-month-day="2026-10-01"]').click();
  const lane = page.locator('[data-work-lane][data-date="2026-10-01"]');
  const box = await lane.boundingBox();
  if (!box) throw new Error('Missing selected work lane');
  await page.mouse.move(box.x + box.width / 2, box.y + 9 * 56);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 10 * 56, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(lane.locator('[data-work-block]')).toHaveCount(1);
  await showMonth(page);
  await expect(page.locator('[data-month-day="2026-10-01"] .mo-day-times')).toContainText('Ist 1 h');
});

test('timezone month boundary and DST work use the configured zone, not the computer zone', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-31T23:30:00Z'));
  await page.goto('/');
  await mutate(page, '/api/import/commit', 'POST', { format: 'json', text: JSON.stringify({ schemaVersion: 1, activities: [
    { source: 'slack', id: 'month:boundary', title: 'Grenzpunkt', start: '2026-10-31T23:30:00Z' },
  ] }) });
  await mutate(page, '/api/settings', 'PUT', { timezone: 'America/New_York' });
  await page.reload();
  await showMonth(page);
  await expect(page.getByLabel('Monat wählen', { exact: true })).toHaveValue('2026-10');
  await expect(page.locator('[data-month-day="2026-10-31"]')).toHaveAttribute('aria-current', 'date');
  await expect(page.locator('[data-month-day="2026-10-31"] .mo-day-activity')).toContainText('1 Aktivität');
  await mutate(page, '/api/settings', 'PUT', { timezone: 'Europe/Berlin' });
  await mutate(page, '/api/blocks', 'POST', { start: '2026-10-24T22:00:00Z', end: '2026-10-25T23:00:00Z', note: '25 reale Stunden' });
  await page.reload();
  await showMonth(page);
  await expect(page.getByLabel('Monat wählen', { exact: true })).toHaveValue('2026-11');
  await expect(page.locator('[data-month-day="2026-11-01"]')).toHaveAttribute('aria-current', 'date');
  await expect(page.locator('[data-month-day="2026-11-01"] .mo-day-activity')).toContainText('1 Aktivität');
  await page.getByLabel('Monat wählen', { exact: true }).fill('2026-10');
  await expect(page.locator('[data-month-day="2026-10-25"] .mo-day-times')).toContainText('Ist 25 h');
  await expect(page.locator('[data-month-day="2026-10-26"]')).toHaveAttribute('data-day-status', 'untouched');
});
