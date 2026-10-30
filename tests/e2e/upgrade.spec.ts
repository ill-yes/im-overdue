import { seedGermanLanguage } from './language-fixture';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect, chooseWeek, getState, newBlock, openBlockNote, openSourceFilters, openAppAction, previewImport, reviewActivity, unchangedImportResult } from './isolated-fixture';
import type { Activity, AppState } from '../../shared/types.js';

function activity(id: string, start = '2026-09-28T09:00:00+02:00', overrides: Partial<Activity> = {}) {
  return { source: 'github', id, start, title: `Beleg ${id}`, ...overrides };
}
function json(activities: object[]) { return JSON.stringify({ schemaVersion: 1, activities }); }
async function importText(page: Page, activities: object[]) {
  await openAppAction(page, 'Importieren');
  await page.getByRole('button', { name: 'Daten einfügen', exact: true }).click();
  await page.getByLabel('Daten einfügen', { exact: true }).fill(json(activities));
  await previewImport(page);
  await expect(page.getByRole('region', { name: 'Importvorschau' })).toBeVisible();
}
async function requestMutation(page: Page, path: string, method: string, data: object) {
  return page.evaluate(async ({ path, method, data }) => {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }, { path, method, data });
}
function workSnapshot(state: AppState) {
  return { blocks: state.blocks, weeks: state.weeks };
}

test('Import → Tagesprüfung → Zeit zeichnen → Rückgängig → Ergebnis schließen', async ({ page }, testInfo) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await importText(page, [activity('flow', '2026-09-28T09:00:00+02:00')]);
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await expect(page.getByRole('dialog', { name: 'Aktivitäten importieren' })).toBeVisible();
  await page.getByRole('button', { name: 'Zeitraum öffnen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tag prüfen' }).click();
  const review = page.locator('aside.day-review');
  await expect(review).toContainText('Beleg flow');
  await review.getByRole('button', { name: 'Im Kalender zeigen' }).click();
  await expect(page.locator('[data-focused-activity="true"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('upgrade-desktop.png') });
  const lane = page.locator('[data-work-lane][data-date="2026-09-28"]');
  const box = await lane.boundingBox();
  if (!box) throw new Error('Work lane missing');
  await page.mouse.move(box.x + box.width / 2, box.y + 8 * 56);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 10 * 56, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
  expect((await getState(page)).blocks).toHaveLength(0);
  await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('[data-work-block]')).toHaveCount(1);
  await page.getByRole('button', { name: /Rückgängig/ }).click();
  await expect(page.locator('[data-work-block]')).toHaveCount(0);
  expect((await getState(page)).activities).toHaveLength(1);
  await review.getByRole('button', { name: 'Zeit eintragen' }).click();
  await expect(page.getByLabel('Beginn · Datum')).toHaveValue('2026-09-28');
  await page.getByLabel('Beginn · Uhrzeit').fill('08:00');
  await page.getByLabel('Ende · Uhrzeit').fill('10:00');
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(page.locator('[data-work-block]')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  const closeConfirmation = page.getByRole('dialog', { name: 'Woche abschließen', exact: true });
  await expect(closeConfirmation.locator('form')).toHaveAttribute('aria-busy', 'false');
  for (const checkbox of await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect(page.locator('.status-pill')).toHaveText('Abgeschlossen');
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Zeitkonto', exact: true }).click();
  await page.getByRole('tab', { name: 'Auswertungen', exact: true }).click();
  await expect(page.locator('.reports-confirmed')).toContainText('1 abgeschlossene Woche');
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Kalender', exact: true }).click();
  await page.getByRole('group', { name: 'Kalenderansicht' }).getByRole('button', { name: 'Monat' }).click();
  await page.getByLabel('Monat wählen').fill('2026-09');
  await expect(page.locator('[data-month-day="2026-09-28"] .mo-day-times')).toContainText('Ist 2 h');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-month-day="2026-09-28"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('upgrade-mobile.png') });
});

