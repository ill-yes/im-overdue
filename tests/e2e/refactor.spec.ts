import type { Page } from '@playwright/test';
import { test, expect, chooseWeek, getState, newBlock, openBlockNote, reviewActivity } from './isolated-fixture';

const oldError = 'Fehler der früheren Anfrage';

async function delayFailure(page: Page, path: string, method: string) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received = false;
  await page.route(path, async (route) => {
    if (route.request().method() !== method) {
      await route.continue();
      return;
    }
    received = true;
    await gate;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: oldError }),
    });
  });
  return { waitForRequest: () => expect.poll(() => received).toBe(true), release };
}

async function openBlock(page: Page, note: string) {
  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  await openBlockNote(page);
  await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill(note);
  await expect(page.getByRole('dialog', { name: 'Arbeitszeit eintragen' })).toBeVisible();
}

async function assertNewDialogUnaffected(page: Page, kind: 'block' | 'settings') {
  if (kind === 'block') {
    await openBlock(page, 'Neuer Entwurf');
    const dialog = page.getByRole('dialog', { name: 'Arbeitszeit eintragen' });
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Notiz optional', exact: true })).toHaveValue('Neuer Entwurf');
  } else {
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Einstellungen' });
    await page.getByLabel('Zeitzone suchen', { exact: true }).fill('America/New_York');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(page.getByLabel('Zeitzone suchen', { exact: true })).toHaveValue('America/New_York');
  }
}

for (const { operation, next } of [
  { operation: 'create', next: 'block' },
  { operation: 'update', next: 'settings' },
  { operation: 'delete', next: 'block' },
] as const) {
  test(`late failed block ${operation} stays outside a newer ${next} dialog`, async ({ page }) => {
    await page.goto('/');
    await chooseWeek(page, '2026-09-28');
    if (operation !== 'create') {
      await newBlock(page, '2026-09-28', '09:00', '10:00', 'Original');
      await page.locator('[data-work-block]').focus();
      await page.keyboard.press('Enter');
    } else await openBlock(page, 'Alter Entwurf');
    if (operation === 'update') { await openBlockNote(page); await page.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Alte Änderung'); }
    const path = operation === 'create' ? '**/api/blocks' : '**/api/blocks/*';
    const method = operation === 'create' ? 'POST' : operation === 'update' ? 'PUT' : 'DELETE';
    const delayed = await delayFailure(page, path, method);
    if (operation === 'delete') page.once('dialog', (dialog) => dialog.accept());
    try {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: operation === 'delete' ? 'Löschen' : 'Arbeitszeit speichern', exact: true })
        .click();
      await delayed.waitForRequest();
      await page.getByRole('dialog').getByRole('button', { name: 'Schließen', exact: true }).click();
      await assertNewDialogUnaffected(page, next);
      delayed.release();
      await expect(page.locator('.app-alert')).toContainText(oldError);
      await assertNewDialogUnaffectedAfterRelease(page, next);
      expect((await getState(page)).blocks).toHaveLength(operation === 'create' ? 0 : 1);
    } finally {
      delayed.release();
    }
  });
}

