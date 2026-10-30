import type { Page } from '@playwright/test';
import { test, expect, chooseWeek, getState, newBlock, openBlockNote, previewImport } from './isolated-fixture';
import { addDays } from '../../shared/time.js';

const FIXED_NOW = new Date('2026-10-02T12:00:00Z');

async function openEntry(page: Page, expectedDate: string) {
  await page.getByRole('region', { name: /^(Wochen|Monats)steuerung$/ }).getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  await expect(page.getByLabel('Beginn · Datum')).toHaveValue(expectedDate);
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
}

async function importActivities(page: Page, activities: object[]) {
  await page.getByRole('button', { name: 'Importieren', exact: true }).click();
  await page.getByRole('button', { name: 'Daten einfügen', exact: true }).click();
  await page.getByLabel('Daten einfügen', { exact: true }).fill(JSON.stringify({ schemaVersion: 1, activities }));
  await previewImport(page);
  await expect(page.getByRole('region', { name: 'Importvorschau' })).toBeVisible();
}

test('central entry and day review follow today, explicit dates and week changes', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await page.getByRole('button', { name: 'Heute' }).click();
  await openEntry(page, '2026-10-02');
  await page.getByRole('button', { name: 'Tag prüfen' }).click();
  await expect(page.locator('aside.day-review').getByLabel('Tag wählen')).toHaveValue('2026-10-02');
  await page.getByLabel('Woche über Datum wählen').fill('2026-10-01');
  await expect(page.locator('aside.day-review').getByLabel('Tag wählen')).toHaveValue('2026-10-01');
  await openEntry(page, '2026-10-01');
  await page.locator('[data-calendar-day="2026-09-30"]').getByRole('button', { name: /Tagesprüfung für/ }).click();
  await expect(page.locator('aside.day-review').getByLabel('Tag wählen')).toHaveValue('2026-09-30');
  await openEntry(page, '2026-09-30');
  await page.getByRole('button', { name: 'Vorherige Woche' }).click();
  await expect(page.locator('aside.day-review').getByLabel('Tag wählen')).toHaveValue('2026-09-21');
  await openEntry(page, '2026-09-21');
  await page.getByRole('button', { name: 'Nächste Woche' }).click();
  await expect(page.locator('aside.day-review').getByLabel('Tag wählen')).toHaveValue('2026-10-02');
  await openEntry(page, '2026-10-02');
  await page.getByRole('button', { name: 'Tag prüfen' }).click();
  await page.getByRole('group', { name: 'Kalenderansicht' }).getByRole('button', { name: 'Monat' }).click();
  await page.locator('[data-month-day="2026-09-29"]').click();
  await openEntry(page, '2026-09-29');
});

test('import navigation chooses the evidence date for central entry', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await importActivities(page, [{ source: 'github', id: 'old', start: '2026-09-22T09:00:00+02:00', title: 'Alter Beleg' }]);
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await page.getByRole('button', { name: 'Zeitraum öffnen' }).click();
  await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue('2026-09-22');
  await openEntry(page, '2026-09-22');
});

test('today chooses the configured timezone day at a UTC day boundary', async ({ page, localApp }) => {
  const state = await (await page.request.get(`${localApp.url}/api/state`)).json();
  const changed = await page.request.put(`${localApp.url}/api/settings`, {
    headers: { Origin: localApp.url }, data: { timezone: 'America/New_York', expectedRevision: state.revision },
  });
  expect(changed.status()).toBe(200);
  await page.clock.setFixedTime(new Date('2026-10-04T22:30:00Z'));
  await page.goto('/');
  await chooseWeek(page, '2026-09-21');
  await page.getByRole('button', { name: 'Heute' }).click();
  await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue('2026-10-04');
  await openEntry(page, '2026-10-04');
  await page.getByRole('button', { name: 'Tag prüfen' }).click();
  await expect(page.locator('aside.day-review').getByLabel('Tag wählen')).toHaveValue('2026-10-04');
});