test('Rückgängig restores created, changed and deleted blocks one step at a time', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await newBlock(page, '2026-09-28', '09:00', '10:00', 'Original');
  let state = await getState(page);
  expect(state.undo?.token).toBeTruthy();
  await page.getByRole('button', { name: /Rückgängig/ }).click();
  await expect.poll(async () => (await getState(page)).blocks.length).toBe(0);
  expect((await getState(page)).undo).toBeNull();

  await newBlock(page, '2026-09-28', '09:00', '10:00', 'Original');
  state = await getState(page);
  const beforeEdit = workSnapshot(state);
  await page.locator(`[data-work-block="${state.blocks[0].id}"]`).focus();
  await page.keyboard.press('Enter');
  await openBlockNote(page);
  await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Geändert');
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  expect((await getState(page)).blocks[0].note).toBe('Geändert');
  await page.getByRole('button', { name: /Rückgängig/ }).click();
  expect(workSnapshot(await getState(page))).toEqual(beforeEdit);

  await page.locator(`[data-work-block="${state.blocks[0].id}"]`).focus();
  await page.keyboard.press('Enter');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Löschen' }).click();
  await expect.poll(async () => (await getState(page)).blocks.length).toBe(0);
  await page.getByRole('button', { name: /Rückgängig/ }).click();
  expect(workSnapshot(await getState(page))).toEqual(beforeEdit);
});

test('closed week and midnight split return exactly with undo after restart', async ({ page, localApp }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  let state = await getState(page);
  const created = await requestMutation(page, '/api/blocks', 'POST', {
    expectedRevision: state.revision, start: '2026-09-28T23:30:00+02:00', end: '2026-09-29T00:30:00+02:00', note: 'Mitternacht',
  });
  expect(created.status).toBe(200);
  state = created.body as AppState;
  expect(state.blocks).toHaveLength(2);
  const closed = await requestMutation(page, '/api/weeks/2026-09-28', 'POST', { expectedRevision: state.revision, status: 'closed', confirmCurrent: true, confirmWarnings: true });
  expect(closed.status).toBe(200);
  state = closed.body as AppState;
  const before = workSnapshot(state);
  const changed = await requestMutation(page, `/api/blocks/${state.blocks[0].id}`, 'PUT', {
    expectedRevision: state.revision, confirmReopen: true, start: '2026-09-28T22:30:00+02:00', end: '2026-09-28T23:30:00+02:00', note: 'Verschoben',
  });
  expect(changed.status).toBe(200);
  state = changed.body as AppState;
  expect(state.undo?.token).toBeTruthy();
  expect(state.weeks.find(w => w.weekStart === '2026-09-28')?.status).toBe('open');
  await localApp.restart();
  await page.goto(localApp.url);
  await chooseWeek(page, '2026-09-28');
  await expect(page.getByRole('button', { name: /Rückgängig/ })).toBeEnabled();
  await page.getByRole('button', { name: /Rückgängig/ }).click();
  expect(workSnapshot(await getState(page))).toEqual(before);
});

test('a read or failed write keeps undo, a successful later write replaces it', async ({ page }) => {
  await page.goto('/');
  await newBlock(page, '2026-09-28', '09:00', '10:00', 'First');
  let state = await getState(page);
  const firstToken = state.undo?.token;
  expect(firstToken).toBeTruthy();
  const failed = await requestMutation(page, '/api/blocks', 'POST', {
    expectedRevision: state.revision, start: '2026-09-28T09:30:00+02:00', end: '2026-09-28T10:30:00+02:00', note: 'Overlap',
  });
  expect(failed.status).toBe(409);
  await page.reload();
  state = await getState(page);
  expect(state.undo?.token).toBe(firstToken);
  await newBlock(page, '2026-09-29', '09:00', '10:00', 'Second');
  state = await getState(page);
  expect(state.undo?.token).not.toBe(firstToken);
  const stale = await requestMutation(page, '/api/blocks/undo', 'POST', { expectedRevision: state.revision, token: firstToken });
  expect(stale.status).toBe(409);
  expect((await getState(page)).blocks).toHaveLength(2);
});

