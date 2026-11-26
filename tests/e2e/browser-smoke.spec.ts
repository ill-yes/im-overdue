import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { test, expect, password } from './auth-fixture';

test('password login, recorded work and CSV export survive a browser roundtrip', async ({ page, authApp }) => {
  await page.goto(authApp.url);
  await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
  expect((await page.request.get(`${authApp.url}/api/state`)).status()).toBe(401);

  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
  await page.getByLabel('Woche über Datum wählen').fill('2026-09-28');
  await expect(page.locator('[data-calendar-day="2026-09-28"]')).toBeVisible();

  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  await page.getByLabel('Beginn · Datum').fill('2026-09-28');
  await page.getByLabel('Ende · Datum').fill('2026-09-28');
  await page.getByLabel('Beginn · Uhrzeit').fill('09:00');
  await page.getByLabel('Ende · Uhrzeit').fill('10:00');
  await page.getByRole('dialog').getByLabel('Tätigkeit', { exact: false }).fill('Browser smoke work');
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
  await page.getByLabel('Woche über Datum wählen').fill('2026-09-28');
  await expect(page.locator('[data-work-block]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Stundenzettel', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Stundenzettel exportieren', exact: true });
  await sheet.getByRole('group', { name: 'Zeitraumart' }).getByRole('button', { name: 'Woche', exact: true }).click();
  await sheet.getByLabel('Datum in der Woche', { exact: true }).fill('2026-09-28');
  await sheet.getByRole('checkbox', { name: 'Nur abgeschlossene Wochen', exact: true }).uncheck();
  const preview = sheet.getByRole('region', { name: 'Exportvorschau', exact: true });
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).toContainText('Browser smoke work');

  const downloaded = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'CSV', exact: true }).click();
  const path = await (await downloaded).path();
  if (!path) throw new Error('Missing browser smoke CSV download');
  const rows = parse(await readFile(path), { bom: true, columns: true, delimiter: ';' }) as Record<string, string>[];
  const monday = rows.find(row => row.Datum === '2026-09-28');
  expect(monday?.['Ist (Minuten)']).toBe('60');
  expect(monday?.Titel).toContain('Browser smoke work');

  await sheet.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
  expect((await page.request.get(`${authApp.url}/api/state`)).status()).toBe(401);
});
