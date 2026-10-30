import { seedGermanLanguage } from './language-fixture';
import type { Locator, Page } from '@playwright/test';
import { test, expect, chooseWeek, getState, newBlock } from './isolated-fixture';
import type { AppState, CalendarNote } from '../../shared/types.js';

const MONDAY = '2026-09-28';
const TUESDAY = '2026-09-29';
const THURSDAY = '2026-10-01';
const FIXED_NOW = new Date('2026-10-15T12:00:00Z');

function note(state: AppState, scope: CalendarNote['scope'], date: string) {
  return state.notes.find(item => item.scope === scope && item.date === date)?.text;
}

async function openDay(page: Page, date = MONDAY) {
  const label = `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
  const longLabel = new Intl.DateTimeFormat('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  await page.locator(`[data-calendar-day="${date}"]`).getByRole('button', { name: `Aktionen für ${longLabel}`, exact: true }).click();
  await page.getByRole('menuitem', {
    name: `Tagesnotiz für ${label} öffnen`, exact: true,
  }).click();
  const dialog = page.getByRole('dialog', { name: 'Tagesnotiz', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.note-period')).toHaveText(longLabel);
  return dialog;
}

async function openWeek(page: Page) {
  await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Wochennotiz(?: bearbeiten)?$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Wochennotiz', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('28.09.2026');
  return dialog;
}

async function saveNote(page: Page, text: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Notiz', exact: true }).fill(text);
  await dialog.getByRole('button', { name: 'Notiz speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function showMonth(page: Page, month = '2026-09') {
  await page.getByRole('group', { name: 'Kalenderansicht' }).getByRole('button', { name: 'Monat', exact: true }).click();
  await page.getByLabel('Monat wählen', { exact: true }).fill(month);
  await expect(page.getByRole('region', { name: 'Monatskalender', exact: true })).toBeVisible();
}

async function assertPendingKeyboardTrap(page: Page, dialog: Locator, draft: string) {
  const originalNode = await dialog.elementHandle();
  if (!originalNode) throw new Error('Pending note dialog is missing');
  const backgroundOpener = page.locator(`[data-calendar-day="${MONDAY}"]`).getByRole('button', {
    name: 'Aktionen für Montag, 28. September 2026', exact: true,
  });
  for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await expect(dialog).toBeFocused();
  }
  // Even if an external element receives focus programmatically, Tab returns to the modal.
  await backgroundOpener.focus();
  await expect(backgroundOpener).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toHaveValue(draft);
  expect(await originalNode.evaluate(node => node.isConnected)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toHaveValue(draft);
  expect(await originalNode.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(1);
}

test('day and Monday-keyed week notes stay distinct through edit, delete, reload and server restart', async ({ page, localApp }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await chooseWeek(page, THURSDAY);
  await openDay(page, THURSDAY);
  await saveNote(page, 'Donnerstag');
  await openWeek(page);
  await saveNote(page, 'Woche 40');
  await openDay(page, MONDAY);
  await saveNote(page, 'Montag ist eigenständig');
  let state = await getState(page);
  expect(state.notes).toEqual([
    { scope: 'day', date: MONDAY, text: 'Montag ist eigenständig' },
    { scope: 'day', date: THURSDAY, text: 'Donnerstag' },
    { scope: 'week', date: MONDAY, text: 'Woche 40' },
  ]);

  await page.reload();
  await chooseWeek(page, THURSDAY);
  const week = await openWeek(page);
  await expect(week.getByRole('textbox', { name: 'Notiz' })).toHaveValue('Woche 40');
  await saveNote(page, 'Woche 40, aktualisiert');
  await openDay(page, THURSDAY);
  await saveNote(page, '');
  state = await getState(page);
  expect(note(state, 'day', THURSDAY)).toBeUndefined();
  expect(note(state, 'day', MONDAY)).toBe('Montag ist eigenständig');
  expect(note(state, 'week', MONDAY)).toBe('Woche 40, aktualisiert');

  await localApp.restart();
  await page.goto(localApp.url);
  await chooseWeek(page, THURSDAY);
  expect((await getState(page)).notes).toEqual(state.notes);
  await expect((await openDay(page, THURSDAY)).getByRole('textbox', { name: 'Notiz' })).toHaveValue('');
});

test('unchanged notes do not write or consume Undo; a real note change leaves work untouched', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await chooseWeek(page, MONDAY);
  await newBlock(page, MONDAY, '09:00', '10:00', 'Arbeitsblock');
  const before = await getState(page);
  expect(before.undo?.token).toBeTruthy();
  let noteWrites = 0;
  page.on('request', request => {
    if (request.method() === 'PUT' && /\/api\/notes\//.test(request.url())) noteWrites++;
  });
  let dialog = await openDay(page);
  await expect(dialog.getByRole('button', { name: 'Notiz speichern' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Notiz speichern' }).dispatchEvent('click');
  await dialog.locator('form').dispatchEvent('submit');
  expect(await getState(page)).toEqual(before);
  expect(noteWrites).toBe(0);
  await dialog.getByRole('button', { name: 'Dialog schließen' }).click();

  await openDay(page);
  await saveNote(page, 'Nur ein Kommentar zum Tag');
  const changed = await getState(page);
  expect(changed.revision).toBe(before.revision + 1);
  expect(changed.undo).toBeNull();
  expect(changed.blocks).toEqual(before.blocks);
  expect(changed.weeks).toEqual(before.weeks);
  dialog = await openDay(page);
  await expect(dialog.getByRole('button', { name: 'Notiz speichern' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Notiz speichern' }).dispatchEvent('click');
  await dialog.locator('form').dispatchEvent('submit');
  expect(await getState(page)).toEqual(changed);
  expect(noteWrites).toBe(1);
});

test('notes alone do not mark work; closed weeks and month indicators keep their work status', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await chooseWeek(page, MONDAY);
  await openDay(page);
  await saveNote(page, 'Nur Kontext, keine Arbeitszeit');
  await openWeek(page);
  await saveNote(page, 'Plan der Woche');
  let state = await getState(page);
  expect(state.weeks).toEqual([]);
  expect(state.blocks).toEqual([]);
  await showMonth(page);
  const monday = page.locator(`[data-month-day="${MONDAY}"]`);
  await expect(monday).toHaveAttribute('data-day-status', 'untouched');
  await expect(monday).toContainText('Tagesnotiz vorhanden');
  await expect(monday.locator('.mo-day-times')).toContainText('Ist 0 h');
  await monday.click();
  await expect(page.locator('[data-calendar-day]').first()).toHaveAttribute('data-calendar-day', MONDAY);
  await expect((await openDay(page)).getByRole('textbox', { name: 'Notiz' })).toHaveValue('Nur Kontext, keine Arbeitszeit');
  await page.getByRole('dialog').getByRole('button', { name: 'Dialog schließen' }).click();

  await newBlock(page, MONDAY, '09:00', '10:00');
  page.once('dialog', prompt => prompt.accept());
  await page.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  const closeConfirmation = page.getByRole('dialog', { name: 'Woche abschließen', exact: true });
  await expect(closeConfirmation.locator('form')).toHaveAttribute('aria-busy', 'false');
  for (const checkbox of await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('dialog', { name: 'Woche abschließen', exact: true }).getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Woche wieder öffnen', exact: true })).toBeVisible();
  state = await getState(page);
  expect(state.weeks).toEqual([{ weekStart: MONDAY, status: 'closed' }]);
  await openDay(page, TUESDAY);
  await saveNote(page, 'Auch nach Abschluss editierbar');
  const after = await getState(page);
  expect(after.weeks).toEqual(state.weeks);
  expect(after.blocks).toEqual(state.blocks);
  await expect(page.locator('.status-pill')).toHaveText('Abgeschlossen');
  await showMonth(page);
  await expect(page.locator(`[data-month-day="${TUESDAY}"]`)).toHaveAttribute('data-day-status', 'closed');
  await expect(page.locator(`[data-month-day="${TUESDAY}"]`)).toContainText('Tagesnotiz vorhanden');
});

test('day review opens the selected date note and shows its saved preview', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, MONDAY);
  await page.locator(`[data-calendar-day="${TUESDAY}"]`).getByRole('button', { name: /Tagesprüfung.*öffnen/ }).click();
  const review = page.locator('aside.day-review');
  await expect(review.getByLabel('Tag wählen')).toHaveValue(TUESDAY);
  await review.getByRole('button', { name: 'Tagesnotiz', exact: true }).click();
  await saveNote(page, 'Besprechung und Konzentrationszeit');
  await expect(review).toContainText('Besprechung und Konzentrationszeit');
  await review.getByRole('button', { name: 'Tagesnotiz', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Tagesnotiz' }).getByRole('textbox', { name: 'Notiz' }))
    .toHaveValue('Besprechung und Konzentrationszeit');
});

test('note content is plain text and cannot create HTML or execute script', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, MONDAY);
  const payload = '<img src=x onerror="window.__noteScriptRan=true"> & <script>window.__noteScriptRan=true</script>';
  await openDay(page);
  await saveNote(page, payload);
  await page.reload();
  await chooseWeek(page, MONDAY);
  const dialog = await openDay(page);
  await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toHaveValue(payload);
  await expect(dialog.locator('img[src="x"], script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __noteScriptRan?: boolean }).__noteScriptRan)).toBeUndefined();
});

test('a pending successful save locks the original note dialog until it closes', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, MONDAY);
  const dialog = await openDay(page);
  const draft = 'Wichtige Tagesnotiz';
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let serverCommitted = false;
  let requests = 0;
  await page.route(`**/api/notes/day/${MONDAY}`, async route => {
    requests++;
    const response = await route.fetch();
    serverCommitted = true;
    await gate;
    await route.fulfill({ response });
  });
  let confirmations = 0;
  page.on('dialog', async prompt => { confirmations++; await prompt.dismiss(); });
  try {
    await dialog.getByRole('textbox', { name: 'Notiz' }).fill(draft);
    await dialog.getByRole('button', { name: 'Notiz speichern' }).click();
    await expect.poll(() => serverCommitted).toBe(true);
    await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toBeDisabled();
    await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toHaveValue(draft);
    await expect(dialog.getByRole('button', { name: 'Notiz speichern' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Dialog schließen' })).toBeDisabled();
    await expect(dialog.getByRole('status')).toContainText('Bitte kurz warten');
    await dialog.getByRole('button', { name: 'Notiz speichern' }).dispatchEvent('click');
    await dialog.locator('form').dispatchEvent('submit');
    await dialog.getByRole('button', { name: 'Dialog schließen' }).dispatchEvent('click');
    await dialog.getByRole('button', { name: 'Abbrechen' }).dispatchEvent('click');
    await assertPendingKeyboardTrap(page, dialog, draft);
    await page.keyboard.press('Escape');
    await page.locator('.modal-backdrop').click({ position: { x: 1, y: 1 } });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toHaveValue(draft);
    expect(confirmations).toBe(0);
    expect(requests).toBe(1);
    release();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(note(await getState(page), 'day', MONDAY)).toBe(draft);
    expect(requests).toBe(1);
  } finally { release(); }
});

test('a pending failed save keeps the original draft, then retry can save it', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, MONDAY);
  const dialog = await openDay(page);
  const draft = 'Wichtiger Entwurf mit Zeilenumbruch\nund <Text>';
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let received = false;
  let requests = 0;
  await page.route(`**/api/notes/day/${MONDAY}`, async route => {
    requests++;
    received = true;
    await gate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Speichern fehlgeschlagen' }) });
  });
  let confirmations = 0;
  page.on('dialog', async prompt => { confirmations++; await prompt.dismiss(); });
  try {
    await dialog.getByRole('textbox', { name: 'Notiz' }).fill(draft);
    await dialog.getByRole('button', { name: 'Notiz speichern' }).click();
    await expect.poll(() => received).toBe(true);
    await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toBeDisabled();
    await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toHaveValue(draft);
    await expect(dialog.getByRole('button', { name: 'Notiz speichern' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Dialog schließen' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Notiz speichern' }).dispatchEvent('click');
    await dialog.locator('form').dispatchEvent('submit');
    await dialog.getByRole('button', { name: 'Dialog schließen' }).dispatchEvent('click');
    await dialog.getByRole('button', { name: 'Abbrechen' }).dispatchEvent('click');
    await assertPendingKeyboardTrap(page, dialog, draft);
    await page.keyboard.press('Escape');
    await page.locator('.modal-backdrop').click({ position: { x: 1, y: 1 } });
    await expect(dialog).toBeVisible();
    expect(confirmations).toBe(0);
    expect(requests).toBe(1);
    release();
    await expect(dialog.getByRole('alert')).toContainText('Speichern fehlgeschlagen');
    await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toBeEnabled();
    await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toHaveValue(draft);
    await expect(dialog.getByRole('button', { name: 'Notiz speichern' })).toBeEnabled();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Dialog schließen' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Notiz speichern' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Dialog schließen' })).toBeFocused();
    expect((await getState(page)).notes).toEqual([]);
    await page.unrouteAll();
    await dialog.getByRole('button', { name: 'Notiz speichern' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(note(await getState(page), 'day', MONDAY)).toBe(draft);
  } finally { release(); }
});

test('revision conflict preserves the draft and closing an unsaved note asks before discarding', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, MONDAY);
  let dialog = await openDay(page);
  await dialog.getByRole('textbox', { name: 'Notiz' }).fill('Nicht verwerfen');
  page.once('dialog', prompt => prompt.dismiss());
  await dialog.getByRole('button', { name: 'Dialog schließen' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toHaveValue('Nicht verwerfen');

  const before = await getState(page);
  const origin = new URL(page.url()).origin;
  const concurrent = await page.request.put(`${origin}/api/notes/day/${MONDAY}`, {
    headers: { Origin: origin },
    data: { text: 'Parallel geänderte Tagesnotiz', expectedRevision: before.revision },
  });
  expect(concurrent.status()).toBe(200);
  await dialog.getByRole('button', { name: 'Notiz speichern' }).click();
  await expect(dialog.getByRole('alert')).toContainText('zwischenzeitlich geändert');
  await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toHaveValue('Nicht verwerfen');
  expect(note(await getState(page), 'day', MONDAY)).toBe('Parallel geänderte Tagesnotiz');
  // The conflict refreshes state. A retry may save only after an explicit replacement decision.
  page.once('dialog', prompt => prompt.dismiss());
  await dialog.getByRole('button', { name: 'Notiz speichern' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toHaveValue('Nicht verwerfen');
  expect(note(await getState(page), 'day', MONDAY)).toBe('Parallel geänderte Tagesnotiz');
  page.once('dialog', prompt => prompt.accept());
  await dialog.getByRole('button', { name: 'Dialog schließen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  dialog = await openDay(page);
  await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toHaveValue('Parallel geänderte Tagesnotiz');
});

test('390px touch and keyboard controls open and save day and week notes', async ({ browser, localApp }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await seedGermanLanguage(context);
  try {
    const page = await context.newPage();
    await page.goto(localApp.url);
    await chooseWeek(page, MONDAY);
    const icon = page.getByRole('menuitem', {
      name: 'Tagesnotiz für 28.09.2026 öffnen', exact: true,
    });
    await page.locator(`[data-calendar-day="${MONDAY}"]`).getByRole('button', { name: 'Aktionen für Montag, 28. September 2026', exact: true }).tap();
    await icon.tap();
    let dialog = page.getByRole('dialog', { name: 'Tagesnotiz' });
    await expect(dialog).toBeInViewport();
    await expect(dialog.getByRole('textbox', { name: 'Notiz' })).toBeInViewport();
    await dialog.getByRole('textbox', { name: 'Notiz' }).fill('Per Touch erfasst');
    await dialog.getByRole('button', { name: 'Notiz speichern' }).tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Wochennotiz', exact: true }).focus();
    await page.keyboard.press('Enter');
    dialog = page.getByRole('dialog', { name: 'Wochennotiz' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Notiz' }).fill('Mit Tastatur erfasst');
    await dialog.getByRole('button', { name: 'Notiz speichern' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await getState(page)).notes).toEqual([
      { scope: 'day', date: MONDAY, text: 'Per Touch erfasst' },
      { scope: 'week', date: MONDAY, text: 'Mit Tastatur erfasst' },
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  } finally { await context.close(); }
});

test('account page keeps native summary navigation and note modal restores focus after closing', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, MONDAY);
  await newBlock(page, MONDAY, '09:00', '10:00');
  const reportsButton = page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Zeitkonto', exact: true });
  await reportsButton.click();
  await page.getByRole('tab', { name: 'Auswertungen', exact: true }).click();
  const dialog = page.getByRole('region', { name: 'Zeitkonto', exact: true });
  const summary = dialog.locator('.reports-open-weeks summary');
  await summary.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Stundenzettel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.reports-open-weeks')).toHaveAttribute('open', '');
  await page.keyboard.press('Tab');
  await expect(dialog.locator('.reports-open-weeks button').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator(`[data-calendar-day="${MONDAY}"]`)).toBeVisible();

  await openDay(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aktionen für Montag, 28. September 2026', exact: true })).toBeFocused();
});