test('a concurrent tab receives 409 for stale undo and refreshes without overwriting', async ({ page, context, localApp }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await newBlock(page, '2026-09-28', '09:00', '10:00', 'Erster Tab');
  const stale = await getState(page);
  const second = await context.newPage();
  await second.goto(localApp.url);
  await newBlock(second, '2026-09-29', '09:00', '10:00', 'Zweiter Tab');
  await page.getByRole('button', { name: /Rückgängig/ }).click();
  await expect(page.getByRole('alert')).toContainText('zwischenzeitlich geändert');
  const current = await getState(page);
  expect(current.blocks).toHaveLength(2);
  expect(current.undo?.token).not.toBe(stale.undo?.token);
  await second.close();
});

test('day review follows date, source filters and title search without altering work totals', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await importText(page, [
    activity('alpha', '2026-09-28T09:00:00+02:00', { title: 'Alpha commit' }),
    activity('beta', '2026-09-28T10:00:00+02:00', { source: 'slack', title: 'Beta message' }),
    activity('tomorrow', '2026-09-29T11:00:00+02:00', { title: 'Tomorrow commit' }),
  ]);
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await page.getByRole('dialog', { name: 'Aktivitäten importieren' }).getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.locator('[data-calendar-day="2026-09-28"]').getByRole('button', { name: /Tagesprüfung für/ }).click();
  const review = page.locator('aside.day-review');
  await expect(review).toContainText('Alpha commit');
  await expect(review).toContainText('Beta message');
  const totals = await review.locator('.dr-summary').textContent();
  await review.getByRole('searchbox', { name: 'Aktivitäten durchsuchen' }).fill('Alpha');
  await expect(review.locator('[data-review-activity]')).toHaveCount(1);
  await expect(review.locator('[data-review-activity]')).toContainText('Alpha commit');
  await review.getByRole('searchbox', { name: 'Aktivitäten durchsuchen' }).fill('');
  await openSourceFilters(page);
  await page.getByRole('checkbox', { name: 'Slack', exact: true }).uncheck();
  await expect(review.locator('[data-review-activity]')).toHaveCount(1);
  await expect(review.locator('.dr-summary')).toHaveText(totals ?? '');
  await review.getByRole('button', { name: 'Nächster Tag' }).click();
  await expect(review.getByLabel('Tag wählen')).toHaveValue('2026-09-29');
  await expect(review).toContainText('Tomorrow commit');
  await review.getByRole('button', { name: 'Vorheriger Tag' }).click();
  await expect(review).toContainText('Alpha commit');
});

test('day review loads dense activity in 50-row pages and focuses the chosen cluster', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await importText(page, Array.from({ length: 107 }, (_, i) => activity(`dense-${String(i).padStart(3, '0')}`, `2026-09-28T${String(9 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}+02:00`)));
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await page.getByRole('dialog', { name: 'Aktivitäten importieren' }).getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.locator('[data-calendar-day="2026-09-28"]').getByRole('button', { name: /Tagesprüfung für/ }).click();
  const review = page.locator('aside.day-review');
  await expect(review.locator('[data-review-activity]')).toHaveCount(50);
  await review.getByRole('button', { name: /Weitere 50 anzeigen/ }).click();
  await expect(review.locator('[data-review-activity]')).toHaveCount(100);
  await review.getByRole('button', { name: /Weitere 50 anzeigen/ }).click();
  await expect(review.locator('[data-review-activity]')).toHaveCount(107);
  await (await reviewActivity(page, 'github', 'dense-106')).getByRole('button', { name: 'Im Kalender zeigen' }).click();
  await expect(page.locator('[data-focused-activity="true"]')).toBeVisible();
});

