import { join } from 'node:path';
import { test, expect, chooseWeek, getState, newBlock, previewImport, unchangedImportResult } from './isolated-fixture';

test('published example: import, draw/edit, close, monthly/quarterly/yearly totals, restart and restore', async ({ page, localApp }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:')) externalRequests.push(request.url()); });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await expect(page.getByText('Rechts im Kalender ziehen', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Importieren', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles('examples/activities.json');
  await previewImport(page);
  await expect(page.locator('.preview-stats')).toContainText('13 neu');
  await expect(page.locator('.preview-stats')).toContainText('0 Fehler');
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await expect(page.getByRole('dialog', { name: 'Aktivitäten importieren' })).toContainText('13');
  await page.getByRole('dialog', { name: 'Aktivitäten importieren' }).getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await getState(page)).activities).toHaveLength(13);
  expect((await getState(page)).blocks).toHaveLength(0);

  await page.getByRole('button', { name: 'Importieren', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles('examples/activities.csv');
  await previewImport(page);
  await expect(page.locator('.preview-stats')).toContainText('13 unverändert');
  await unchangedImportResult(page);
  await page.getByRole('button', { name: 'Zeitraum öffnen' }).click();

  // Start with a real mouse gesture; save its exact duration in quick capture.
  const mondayLane = page.locator('[data-work-lane][data-date="2026-09-28"]');
  const lane = await mondayLane.boundingBox();
  if (!lane) throw new Error('Missing Monday work lane');
  await page.mouse.move(lane.x + lane.width / 2, lane.y + 8 * 56);
  await page.mouse.down();
  await page.mouse.move(lane.x + lane.width / 2, lane.y + 10 * 56, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
  expect((await getState(page)).blocks).toHaveLength(0);
  await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(mondayLane.locator('[data-work-block]')).toHaveCount(1);
  await mondayLane.locator('[data-work-block]').focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Ende · Uhrzeit').fill('17:00');
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const [day, end] of [['2026-09-29', '16:00'], ['2026-09-30', '18:00'], ['2026-10-01', '16:00'], ['2026-10-02', '15:00'], ['2026-10-03', '10:00']]) {
    await newBlock(page, day, '08:00', end, 'Synthetisches Rechenbeispiel');
  }
  const summary = page.getByRole('region', { name: 'Wochenbilanz' });
  await expect(summary.locator('.summary-item').nth(0)).toContainText('44 h');
  await expect(summary.locator('.summary-item').nth(2)).toContainText('+4 h');
  for (const [index, hours] of [9, 8, 10, 8, 7, 2, 0].entries()) {
    await expect(page.locator('.ov-day-totals').nth(index)).toContainText(`Ist ${hours}:00 h`);
  }
  await page.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  const closeConfirmation = page.getByRole('dialog', { name: 'Woche abschließen', exact: true });
  await expect(closeConfirmation.locator('form')).toHaveAttribute('aria-busy', 'false');
  for (const checkbox of await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect(page.locator('.status-pill')).toHaveText('Abgeschlossen');
  await expect(summary.locator('.summary-item').nth(3)).toContainText('+3 h');
  await page.screenshot({ path: testInfo.outputPath('example-desktop.png') });
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Zeitkonto', exact: true }).click();
  await expect(page.locator('.period-nav:visible')).toContainText('September 2026');
  await expect(page.locator('.reports-balance strong')).toHaveText('+3 h');
  await page.getByRole('button', { name: 'Nächster Zeitraum', exact: true }).click();
  await expect(page.locator('.period-nav:visible')).toContainText('Oktober 2026');
  await expect(page.locator('.reports-balance strong')).toHaveText('+1 h');
  await page.getByRole('button', { name: 'Quartal', exact: true }).click();
  await expect(page.locator('.period-nav:visible')).toContainText('4. Quartal 2026');
  await expect(page.locator('.reports-balance strong')).toHaveText('+1 h');
  await page.getByRole('button', { name: 'Vorheriger Zeitraum', exact: true }).click();
  await expect(page.locator('.reports-balance strong')).toHaveText('+3 h');
  await page.getByRole('button', { name: 'Jahr', exact: true }).click();
  await expect(page.locator('.reports-balance strong')).toHaveText('+4 h');
  await page.screenshot({ path: testInfo.outputPath('example-year.png') });
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Kalender', exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const scroll = page.locator('.ov-calendar-scroll');
  expect(await scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('example-mobile.png') });
  await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(page.locator('[data-calendar-day="2026-10-04"] .ov-day-date')).toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await scroll.evaluate(element => { element.scrollLeft = 0; });

  const original = await getState(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'SQLite-Backup herunterladen' }).click();
  const backupPath = join(localApp.directory, 'restored.sqlite');
  await (await downloading).saveAs(backupPath);
  await localApp.restart();
  await page.goto(localApp.url);
  await chooseWeek(page, '2026-09-28');
  expect(await getState(page)).toEqual(original);
  await expect(page.locator('.status-pill')).toHaveText('Abgeschlossen');
  await localApp.restart(backupPath);
  await page.goto(localApp.url);
  await chooseWeek(page, '2026-09-28');
  expect(await getState(page)).toEqual(original);
  await expect(page.locator('.summary-item').nth(2)).toContainText('+4 h');

  // Updating a closed block must explicitly reopen it and remove confirmed totals.
  await page.locator('[data-work-block]').first().focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Ende · Uhrzeit').fill('18:00');
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.status-pill')).toHaveText('Vorläufig');
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Zeitkonto', exact: true }).click();
  await expect(page.locator('.reports-confirmed small')).toContainText('0 abgeschlossene Wochen');
  await page.locator('.reports-open-weeks summary').click();
  await expect(page.locator('.reports-open-weeks')).toContainText('28.09.2026');
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
