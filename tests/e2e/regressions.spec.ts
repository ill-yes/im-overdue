import { test, expect, chooseWeek, getState, newBlock, openBlockNote, openSourceFilters, previewImport } from './isolated-fixture';

test('initial week uses the saved timezone at the Sunday/Monday boundary', async ({ page, localApp }) => {
  const current = await (await page.request.get(`${localApp.url}/api/state`)).json();
  const changed = await page.request.put(`${localApp.url}/api/settings`, {
    headers: { Origin: localApp.url }, data: { timezone: 'America/New_York', expectedRevision: current.revision },
  });
  expect(changed.status()).toBe(200);
  await page.clock.setFixedTime(new Date('2026-10-04T22:30:00Z'));
  await page.goto('/');
  await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue('2026-10-04');
  await expect(page.locator('[data-calendar-day]').first()).toHaveAttribute('data-calendar-day', '2026-09-28');
  await expect(page.locator('.week-identity')).toContainText('America/New_York');
});

test('a timezone change in another tab does not reinterpret an open form', async ({ page, context, localApp }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  await page.getByLabel('Beginn · Datum').fill('2026-10-01');
  await page.getByLabel('Ende · Datum').fill('2026-10-01');
  await page.getByLabel('Beginn · Uhrzeit').fill('09:00');
  await page.getByLabel('Ende · Uhrzeit').fill('10:00');
  await openBlockNote(page);
  await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Unveraenderte lokale Eingabe');
  const secondTab = await context.newPage();
  await secondTab.goto(localApp.url);
  await secondTab.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await secondTab.getByLabel('Zeitzone suchen', { exact: true }).fill('America/New_York');
  await secondTab.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(secondTab.getByRole('status')).toContainText('Zeitzone gespeichert');
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('zwischenzeitlich geändert');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('bleibt in Europe/Berlin');
  await expect(page.getByLabel('Beginn · Uhrzeit')).toHaveValue('09:00');
  await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue('2026-09-28');
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await getState(page)).blocks[0]).toMatchObject({ start: '2026-10-01T07:00:00Z', end: '2026-10-01T08:00:00Z' });
  await secondTab.close();
});

for (const operation of ['save', 'delete'] as const) {
  test(`a delayed ${operation} response cannot close a newer editor on the same date`, async ({ page }) => {
    await page.goto('/');
    await chooseWeek(page, '2026-09-28');
    if (operation === 'delete') {
      await newBlock(page, '2026-09-28', '09:00', '10:00', 'To delete');
      await page.locator('[data-work-block]').focus();
      await page.keyboard.press('Enter');
    } else {
      await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
    }
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let received = false;
    await page.route('**/api/blocks**', async route => {
      const response = await route.fetch();
      received = true;
      await gate;
      await route.fulfill({ response });
    });
    page.on('dialog', dialog => dialog.accept());
    try {
      await page.getByRole('button', { name: operation === 'save' ? 'Arbeitszeit speichern' : 'Löschen', exact: true }).click();
      await expect.poll(() => received).toBe(true);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
      await openBlockNote(page);
      await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Neuer Entwurf bleibt erhalten');
      release();
      await expect(page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true })).toBeEnabled();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Notiz optional', exact: true })).toHaveValue('Neuer Entwurf bleibt erhalten');
      expect((await getState(page)).blocks).toHaveLength(operation === 'save' ? 1 : 0);
    } finally { release(); }
  });
}

test('a delayed import response cannot close a newer settings dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Importieren', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles('examples/activities.json');
  await previewImport(page);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let received = false;
  await page.route('**/api/import/commit', async route => {
    const response = await route.fetch();
    received = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'Import bestätigen' }).click();
    await expect.poll(() => received).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await page.getByLabel('Stunden pro Woche').fill('35');
    release();
    await expect(page.getByRole('button', { name: 'Sollprofil speichern' })).toBeEnabled();
    await expect(page.getByRole('dialog', { name: 'Einstellungen' })).toBeVisible();
    await expect(page.getByLabel('Stunden pro Woche')).toHaveValue('35');
    expect((await getState(page)).activities).toHaveLength(13);
    expect((await getState(page)).profiles[0].weeklyMinutes).toBe(2400);
  } finally { release(); }
});

test('a short meeting and overlapping point markers stay reachable as one evidence group', async ({ page }, testInfo) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await page.getByRole('button', { name: 'Importieren', exact: true }).click();
  await page.getByRole('button', { name: 'Daten einfügen', exact: true }).click();
  await page.getByLabel('Daten einfügen', { exact: true }).fill(JSON.stringify({ schemaVersion: 1, activities: [
    { source: 'google_calendar', id: 'collision:meeting', start: '2026-09-28T09:00:00+02:00', end: '2026-09-28T09:15:00+02:00', title: 'Kurzer Termin' },
    { source: 'slack', id: 'collision:message', start: '2026-09-28T09:00:00+02:00', title: 'Gesendete Nachricht' },
    { source: 'github', id: 'collision:commit', start: '2026-09-28T09:15:00+02:00', title: 'Commit zur Viertelstunde' },
  ] }));
  await previewImport(page);
  await page.getByRole('button', { name: 'Import bestätigen' }).click();
  await page.getByRole('dialog', { name: 'Aktivitäten importieren' }).getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const evidence = page.locator('[data-calendar-day="2026-09-28"] .ov-activity');
  await expect(evidence).toHaveCount(1);
  await expect(evidence).toHaveAccessibleName('3 Belege · 1 Termin + 2 Aktivitäten, Slack, Kalender, GitHub');
  await page.screenshot({ path: testInfo.outputPath('grouped-evidence.png') });
  await evidence.click();
  for (const title of ['Kurzer Termin', 'Gesendete Nachricht', 'Commit zur Viertelstunde']) {
    await expect(page.getByRole('dialog').getByRole('heading', { name: title })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await openSourceFilters(page);
  await page.getByRole('checkbox', { name: 'Slack', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'GitHub', exact: true }).uncheck();
  await expect(evidence).toHaveCount(1);
  await evidence.click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Kurzer Termin' })).toBeVisible();
  expect((await getState(page)).blocks).toHaveLength(0);
});