test('day review shows clipped midnight and distinct DST fold offsets', async ({ page }) => {
  await page.goto('/');
  await importText(page, [
    activity('overnight', '2026-09-28T23:30:00+02:00', { end: '2026-09-29T00:30:00+02:00', title: 'Overnight meeting', source: 'google_calendar' }),
    activity('early-fold', '2026-10-25T02:30:00+02:00', { title: 'First fold' }),
    activity('late-fold', '2026-10-25T02:30:00+01:00', { title: 'Second fold' }),
  ]);
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await page.getByRole('dialog', { name: 'Aktivitäten importieren' }).getByRole('button', { name: 'Schließen', exact: true }).click();
  await chooseWeek(page, '2026-09-28');
  await page.locator('[data-calendar-day="2026-09-29"]').getByRole('button', { name: /Tagesprüfung für/ }).click();
  const review = page.locator('aside.day-review');
  await expect(await reviewActivity(page, 'google_calendar', 'overnight')).toContainText('Beginnt vor diesem Tag');
  await expect(await reviewActivity(page, 'google_calendar', 'overnight')).toContainText('00:00');
  await review.getByLabel('Tag wählen').fill('2026-10-25');
  await expect(review.locator('[data-review-activity]')).toHaveCount(2);
  await expect(await reviewActivity(page, 'github', 'early-fold')).toContainText('+02:00');
  await expect(await reviewActivity(page, 'github', 'late-fold')).toContainText('+01:00');
  for (const id of ['early-fold', 'late-fold']) {
    await (await reviewActivity(page, 'github', id)).getByRole('button', { name: 'Im Kalender zeigen' }).click();
    const marker = page.locator('[data-focused-activity="true"]');
    await expect(marker).toBeInViewport({ ratio: 0.5 });
    const visibleInCalendar = await marker.evaluate(element => {
      const scroll = element.closest('.ov-calendar-scroll');
      if (!scroll) return false;
      const markerRect = element.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      return markerRect.bottom > scrollRect.top && markerRect.top < scrollRect.bottom && markerRect.right > scrollRect.left && markerRect.left < scrollRect.right;
    });
    expect(visibleInCalendar).toBe(true);
  }
});

test('keyboard undo respects editors and dialogs and works from the calendar', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await newBlock(page, '2026-09-28', '09:00', '10:00', 'Keep while editing');
  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  await openBlockNote(page);
  await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Typing stays');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('textbox', { name: 'Notiz optional', exact: true })).toHaveValue('');
  expect((await getState(page)).blocks).toHaveLength(1);
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.getByLabel('Woche über Datum wählen').focus();
  await page.keyboard.press('ControlOrMeta+z');
  expect((await getState(page)).blocks).toHaveLength(1);
  const lane = page.locator('[data-work-lane][data-date="2026-09-29"]');
  const box = await lane.boundingBox();
  if (!box) throw new Error('Gesture lane missing');
  await page.mouse.move(box.x + box.width / 2, box.y + 9 * 56);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 10 * 56, { steps: 5 });
  await page.keyboard.press('ControlOrMeta+z');
  expect((await getState(page)).blocks).toHaveLength(1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await getState(page)).blocks).toHaveLength(1);
  await page.getByRole('heading', { name: 'Wochenkalender', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await getState(page)).blocks.length).toBe(0);
});

