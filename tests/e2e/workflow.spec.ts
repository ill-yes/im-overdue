import type { Page } from '@playwright/test';
import { seedGermanLanguage, test, expect } from './language-fixture';
import { openBlockNote, openAppAction, previewImport, unchangedImportResult } from './isolated-fixture';
import { readFile } from 'node:fs/promises';
import type { AppState } from '../../shared/types.js';
import { minutesBetween } from '../../shared/time.js';

async function getState(page: Page): Promise<AppState> {
  return page.evaluate(async () => (await fetch('/api/state')).json());
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
async function chooseWeek(page: Page, date: string) {
  await page.getByLabel('Woche über Datum wählen').fill(date);
  await expect(page.locator(`[data-calendar-day="${date}"]`)).toBeVisible();
}
async function setScroll(page: Page, minute: number) {
  await page.locator('.ov-calendar-scroll').evaluate((element, minute) => { element.scrollTop = minute * 56 / 60; }, minute);
}
async function lanePoint(page: Page, date: string, minute: number) {
  const lane = page.locator(`[data-work-lane][data-date="${date}"]`);
  const box = await lane.boundingBox();
  if (!box) throw Error('No work lane');
  return { x: box.x + box.width / 2, y: box.y + minute * 56 / 60 };
}
async function draw(page: Page, date: string, from: number, to: number) {
  const start = await lanePoint(page, date, from);
  const end = await lanePoint(page, date, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

test.describe.serial('personal local time-account workflow', () => {
  test('empty state, JSON/CSV preview and idempotent imports', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Kalender', exact: true })).toBeVisible();
    await expect(page.getByText('Rechts im Kalender ziehen', { exact: false })).toBeVisible();
    await chooseWeek(page, '2026-09-28');
    await page.getByRole('button', { name: 'Importieren', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles('examples/activities.json');
    await previewImport(page);
    await expect(page.getByRole('region', { name: 'Importvorschau' })).toContainText('13');
    await expect(page.getByRole('button', { name: 'Import bestätigen' })).toBeEnabled();
    await page.getByRole('button', { name: 'Import bestätigen' }).click();
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
    await page.reload();
    expect((await getState(page)).activities).toHaveLength(13);
    expect(errors).toEqual([]);
  });

  test('invalid imports are previewed without partially writing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Importieren', exact: true }).click();
    const parsed = JSON.parse(await readFile('examples/activities.json', 'utf8'));
    parsed.activities[0].url = 'javascript:alert(1)';
    await page.getByRole('button', { name: 'Daten einfügen', exact: true }).click();
    await page.getByLabel('Daten einfügen', { exact: true }).fill(JSON.stringify(parsed));
    await page.getByRole('button', { name: 'Datei prüfen', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Datei korrigieren');
    await expect(page.getByRole('button', { name: 'Vorschau prüfen', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Import bestätigen' })).toHaveCount(0);
    expect((await getState(page)).activities).toHaveLength(13);
  });

  test('drag creates, moves, resizes and cancels; keyboard editor persists after reload', async ({ page }) => {
    await page.goto('/');
    await chooseWeek(page, '2026-09-28');
    await draw(page, '2026-09-28', 480, 600);
    await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
    expect((await getState(page)).blocks).toHaveLength(0);
    await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.locator('[data-work-block]')).toHaveCount(1);
    let state = await getState(page);
    expect(minutesBetween(state.blocks[0].start, state.blocks[0].end)).toBe(120);
    const first = page.locator('[data-work-block]').first();
    const handle = first.locator('[data-resize-end]');
    const box = await handle.boundingBox();
    if (!box) throw Error('No resize handle');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const eleven = await lanePoint(page, '2026-09-28', 660);
    await page.mouse.move(eleven.x, eleven.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => minutesBetween((await getState(page)).blocks[0].start, (await getState(page)).blocks[0].end)).toBe(180);
    const origin = await lanePoint(page, '2026-09-28', 540);
    const target = await lanePoint(page, '2026-09-29', 540);
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('[data-work-lane][data-date="2026-09-29"] [data-work-block]')).toHaveCount(1);
    state = await getState(page);
    expect(state.blocks[0].start).toBe('2026-09-29T06:00:00Z');
    const cancelStart = await lanePoint(page, '2026-09-30', 480);
    const cancelEnd = await lanePoint(page, '2026-09-30', 600);
    await page.mouse.move(cancelStart.x, cancelStart.y);
    await page.mouse.down();
    await page.mouse.move(cancelEnd.x, cancelEnd.y, { steps: 5 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect((await getState(page)).blocks).toHaveLength(1);
    await page.locator('[data-work-block]').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toContainText('Arbeitszeit bearbeiten');
    await openBlockNote(page);
    await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Browser-Pruefung');
    await page.getByLabel('Ende · Uhrzeit').fill('12:00');
    await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    state = await getState(page);
    expect(state.blocks[0].note).toBe('Browser-Pruefung');
    expect(minutesBetween(state.blocks[0].start, state.blocks[0].end)).toBe(240);
  });

  test('week closure, conflict-safe edit and period reports', async ({ page }) => {
    await page.goto('/');
    await chooseWeek(page, '2026-09-28');
    page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
    const closeConfirmation = page.getByRole('dialog', { name: 'Woche abschließen', exact: true });
    await expect(closeConfirmation.locator('form')).toHaveAttribute('aria-busy', 'false');
    for (const checkbox of await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('checkbox').all()) await checkbox.check();
    await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('button', { name: 'Woche abschließen', exact: true }).click();
    await expect(page.locator('.status-pill')).toHaveText('Abgeschlossen');
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Zeitkonto', exact: true }).click();
    await expect(page.locator('.reports-confirmed')).toContainText('1 abgeschlossene Woche');
    await page.getByRole('button', { name: 'Quartal', exact: true }).click();
    await expect(page.locator('.period-nav:visible')).toContainText('2026');
    await page.getByRole('button', { name: 'Jahr', exact: true }).click();
    await expect(page.locator('.reports-confirmed')).toContainText('36 h');
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Kalender', exact: true }).click();
    await page.locator('[data-work-block]').focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Ende · Uhrzeit').fill('13:00');
    await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.status-pill')).toHaveText('Vorläufig');
  });

  test('DST real-hour drag, distinct repeated times, editor preserves the selected fold', async ({ page }) => {
    await page.goto('/');
    await chooseWeek(page, '2026-10-19');
    await setScroll(page, 0);
    const sunday = page.locator('[data-calendar-day="2026-10-25"]');
    await expect(sunday).toContainText('25 reale Std.');
    await expect(sunday.locator('.ov-time-labels')).toContainText('+02:00');
    await expect(sunday.locator('.ov-time-labels')).toContainText('+01:00');
    await draw(page, '2026-10-25', 120, 240);
    await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(sunday.locator('[data-work-block]')).toHaveCount(1);
    const created = (await getState(page)).blocks.find(b => b.start === '2026-10-25T00:00:00Z');
    expect(created).toBeDefined();
    expect(minutesBetween(created!.start, created!.end)).toBe(120);
    await mutate(page, `/api/blocks/${created!.id}`, 'PUT', { start: '2026-10-25T01:00:00Z', end: '2026-10-25T02:00:00Z', note: 'Zweites Vorkommen' });
    await page.reload();
    await chooseWeek(page, '2026-10-19');
    await setScroll(page, 0);
    await sunday.locator('[data-work-block]').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Beginn liegt zweimal vor')).toHaveValue('later');
    await openBlockNote(page);
    await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Nur Notiz geaendert');
    await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await getState(page)).blocks.find(b => b.id === created!.id)?.start).toBe('2026-10-25T01:00:00Z');
    await chooseWeek(page, '2026-03-23');
    await setScroll(page, 0);
    const spring = page.locator('[data-calendar-day="2026-03-29"]');
    await expect(spring).toContainText('23 reale Std.');
    await draw(page, '2026-03-29', 60, 180);
    await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(spring.locator('[data-work-block]')).toHaveCount(1);
    const springBlock = (await getState(page)).blocks.find(b => b.start === '2026-03-29T00:00:00Z');
    expect(springBlock?.end).toBe('2026-03-29T02:00:00Z');
  });

  test('desktop and mobile layout, source detail and saved settings', async ({ page }, testInfo) => {
    await page.goto('/');
    await chooseWeek(page, '2026-09-28');
    await page.screenshot({ path: testInfo.outputPath('desktop-calendar.png') });
    const activity = page.locator('.ov-activity').filter({ hasText: 'Wochenplanung' }).first();
    await activity.click();
    await expect(page.getByRole('dialog', { name: 'Aktivitätsdetails' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({ width: window.innerWidth, body: document.documentElement.scrollWidth }));
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.width + 1);
    await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await openAppAction(page, 'Einstellungen');
    await expect(page.getByText('Profilverlauf', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Schließen', exact: true }).last().click();
    await page.screenshot({ path: testInfo.outputPath('mobile-calendar.png') });
  });

  test('actual revision conflicts preserve the form and never overwrite a concurrent change', async ({ page }) => {
    await page.goto('/');
    await chooseWeek(page, '2026-09-28');
    const block = (await getState(page)).blocks.find(b => b.start === '2026-09-29T06:00:00Z')!;
    await page.locator(`[data-work-block="${block.id}"]`).focus();
    await page.keyboard.press('Enter');
    await openBlockNote(page);
    await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Lokale ungespeicherte Eingabe');
    await mutate(page, `/api/blocks/${block.id}`, 'PUT', { start: block.start, end: block.end, note: 'Aenderung aus zweitem Tab' });
    await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('zwischenzeitlich geändert');
    await expect(page.getByRole('textbox', { name: 'Notiz optional', exact: true })).toHaveValue('Lokale ungespeicherte Eingabe');
    expect((await getState(page)).blocks.find(b => b.id === block.id)?.note).toBe('Aenderung aus zweitem Tab');
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
    await page.getByLabel('Beginn · Datum').fill('2026-09-29');
    await page.getByLabel('Ende · Datum').fill('2026-09-29');
    await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Arbeitsblöcke dürfen sich nicht überschneiden.');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('file-reading race cannot re-use the previous file preview', async ({ page }) => {
    await page.addInitScript(() => {
      const original = File.prototype.text;
      File.prototype.text = function () {
        const file = this;
        return new Promise<string>((resolve, reject) => {
          (window as unknown as { releaseFile: () => void }).releaseFile = () => { void original.call(file).then(resolve, reject); };
        });
      };
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Importieren', exact: true }).click();
    await page.getByRole('button', { name: 'Daten einfügen', exact: true }).click();
    await page.getByLabel('Daten einfügen', { exact: true }).fill(JSON.stringify({ schemaVersion: 1, activities: [{ source: 'other', id: 'never-import-this', title: 'Alte Datei', start: '2026-09-28T07:00:00Z' }] }));
    await previewImport(page);
    await expect(page.getByRole('button', { name: 'Import bestätigen' })).toBeEnabled();
    await page.getByRole('button', { name: 'Zuordnung bearbeiten', exact: true }).click();
    await page.getByRole('button', { name: 'Eingabe bearbeiten', exact: true }).click();
    await page.getByRole('button', { name: 'Datei auswählen', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles('examples/activities.json');
    await expect(page.getByText('Datei wird gelesen …')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Datei prüfen', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Import bestätigen' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Importvorschau' })).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { releaseFile: () => void }).releaseFile());
    await expect(page.locator('.file-drop')).toContainText('activities.json');
    await expect(page.getByRole('button', { name: 'Import bestätigen' })).toHaveCount(0);
    await previewImport(page);
    await expect(page.locator('.preview-stats')).toContainText('13 unverändert');
    await expect(page.getByRole('region', { name: 'Importvorschau' })).not.toContainText('Alte Datei');
    expect((await getState(page)).activities.some(a => a.id === 'never-import-this')).toBe(false);
  });

  test('five-minute edge blocks remain within the displayed day when resized', async ({ page }) => {
    await page.goto('/');
    await mutate(page, '/api/blocks', 'POST', { start: '2026-02-02T00:00:00+01:00', end: '2026-02-02T00:05:00+01:00', note: 'Anfang' });
    await mutate(page, '/api/blocks', 'POST', { start: '2026-02-02T23:55:00+01:00', end: '2026-02-03T00:00:00+01:00', note: 'Ende' });
    await page.reload();
    await chooseWeek(page, '2026-02-02');
    await page.locator('.ov-calendar-scroll').scrollIntoViewIfNeeded();
    await setScroll(page, 0);
    const startBlockId = (await getState(page)).blocks.find(b => b.note === 'Anfang')!.id;
    const beginning = page.locator(`[data-work-block="${startBlockId}"]`);
    const top = await beginning.locator('[data-resize-start]').boundingBox();
    if (!top) throw Error('Missing start handle');
    await page.mouse.move(top.x + top.width / 2, top.y + 2);
    await page.mouse.down();
    const target = await lanePoint(page, '2026-02-02', 30);
    await page.mouse.move(target.x, target.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await getState(page)).blocks.find(b => b.note === 'Anfang')?.start).toBe('2026-02-01T23:04:00Z');
    await expect(beginning).toHaveAttribute('data-start', '2026-02-01T23:04:00Z');
    await setScroll(page, 1440);
    const ending = page.locator('[data-work-block]').filter({ hasText: '23:55' });
    await ending.locator('[data-resize-end]').scrollIntoViewIfNeeded();
    const bottom = await ending.locator('[data-resize-end]').boundingBox();
    if (!bottom) throw Error('Missing end handle');
    await page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height / 2);
    await page.mouse.down();
    const beforeStart = await lanePoint(page, '2026-02-02', 1410);
    await page.mouse.move(beforeStart.x, beforeStart.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await getState(page)).blocks.find(b => b.note === 'Ende')?.end).toBe('2026-02-02T22:56:00Z');
    const final = (await getState(page)).blocks.filter(b => ['Anfang', 'Ende'].includes(b.note));
    expect(final).toHaveLength(2);
    expect(final.every(b => Date.parse(b.start) >= Date.parse('2026-02-01T23:00:00Z') && Date.parse(b.end) <= Date.parse('2026-02-02T23:00:00Z'))).toBe(true);
  });

  test('calendar labels stay correct on a computer in a western timezone', async ({ browser }) => {
    const context = await browser.newContext({ timezoneId: 'America/Los_Angeles', viewport: { width: 1440, height: 1000 } });
    await seedGermanLanguage(context);
    try {
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:4318/');
      await chooseWeek(page, '2026-06-01');
      await expect(page.locator('.week-identity')).toContainText('01.06.2026');
      await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Zeitkonto', exact: true }).click();
      await expect(page.locator('.period-nav:visible')).toContainText('Juni 2026');
    } finally { await context.close(); }
  });

  test('eight-hour drag, midnight form splitting and downloadable backup', async ({ page }, testInfo) => {
    // Keep this long gesture inside the scroll viewport; edge dragging intentionally autoscrolls.
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/');
    await chooseWeek(page, '2026-09-28');
    await page.locator('.ov-calendar-scroll').scrollIntoViewIfNeeded();
    await draw(page, '2026-09-30', 480, 960);
    await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect.poll(async () => (await getState(page)).blocks.some(b => b.start === '2026-09-30T06:00:00Z' && b.end === '2026-09-30T14:00:00Z')).toBe(true);
    await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
    await page.getByLabel('Beginn · Datum').fill('2026-09-30');
    await page.getByLabel('Beginn · Uhrzeit').fill('23:00');
    await page.getByLabel('Ende · Datum').fill('2026-10-01');
    await page.getByLabel('Ende · Uhrzeit').fill('01:00');
    await openBlockNote(page);
    await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Ueber Mitternacht');
    await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await getState(page)).blocks.filter(b => b.note === 'Ueber Mitternacht')).toHaveLength(2);
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('link', { name: 'SQLite-Backup herunterladen' }).click();
    const download = await downloading;
    const path = testInfo.outputPath('test-backup.sqlite');
    await download.saveAs(path);
    expect((await readFile(path)).subarray(0, 15).toString()).toBe('SQLite format 3');
  });
});