for (const operation of ['save', 'delete'] as const) {
  test(`a pending ${operation} freezes only its draft and cannot close the next one`, async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto('/');
    await chooseWeek(page, '2026-09-28');
    if (operation === 'delete') {
      await newBlock(page, '2026-09-28', '09:00', '10:00', 'Zu löschen');
      await page.locator('[data-work-block]').focus();
      await page.keyboard.press('Enter');
    } else {
      await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
    }
    await openBlockNote(page);
    await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Abgeschickter Entwurf');
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/api/blocks**', async route => {
      requests++;
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    });
    page.on('dialog', dialog => dialog.accept());
    try {
      await page.getByRole('button', { name: operation === 'save' ? 'Arbeitszeit speichern' : 'Löschen', exact: true }).click();
      await expect.poll(() => requests).toBe(1);
      for (const label of ['Beginn · Datum', 'Beginn · Uhrzeit', 'Ende · Datum', 'Ende · Uhrzeit', 'Notiz']) {
        await expect(page.getByRole('dialog').getByLabel(label, { exact: false })).toBeDisabled();
      }
      await expect(page.getByRole('dialog')).toContainText('läuft auch nach dem Schließen weiter');
      await expect(page.getByRole('button', { name: 'Schließen', exact: true })).toBeEnabled();
      await page.getByRole('dialog').locator('form').dispatchEvent('submit');
      if (operation === 'delete') await page.getByRole('button', { name: 'Löschen', exact: true }).dispatchEvent('click');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
      await openBlockNote(page);
      await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Neuer Entwurf');
      await expect(page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true })).toBeDisabled();
      await page.getByRole('dialog').locator('form').dispatchEvent('submit');
      release();
      await expect(page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true })).toBeEnabled();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Notiz optional', exact: true })).toHaveValue('Neuer Entwurf');
      await expect(page.getByRole('textbox', { name: 'Notiz optional', exact: true })).toBeEnabled();
      expect(requests).toBe(1);
      expect((await getState(page)).blocks).toHaveLength(operation === 'save' ? 1 : 0);
    } finally { release(); }
  });
}

test('failed block save releases the draft with values intact', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  await openBlockNote(page);
  await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Noch einmal versuchen');
  await page.route('**/api/blocks', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporär nicht verfügbar' }) }));
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Notiz optional', exact: true })).toHaveValue('Noch einmal versuchen');
  await expect(page.getByRole('textbox', { name: 'Notiz optional', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true })).toBeEnabled();
  expect((await getState(page)).blocks).toHaveLength(0);
});

test('DST fold selectors freeze with the submitted block and remain after failure', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-10-19');
  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  await page.getByLabel('Beginn · Datum').fill('2026-10-25');
  await page.getByLabel('Ende · Datum').fill('2026-10-25');
  await page.getByLabel('Beginn · Uhrzeit').fill('02:15');
  await page.getByLabel('Ende · Uhrzeit').fill('02:45');
  await page.getByLabel('Beginn liegt zweimal vor').selectOption('earlier');
  await page.getByLabel('Ende liegt zweimal vor').selectOption('later');
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/blocks', async route => {
    requests++;
    await gate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporär nicht verfügbar' }) });
  });
  try {
    await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByLabel('Beginn liegt zweimal vor')).toBeDisabled();
    await expect(page.getByLabel('Ende liegt zweimal vor')).toBeDisabled();
    release();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Temporär nicht verfügbar');
    await expect(page.getByLabel('Beginn liegt zweimal vor')).toBeEnabled();
    await expect(page.getByLabel('Ende liegt zweimal vor')).toBeEnabled();
    await expect(page.getByLabel('Beginn liegt zweimal vor')).toHaveValue('earlier');
    await expect(page.getByLabel('Ende liegt zweimal vor')).toHaveValue('later');
    expect((await getState(page)).blocks).toHaveLength(0);
  } finally { release(); }
});

test('invalid duration is explained immediately and overnight can be corrected', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  await page.getByLabel('Ende · Uhrzeit').fill('09:00');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Das Ende muss nach dem Beginn liegen');
  const description = await page.getByLabel('Ende · Uhrzeit').getAttribute('aria-describedby');
  expect(description).toBeTruthy();
  await expect(page.locator(`#${description}`)).toContainText('Das Ende muss nach dem Beginn liegen');
  await expect(page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true })).toBeDisabled();
  await page.getByLabel('Ende · Uhrzeit').fill('08:00');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Enddatum ändern');
  const date = await page.getByLabel('Beginn · Datum').inputValue();
  await page.getByLabel('Beginn · Uhrzeit').fill('22:00');
  await page.getByLabel('Ende · Datum').fill(addDays(date, 1));
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const blocks = (await getState(page)).blocks;
  expect(blocks.reduce((sum, block) => sum + (Date.parse(block.end) - Date.parse(block.start)), 0)).toBe(10 * 60 * 60 * 1000);
});