test('import preview paginates 50 rows and displays prior/new diff with local offset', async ({ page }, testInfo) => {
  await page.goto('/');
  await importText(page, [activity('changed', '2026-10-25T02:30:00+02:00', { title: 'Old title' })]);
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await page.getByRole('dialog', { name: 'Aktivitäten importieren' }).getByRole('button', { name: 'Schließen', exact: true }).click();
  const values = [activity('changed', '2026-10-25T02:30:00+02:00', { title: 'New title' }),
    ...Array.from({ length: 54 }, (_, i) => activity(`page-${String(i).padStart(2, '0')}`, '2026-10-25T02:30:00+01:00'))];
  await importText(page, values);
  const preview = page.getByRole('region', { name: 'Importvorschau' });
  await expect(preview.locator('.preview-stats')).toContainText('1 geändert');
  await expect(preview.locator('.imp-table tbody tr[data-import-row]')).toHaveCount(50);
  await expect(preview).toContainText('Seite 1 / 2');
  await preview.getByRole('button', { name: 'Änderung' }).click();
  const diff = preview.locator('.imp-diff');
  await expect(diff).toContainText('Bisher');
  await expect(diff).toContainText('Old title');
  await expect(diff).toContainText('Neu');
  await expect(diff).toContainText('New title');
  await expect(preview).toContainText('+02:00');
  await page.screenshot({ path: testInfo.outputPath('upgrade-import-diff.png') });
  await preview.getByRole('button', { name: 'Weiter' }).click();
  await expect(preview.locator('.imp-table tbody tr[data-import-row]')).toHaveCount(5);
  await expect(preview).toContainText('Seite 2 / 2');
  await expect(preview).toContainText('+01:00');
  await preview.getByRole('button', { name: 'Zurück' }).click();
  await expect(preview.locator('.imp-table tbody tr[data-import-row]')).toHaveCount(50);
});

test('import diff reveals changes within a minute and at nanosecond precision', async ({ page }) => {
  await page.goto('/');
  const original = activity('precise', '2026-09-28T09:15:00+02:00', {
    title: 'Präziser Beleg', end: '2026-09-28T10:00:00.000000001+02:00',
  });
  await importText(page, [original]);
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await page.getByRole('dialog', { name: 'Aktivitäten importieren' }).getByRole('button', { name: 'Schließen', exact: true }).click();

  await importText(page, [{ ...original, start: '2026-09-28T09:15:30+02:00', end: '2026-09-28T10:00:00.000000002+02:00' }]);
  const preview = page.getByRole('region', { name: 'Importvorschau' });
  await expect(preview.locator('.preview-stats')).toContainText('1 geändert');
  await preview.getByRole('button', { name: 'Änderung' }).click();
  const diff = preview.locator('.imp-diff-grid');
  const before = diff.locator(':scope > div').first();
  const after = diff.locator(':scope > div').last();
  await expect(before).toContainText('09:15 +02:00');
  await expect(after).toContainText('09:15:30 +02:00');
  await expect(before).toContainText('10:00:00.000000001 +02:00');
  await expect(after).toContainText('10:00:00.000000002 +02:00');
  await expect(preview.getByRole('button', { name: 'Import bestätigen' })).toBeEnabled();
  expect((await getState(page)).activities[0].start).toBe('2026-09-28T07:15:00Z');
});

test('unchanged-only preview opens its no-op result without a commit and retains Zeitraum öffnen', async ({ page }) => {
  await page.goto('/');
  const values = [activity('unchanged', '2026-09-28T09:00:00+02:00')];
  await importText(page, values);
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await page.getByRole('dialog', { name: 'Aktivitäten importieren' }).getByRole('button', { name: 'Schließen', exact: true }).click();
  await importText(page, values);
  const preview = page.getByRole('region', { name: 'Importvorschau' });
  await expect(preview.locator('.preview-stats')).toContainText('1 unverändert');
  await unchangedImportResult(page);
  await page.getByRole('button', { name: 'Zeitraum öffnen' }).click();
  await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue('2026-09-28');
  expect((await getState(page)).activities).toHaveLength(1);
});