async function assertNewDialogUnaffectedAfterRelease(page: Page, kind: 'block' | 'settings') {
  const dialog = page.getByRole('dialog', {
    name: kind === 'block' ? 'Arbeitszeit eintragen' : 'Einstellungen',
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  if (kind === 'block') {
    await expect(page.getByRole('textbox', { name: 'Notiz optional', exact: true })).toHaveValue('Neuer Entwurf');
    await expect(dialog.getByRole('button', { name: 'Arbeitszeit speichern', exact: true })).toBeEnabled();
  } else {
    await expect(page.getByLabel('Zeitzone suchen', { exact: true })).toHaveValue('America/New_York');
    await expect(dialog.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
  }
}

for (const { operation, path, method, next } of [
  { operation: 'timezone', path: '**/api/settings', method: 'PUT', next: 'block' },
  { operation: 'profile', path: '**/api/profiles', method: 'POST', next: 'settings' },
] as const) {
  test(`late failed ${operation} save stays outside a newer ${next} dialog`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    if (operation === 'timezone') await page.getByLabel('Zeitzone suchen', { exact: true }).fill('America/New_York');
    else await page.getByLabel('Stunden pro Woche').fill('35');
    const delayed = await delayFailure(page, path, method);
    try {
      await page
        .getByRole('dialog', { name: 'Einstellungen' })
        .getByRole('button', {
          name: operation === 'timezone' ? 'Speichern' : 'Sollprofil speichern',
          exact: true,
        })
        .click();
      await delayed.waitForRequest();
      await page
        .getByRole('dialog', { name: 'Einstellungen' })
        .getByRole('button', { name: 'Schließen', exact: true })
        .click();
      await assertNewDialogUnaffected(page, next);
      delayed.release();
      await expect(page.locator('.app-alert')).toContainText(oldError);
      await assertNewDialogUnaffectedAfterRelease(page, next);
      const state = await getState(page);
      expect(state.settings.timezone).toBe('Europe/Berlin');
      expect(state.profiles[0].weeklyMinutes).toBe(2400);
    } finally {
      delayed.release();
    }
  });
}

for (const kind of ['block', 'settings'] as const) {
  test(`failed ${kind} request keeps the source dialog draft and error`, async ({ page }) => {
    await page.goto('/');
    if (kind === 'block') {
      await chooseWeek(page, '2026-09-28');
      await openBlock(page, 'Entwurf bleibt');
    } else {
      await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
      await page.getByLabel('Zeitzone suchen', { exact: true }).fill('America/New_York');
    }
    const delayed = await delayFailure(
      page,
      kind === 'block' ? '**/api/blocks' : '**/api/settings',
      kind === 'block' ? 'POST' : 'PUT',
    );
    try {
      const dialog = page.getByRole('dialog', {
        name: kind === 'block' ? 'Arbeitszeit eintragen' : 'Einstellungen',
      });
      await dialog.getByRole('button', { name: kind === 'block' ? 'Arbeitszeit speichern' : 'Speichern', exact: true }).click();
      await delayed.waitForRequest();
      delayed.release();
      await expect(dialog.getByRole('alert')).toContainText(oldError);
      await expect(page.locator('.app-alert')).toContainText(oldError);
      if (kind === 'block')
        await expect(page.getByRole('textbox', { name: 'Notiz optional', exact: true })).toHaveValue('Entwurf bleibt');
      else await expect(page.getByLabel('Zeitzone suchen', { exact: true })).toHaveValue('America/New_York');
      await expect(dialog.getByRole('button', { name: kind === 'block' ? 'Arbeitszeit speichern' : 'Speichern', exact: true })).toBeEnabled();
      await expect(dialog).toBeVisible();
    } finally {
      delayed.release();
    }
  });
}

test('late revision conflict refreshes state without marking the newer settings dialog', async ({
  page,
  localApp,
}) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await openBlock(page, 'Veraltete Eingabe');
  const staleRevision = (await getState(page)).revision;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received = false;
  await page.route('**/api/blocks', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    received = true;
    await gate;
    await route.fulfill({ response: await route.fetch() });
  });
  try {
    await page
      .getByRole('dialog', { name: 'Arbeitszeit eintragen' })
      .getByRole('button', { name: 'Arbeitszeit speichern', exact: true })
      .click();
    await expect.poll(() => received).toBe(true);
    await page.getByRole('dialog').getByRole('button', { name: 'Schließen', exact: true }).click();
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await page.getByLabel('Zeitzone suchen', { exact: true }).fill('America/New_York');
    const concurrent = await page.request.post(`${localApp.url}/api/blocks`, {
      headers: { Origin: localApp.url },
      data: {
        expectedRevision: staleRevision,
        start: '2026-09-29T09:00:00+02:00',
        end: '2026-09-29T10:00:00+02:00',
        note: 'Zweiter Tab',
      },
    });
    expect(concurrent.status()).toBe(200);
    release();
    await expect(page.locator('.app-alert')).toContainText('zwischenzeitlich geändert');
    const newer = page.getByRole('dialog', { name: 'Einstellungen' });
    await expect(newer.getByRole('alert')).toHaveCount(0);
    await expect(page.getByLabel('Zeitzone suchen', { exact: true })).toHaveValue('America/New_York');
    await expect(newer.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
    expect((await getState(page)).blocks).toHaveLength(1);
  } finally {
    release();
  }
});

test('one nanosecond after midnight overlaps the next day but an exact midnight end does not', async ({
  page,
  localApp,
}) => {
  await page.goto('/');
  const current = await getState(page);
  const response = await page.request.post(`${localApp.url}/api/import/commit`, {
    headers: { Origin: localApp.url },
    data: {
      expectedRevision: current.revision,
      format: 'json',
      text: JSON.stringify({
        schemaVersion: 1,
        activities: [
          {
            source: 'google_calendar',
            id: 'exact-midnight',
            title: 'Endet exakt um Mitternacht',
            start: '2026-09-30T23:30:00+02:00',
            end: '2026-10-01T00:00:00+02:00',
          },
          {
            source: 'google_calendar',
            id: 'one-nanosecond',
            title: 'Reicht eine Nanosekunde hinein',
            start: '2026-09-30T23:30:00+02:00',
            end: '2026-10-01T00:00:00.000000001+02:00',
          },
        ],
      }),
    },
  });
  expect(response.status()).toBe(200);
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  const nextDay = page.locator('[data-calendar-day="2026-10-01"]');
  await expect(nextDay.locator('.ov-activity')).toHaveCount(1);
  await expect(nextDay.locator('.ov-activity')).toHaveAccessibleName(/Reicht eine Nanosekunde hinein/);
  await nextDay.getByRole('button', { name: /Tagesprüfung für/ }).click();
  const review = page.locator('aside.day-review');
  await expect(review.locator('[data-review-activity]')).toHaveCount(1);
  await expect(await reviewActivity(page, 'google_calendar', 'one-nanosecond')).toBeVisible();
  await expect(await reviewActivity(page, 'google_calendar', 'exact-midnight')).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Kalenderansicht' })
    .getByRole('button', { name: 'Monat', exact: true })
    .click();
  await expect(page.locator('[data-month-day="2026-10-01"] .mo-day-activity')).toContainText('1 Aktivität');
  await expect(page.locator('.calendar-footer')).toContainText('1 gefilterter Beleg im Monat');
  await page.getByLabel('Monat wählen', { exact: true }).fill('2026-09');
  await expect(page.locator('[data-month-day="2026-09-30"] .mo-day-activity')).toContainText('2 Aktivitäten');
});