test('settings lock their own pending request and restore the draft after failure', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByLabel('Zeitzone suchen', { exact: true }).fill('America/New_York');
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/settings', async route => {
    requests++;
    await gate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporär nicht verfügbar' }) });
  });
  try {
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByLabel('Zeitzone suchen', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Stunden pro Woche')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Arbeitszeit ab … ändern' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Speichern …' })).toBeDisabled();
    await page.getByRole('dialog').locator('#settings-general form').dispatchEvent('submit');
    expect(requests).toBe(1);
    release();
    await expect(page.getByRole('dialog', { name: 'Einstellungen' }).getByRole('alert')).toContainText('Temporär nicht verfügbar');
    await expect(page.getByLabel('Zeitzone suchen', { exact: true })).toHaveValue('America/New_York');
    await expect(page.getByLabel('Zeitzone suchen', { exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Arbeitszeit ab … ändern' })).toBeEnabled();
    expect((await getState(page)).settings.timezone).toBe('Europe/Berlin');
  } finally { release(); }
});

test('settings show local success, guard no-ops and allow an equal future profile', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await newBlock(page, '2026-09-28', '09:00', '10:00', 'Undo bleibt');
  const before = await getState(page);
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/(settings|profiles)$/.test(request.url())) writes++; });
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Einstellungen' });
  await settings.getByRole('button', { name: 'Vergangenes Soll korrigieren', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  await expect(settings.getByRole('button', { name: 'Sollprofil speichern' })).toBeDisabled();
  page.on('dialog', dialog => dialog.accept());
  await page.getByLabel('Stunden pro Woche').fill('40.001');
  await expect(settings.getByRole('button', { name: 'Sollprofil speichern' })).toBeDisabled();
  await settings.getByRole('checkbox', { name: 'Mo' }).uncheck();
  await settings.getByRole('checkbox', { name: 'Mo' }).check();
  await expect(settings.getByRole('button', { name: 'Sollprofil speichern' })).toBeDisabled();
  await page.getByLabel('Stunden pro Woche').press('Enter');
  await settings.locator('#settings-general form').dispatchEvent('submit');
  await settings.getByRole('button', { name: 'Speichern', exact: true }).dispatchEvent('click');
  const stillBefore = await getState(page);
  expect(writes).toBe(0);
  expect(stillBefore.revision).toBe(before.revision);
  expect(stillBefore.undo?.token).toBe(before.undo?.token);
  await page.getByRole('button', { name: 'Arbeitszeit ab … ändern' }).click();
  await expect(page.getByLabel('Gültig ab Montag')).toHaveValue('2026-10-05');
  await expect(settings.getByRole('button', { name: 'Sollprofil speichern' })).toBeEnabled();
  await settings.getByRole('button', { name: 'Sollprofil speichern' }).click();
  await expect(settings.getByText('Sollprofil gespeichert.')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Sollprofil speichern' })).toBeDisabled();
  await page.getByRole('button', { name: 'Vergangenes Soll korrigieren' }).click();
  await expect(settings.getByText('Sollprofil gespeichert.')).toHaveCount(0);
  await page.getByLabel('Zeitzone suchen', { exact: true }).fill('America/New_York');
  await settings.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(settings.getByText('Zeitzone gespeichert.')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  const saved = await getState(page);
  expect(saved.settings.timezone).toBe('America/New_York');
  expect(saved.profiles.some(profile => profile.effectiveFrom === '2026-10-05' && profile.weeklyMinutes === 2400)).toBe(true);
  await page.getByLabel('Zeitzone suchen', { exact: true }).fill('Europe/Berlin');
  await expect(settings.getByText('Zeitzone gespeichert')).toHaveCount(0);
});

test('declining a settings reopen confirmation preserves the draft without success', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await newBlock(page, '2026-09-21', '09:00', '10:00', 'Bestaetigte Vorwoche');
  await chooseWeek(page, '2026-09-21');
  await page.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  const closeConfirmation = page.getByRole('dialog', { name: 'Woche abschließen', exact: true });
  await expect(closeConfirmation.locator('form')).toHaveAttribute('aria-busy', 'false');
  for (const checkbox of await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Woche wieder öffnen', exact: true })).toBeVisible();
  const before = await getState(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByLabel('Zeitzone suchen', { exact: true }).fill('America/New_York');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByLabel('Zeitzone suchen', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Zeitzone suchen', { exact: true })).toHaveValue('America/New_York');
  await expect(page.getByRole('dialog').getByRole('status')).toHaveCount(0);
  expect(await getState(page)).toEqual(before);
  await page.getByRole('button', { name: 'Vergangenes Soll korrigieren', exact: true }).click();
  await page.getByLabel('Stunden pro Woche').fill('35');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Sollprofil speichern', exact: true }).click();
  await expect(page.getByLabel('Stunden pro Woche')).toHaveValue('35');
  await expect(page.getByRole('dialog').getByRole('status')).toHaveCount(0);
  expect(await getState(page)).toEqual(before);
});

test('mobile import diff stays readable with long values and 50-row paging', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  const longId = 'repository:' + 'long-name-'.repeat(12);
  const old = { source: 'github', id: longId, start: '2026-09-28T09:15:00.000000001+02:00', title: 'Alter Titel', url: 'https://example.org/' + 'old/'.repeat(25) };
  await importActivities(page, [old]);
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await page.getByRole('dialog', { name: 'Aktivitäten importieren' }).getByRole('button', { name: 'Schließen', exact: true }).click();
  const newer = { ...old, start: '2026-09-28T09:15:00.000000002+02:00', title: 'Neuer sehr langer Titel '.repeat(9), url: 'https://example.org/' + 'new/'.repeat(25) };
  await importActivities(page, [newer, ...Array.from({ length: 54 }, (_, i) => ({ source: 'slack', id: `page-${i}`, start: '2026-09-28T10:00:00+02:00', title: `Beleg ${i}` }))]);
  const preview = page.getByRole('region', { name: 'Importvorschau' });
  await expect(preview.locator('tr[data-import-row]')).toHaveCount(50);
  await page.setViewportSize({ width: 390, height: 844 });
  await preview.getByRole('button', { name: 'Änderung anzeigen' }).click();
  await expect(preview.locator('.imp-diff-grid')).toContainText('Bisher');
  await expect(preview.locator('.imp-diff-grid')).toContainText('Neu');
  const layout = await preview.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const diff = element.querySelector('.imp-diff-grid')!.getBoundingClientRect();
    const toggle = element.querySelector('.imp-diff-toggle')!.getBoundingClientRect();
    const wrap = element.querySelector('.imp-table-wrap')!;
    return { previewLeft: bounds.left, previewRight: bounds.right, diffLeft: diff.left, diffRight: diff.right, toggleLeft: toggle.left, toggleRight: toggle.right, wrapOverflow: wrap.scrollWidth - wrap.clientWidth, bodyOverflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  expect(layout.diffLeft).toBeGreaterThanOrEqual(layout.previewLeft - 1);
  expect(layout.diffRight).toBeLessThanOrEqual(layout.previewRight + 1);
  expect(layout.toggleLeft).toBeGreaterThanOrEqual(layout.previewLeft - 1);
  expect(layout.toggleRight).toBeLessThanOrEqual(layout.previewRight + 1);
  expect(layout.wrapOverflow).toBeLessThanOrEqual(1);
  expect(layout.bodyOverflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('polish-mobile-import.png') });
  await preview.getByRole('button', { name: 'Weiter' }).click();
  await expect(preview.locator('tr[data-import-row]')).toHaveCount(5);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await preview.getByRole('button', { name: 'Zurück' }).click();
  if (await preview.getByRole('button', { name: 'Änderung anzeigen' }).getAttribute('aria-expanded') === 'false') {
    await preview.getByRole('button', { name: 'Änderung anzeigen' }).click();
  }
  await expect(preview.locator('.imp-diff-grid')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('polish-desktop-import.png') });
});