test('example downloads contain both formats and drop accepts exactly one synthetic file', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Importieren', exact: true }).click();
  for (const [button, extension, marker] of [['JSON-Beispiel', '.json', 'schemaVersion'], ['CSV-Beispiel', '.csv', 'source,id,start']] as const) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: button }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toContain(extension);
    expect(await readFile(await download.path(), 'utf8')).toContain(marker);
  }
  const zone = page.locator('label.file-drop');
  await zone.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['{}'], 'first.json', { type: 'application/json' }));
    transfer.items.add(new File(['{}'], 'second.json', { type: 'application/json' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.getByRole('alert')).toContainText('genau eine Datei');
  await zone.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify({ schemaVersion: 1, activities: [{ source: 'github', id: 'dropped', start: '2026-09-28T09:00:00+02:00', title: 'Dropped activity' }] })], 'dropped.json', { type: 'application/json' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.locator('.file-drop')).toContainText('dropped.json');
  await previewImport(page);
  await expect(page.locator('.preview-stats')).toContainText('1 neu');
  await expect(page.getByRole('region', { name: 'Importvorschau' })).toContainText('Dropped activity');
});

test('390px touch import, review, time entry, undo and week close', async ({ browser, localApp }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await seedGermanLanguage(context);
  const page = await context.newPage();
  try {
    await page.goto(localApp.url);
    await chooseWeek(page, '2026-09-28');
    await importText(page, [activity('touch', '2026-09-28T09:00:00+02:00')]);
    await page.getByRole('button', { name: 'Import bestätigen' }).click();
    await page.getByRole('dialog', { name: 'Aktivitäten importieren' }).getByRole('button', { name: 'Zeitraum öffnen' }).tap();
    await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue('2026-09-28');
    await page.locator('[data-calendar-day="2026-09-28"]').getByRole('button', { name: /Tagesprüfung für/ }).tap();
    const review = page.locator('aside.day-review');
    await expect(review).toBeVisible();
    await review.getByRole('searchbox', { name: 'Aktivitäten durchsuchen' }).fill('touch');
    await expect(review.locator('[data-review-activity]')).toHaveCount(1);
    await review.getByRole('button', { name: 'Nächster Tag' }).click();
    await expect(review.getByLabel('Tag wählen')).toHaveValue('2026-09-29');
    await review.getByRole('button', { name: 'Zeit eintragen' }).click();
    await expect(page.getByLabel('Beginn · Datum')).toHaveValue('2026-09-29');
    await page.getByLabel('Beginn · Uhrzeit').fill('08:00');
    await page.getByLabel('Ende · Uhrzeit').fill('10:00');
    await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).tap();
    await expect.poll(async () => (await getState(page)).blocks.length).toBe(1);
    await page.getByRole('button', { name: 'Rückgängig', exact: true }).tap();
    await expect.poll(async () => (await getState(page)).blocks.length).toBe(0);
    await review.getByRole('button', { name: 'Zeit eintragen' }).tap();
    await expect(page.getByLabel('Beginn · Datum')).toHaveValue('2026-09-29');
    await page.getByLabel('Beginn · Uhrzeit').fill('08:00');
    await page.getByLabel('Ende · Uhrzeit').fill('10:00');
    await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).tap();
    await expect.poll(async () => (await getState(page)).blocks.length).toBe(1);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Woche abschließen', exact: true }).tap();
    const closeConfirmation = page.getByRole('dialog', { name: 'Woche abschließen', exact: true });
    await expect(closeConfirmation.locator('form')).toHaveAttribute('aria-busy', 'false');
    for (const checkbox of await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('checkbox').all()) await checkbox.check();
    await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('button', { name: 'Woche abschließen', exact: true }).tap();
    await expect(page.locator('.status-pill')).toHaveText('Abgeschlossen');
    await expect(review.locator('[data-day-review-status]')).toHaveAttribute('data-day-review-status', 'closed');
    const finalState = await getState(page);
    expect(finalState.blocks).toHaveLength(1);
    expect(finalState.undo).toBeNull();
    expect(finalState.weeks.find(week => week.weekStart === '2026-09-28')?.status).toBe('closed');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  } finally { await context.close(); }
});
