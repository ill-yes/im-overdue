import { seedGermanLanguage } from './language-fixture';
import type { Page } from '@playwright/test';
import { test, expect, chooseWeek, getState, openBlockNote, openSourceFilters, openBlockTemplate, createFilterSource } from './isolated-fixture';
import { minutesBetween } from '../../shared/time.js';

async function draw(page: Page, date: string, from: number, to: number) {
  const lane = page.locator(`[data-work-lane][data-date="${date}"]`);
  const box = await lane.boundingBox();
  if (!box) throw new Error(`Missing work lane ${date}`);
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + from * 56 / 60);
  await page.mouse.down();
  await page.mouse.move(x, box.y + to * 56 / 60, { steps: 10 });
  await page.mouse.up();
}

async function enterWork(page: Page, date: string, from: string, to: string, title: string, note = '') {
  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Arbeitszeit eintragen' });
  await dialog.getByLabel('Beginn · Datum').fill(date);
  await dialog.getByLabel('Ende · Datum').fill(date);
  await dialog.getByLabel('Beginn · Uhrzeit').fill(from);
  await dialog.getByLabel('Ende · Uhrzeit').fill(to);
  await dialog.getByLabel('Tätigkeit optional').fill(title);
  await openBlockNote(page);
  await dialog.getByRole('textbox', { name: 'Notiz optional' }).fill(note);
  await dialog.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function openPicker(page: Page) {
  await page.getByRole('button', { name: 'Schnellauswahl', exact: true }).click();
  return page.getByRole('dialog');
}

test('focus expands the same calendar and keeps day, filters, review and scroll; Escape and month exit', async ({ page }) => {
  await page.goto('/');
  await createFilterSource(page, 'slack', 'Slack');
  await chooseWeek(page, '2026-09-28');
  await openSourceFilters(page);
  await page.getByRole('checkbox', { name: 'Slack', exact: true }).uncheck();
  await page.locator('[data-calendar-day="2026-09-30"]').getByRole('button', { name: /Tagesprüfung für/ }).click();
  const scroll = page.locator('.ov-calendar-scroll');
  await scroll.evaluate(element => { element.scrollTop = 280; element.scrollLeft = 110; });
  const before = await scroll.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }));
  const sameNode = await scroll.evaluate(element => {
    (window as Window & { __calendarNode?: Element }).__calendarNode = element;
    return element.isConnected;
  });
  expect(sameNode).toBe(true);
  await page.getByRole('button', { name: 'Fokusansicht' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/calendar-focused/);
  await openSourceFilters(page);
  await expect(page.getByRole('checkbox', { name: 'Slack', exact: true })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('aside.day-review')).toBeVisible();
  await expect(page.locator('aside.day-review').getByLabel('Tag wählen')).toHaveValue('2026-09-30');
  expect(await scroll.evaluate(element => element === (window as Window & { __calendarNode?: Element }).__calendarNode)).toBe(true);
  expect(await scroll.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }))).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/calendar-focused/);
  await page.getByRole('button', { name: 'Fokusansicht' }).click();
  await page.getByRole('group', { name: 'Kalenderansicht' }).getByRole('button', { name: 'Monat' }).click();
  await expect(page.locator('.app-shell')).not.toHaveClass(/calendar-focused/);
  await expect(page.getByRole('heading', { name: 'Monatskalender', exact: true })).toBeVisible();
});

test('focus restores clamped bottom and right offsets on button and Escape, but keeps deliberate scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await page.locator('[data-calendar-day="2026-09-30"]').getByRole('button', { name: /Tagesprüfung für/ }).click();
  const scroll = page.locator('.ov-calendar-scroll');
  const toEnd = () => scroll.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    element.scrollLeft = element.scrollWidth;
    return { top: element.scrollTop, left: element.scrollLeft };
  });
  const offsets = () => scroll.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }));
  const origin = await toEnd();
  expect(origin.top).toBeGreaterThan(0);
  expect(origin.left).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Fokusansicht' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/calendar-focused/);
  const expanded = await offsets();
  expect(expanded.top).toBeLessThan(origin.top);
  expect(expanded.left).toBeLessThan(origin.left);
  await page.getByRole('button', { name: 'Fokus verlassen' }).click();
  await expect.poll(offsets).toEqual(origin);

  await page.getByRole('button', { name: 'Fokusansicht' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/calendar-focused/);
  await expect.poll(offsets).toEqual(origin);

  await page.getByRole('button', { name: 'Fokusansicht' }).click();
  await scroll.evaluate(element => { element.scrollTop = 0; element.scrollLeft = 0; });
  await expect.poll(offsets).toEqual({ top: 0, left: 0 });
  await page.getByRole('button', { name: 'Fokus verlassen' }).click();
  await expect.poll(offsets).toEqual({ top: 0, left: 0 });

  // Returning to the focused viewport's natural clamp is still an intentional move.
  await toEnd();
  await page.getByRole('button', { name: 'Fokusansicht' }).click();
  const focusEnd = await offsets();
  expect(focusEnd.top).toBeLessThan(origin.top);
  expect(focusEnd.left).toBeLessThan(origin.left);
  const moveAndWait = (top: number, left: number) => scroll.evaluate(async (element, target) => {
    const scrolled = new Promise<void>(resolve => element.addEventListener('scroll', () => resolve(), { once: true }));
    element.scrollTop = target.top;
    element.scrollLeft = target.left;
    await scrolled;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }, { top, left });
  await moveAndWait(0, 0);
  await expect.poll(offsets).toEqual({ top: 0, left: 0 });
  await moveAndWait(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  await expect.poll(offsets).toEqual(focusEnd);
  await page.getByRole('button', { name: 'Fokus verlassen' }).click();
  await expect.poll(offsets).toEqual(focusEnd);
});

test('Escape closes a dialog or cancels drawing before it exits focus', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await page.getByRole('button', { name: 'Fokusansicht' }).click();
  const focused = page.locator('.app-shell');
  await expect(focused).toHaveClass(/calendar-focused/);
  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Arbeitszeit eintragen' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(focused).toHaveClass(/calendar-focused/);

  const lane = page.locator('[data-work-lane][data-date="2026-09-28"]');
  const box = await lane.boundingBox();
  if (!box) throw new Error('Missing work lane');
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + 8 * 56);
  await page.mouse.down();
  await page.mouse.move(x, box.y + 9 * 56, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(focused).toHaveClass(/calendar-focused/);
  expect((await getState(page)).blocks).toHaveLength(0);
});

test('390px focus roundtrip keeps bottom and right offsets without user scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await page.locator('[data-calendar-day="2026-09-30"]').getByRole('button', { name: /Tagesprüfung für/ }).click();
  const scroll = page.locator('.ov-calendar-scroll');
  const origin = await scroll.evaluate(async element => {
    const scrolled = new Promise<void>(resolve => element.addEventListener('scroll', () => resolve(), { once: true }));
    element.scrollTop = element.scrollHeight;
    element.scrollLeft = element.scrollWidth;
    await scrolled;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { top: element.scrollTop, left: element.scrollLeft };
  });
  expect(origin.top).toBeGreaterThan(0);
  expect(origin.left).toBeGreaterThan(0);
  const offsets = () => scroll.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }));
  await page.getByRole('button', { name: 'Fokusansicht' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/calendar-focused/);
  await expect(page.locator('aside.day-review')).toBeVisible();
  await page.getByRole('button', { name: 'Fokus verlassen' }).click();
  await expect(page.locator('.app-shell')).not.toHaveClass(/calendar-focused/);
  await expect.poll(offsets).toEqual(origin);
});

test('drawing stages exact times and title; cancel writes nothing, save creates one named block', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await draw(page, '2026-09-28', 480, 600);
  await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Details bearbeiten …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Arbeitszeit eintragen' });
  await expect(dialog.getByLabel('Beginn · Uhrzeit')).toHaveValue('08:00');
  await expect(dialog.getByLabel('Ende · Uhrzeit')).toHaveValue('10:00');
  expect((await getState(page)).blocks).toHaveLength(0);
  await dialog.getByLabel('Tätigkeit optional').fill('Konzeptarbeit');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  expect((await getState(page)).blocks).toHaveLength(0);
  await draw(page, '2026-09-28', 480, 600);
  await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Details bearbeiten …' }).click();
  await dialog.getByLabel('Tätigkeit optional').fill('Konzeptarbeit');
  await dialog.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const state = await getState(page);
  expect(state.blocks).toHaveLength(1);
  expect(state.blocks[0].title).toBe('Konzeptarbeit');
  expect(minutesBetween(state.blocks[0].start, state.blocks[0].end)).toBe(120);
});

test('drawing through the autumn DST fold keeps both occurrences and real duration', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-10-19');
  await page.locator('.ov-calendar-scroll').evaluate(element => { element.scrollTop = 0; });
  await draw(page, '2026-10-25', 120, 180);
  await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Details bearbeiten …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Arbeitszeit eintragen' });
  await expect(dialog.getByLabel('Beginn · Uhrzeit')).toHaveValue('02:00');
  await expect(dialog.getByLabel('Ende · Uhrzeit')).toHaveValue('02:00');
  await expect(dialog.getByLabel('Beginn liegt zweimal vor')).toHaveValue('earlier');
  await expect(dialog.getByLabel('Ende liegt zweimal vor')).toHaveValue('later');
  await expect(dialog.locator('.calculation-line')).toContainText('1 h');
  expect((await getState(page)).blocks).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  const block = (await getState(page)).blocks[0];
  expect(block.start).toBe('2026-10-25T00:00:00Z');
  expect(block.end).toBe('2026-10-25T01:00:00Z');
});

test('template-only writes no work; combined save creates both and Undo reverts the work change', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await draw(page, '2026-09-28', 480, 600);
  await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Details bearbeiten …' }).click();
  let dialog = page.getByRole('dialog', { name: 'Arbeitszeit eintragen' });
  await dialog.getByLabel('Tätigkeit optional').fill('Planung');
  await openBlockTemplate(page);
  await dialog.getByRole('button', { name: 'Nur als Vorlage speichern' }).click();
  await expect(dialog).toContainText('Der Arbeitsblock ist noch nicht gespeichert');
  let state = await getState(page);
  expect(state.blocks).toHaveLength(0);
  expect(state.templates.map(template => template.title)).toEqual(['Planung']);
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await draw(page, '2026-09-29', 540, 600);
  await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Details bearbeiten …' }).click();
  dialog = page.getByRole('dialog', { name: 'Arbeitszeit eintragen' });
  await dialog.getByLabel('Tätigkeit optional').fill('Review');
  await openBlockTemplate(page);
  await dialog.getByLabel('Als Vorlage merken').check();
  await dialog.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  state = await getState(page);
  expect(state.blocks.map(block => block.title)).toEqual(['Review']);
  expect(state.templates.map(template => template.title)).toEqual(['Planung', 'Review']);
  await page.getByRole('button', { name: /Rückgängig/ }).click();
  await expect.poll(async () => (await getState(page)).blocks.length).toBe(0);
  state = await getState(page);
  expect(state.templates.map(template => template.title)).toEqual(['Planung']);
});

test('shared picker searches, creates, edits and deletes templates and selects recent work in creation order', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await enterWork(page, '2026-10-02', '11:00', '12:00', 'First created', 'alpha');
  await enterWork(page, '2026-09-28', '08:00', '09:00', 'Second created', 'beta');
  let state = await getState(page);
  expect(state.recentEntries.map(item => item.title)).toEqual(['Second created', 'First created']);
  const picker = await openPicker(page);
  await picker.getByRole('tab', { name: 'Letzte Einträge' }).click();
  await expect(picker.locator('.reuse-row strong')).toHaveText(['Second created', 'First created']);
  await picker.getByRole('searchbox', { name: 'Tätigkeit oder Notiz suchen' }).fill('alpha');
  await expect(picker.locator('.reuse-row strong')).toHaveText(['First created']);
  await picker.getByRole('searchbox', { name: 'Tätigkeit oder Notiz suchen' }).fill('');
  await picker.getByRole('tab', { name: 'Vorlagen' }).click();
  await picker.getByRole('button', { name: 'Neue Vorlage' }).click();
  const editor = picker.locator('.reuse-editor');
  await editor.getByLabel('Tätigkeit').fill('Meeting');
  await editor.getByLabel('Dauer in Minuten').fill('45');
  await openBlockNote(page);
  await editor.getByRole('textbox', { name: 'Notiz optional' }).fill('Team');
  await editor.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(picker.locator('.reuse-row strong')).toHaveText(['Meeting']);
  await picker.getByRole('button', { name: 'Vorlage Meeting bearbeiten' }).click();
  await editor.getByLabel('Tätigkeit').fill('Teammeeting');
  await editor.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(picker.locator('.reuse-row strong')).toHaveText(['Teammeeting']);
  await picker.getByRole('searchbox', { name: 'Tätigkeit oder Notiz suchen' }).fill('Team');
  await expect(picker.locator('.reuse-row strong')).toHaveText(['Teammeeting']);
  page.once('dialog', native => native.accept());
  await picker.getByRole('button', { name: 'Vorlage Teammeeting löschen' }).click();
  await expect(picker.locator('.reuse-row')).toHaveCount(0);
  state = await getState(page);
  expect(state.templates).toHaveLength(0);
  expect(state.blocks).toHaveLength(2);
});

test('recent picker shows only the latest 20 created entries', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    for (let index = 0; index < 21; index++) {
      const state = await (await fetch('/api/state')).json();
      const start = new Date(Date.parse('2026-09-28T06:00:00Z') + index * 30 * 60_000).toISOString();
      const end = new Date(Date.parse(start) + 20 * 60_000).toISOString();
      const response = await fetch('/api/blocks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: state.revision, start, end, title: `Entry ${index}`, note: '' }),
      });
      if (!response.ok) throw new Error(`Could not create entry ${index}: ${response.status}`);
      await new Promise(resolve => setTimeout(resolve, 2));
    }
  });
  await page.reload();
  const state = await getState(page);
  expect(state.recentEntries).toHaveLength(20);
  expect(state.recentEntries.map(item => item.title)).not.toContain('Entry 0');
  const picker = await openPicker(page);
  await picker.getByRole('tab', { name: 'Letzte Einträge' }).click();
  await expect(picker.locator('.reuse-row')).toHaveCount(20);
  await expect(picker.locator('.reuse-row strong').first()).toHaveText('Entry 20');
  await expect(picker.locator('.reuse-row strong').last()).toHaveText('Entry 1');
});

test('stale template edit preserves draft and requires explicit overwrite after refresh', async ({ page }) => {
  await page.goto('/');
  const picker = await openPicker(page);
  await picker.getByRole('button', { name: 'Neue Vorlage' }).click();
  const editor = picker.locator('.reuse-editor');
  await editor.getByLabel('Tätigkeit').fill('Original');
  await editor.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(editor).toHaveCount(0);
  const original = (await getState(page)).templates[0];
  await picker.getByRole('button', { name: 'Vorlage Original bearbeiten' }).click();
  await editor.getByLabel('Tätigkeit').fill('Mein Entwurf');
  await page.evaluate(async ({ id }) => {
    const state = await (await fetch('/api/state')).json();
    const response = await fetch(`/api/templates/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: state.revision, title: 'Parallel geändert', note: '', durationMinutes: 60 }),
    });
    if (!response.ok) throw new Error(`Parallel update failed: ${response.status}`);
  }, { id: original.id });
  await editor.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(picker.getByRole('alert')).toContainText('zwischenzeitlich geändert');
  await expect(editor.getByLabel('Tätigkeit')).toHaveValue('Mein Entwurf');
  expect((await getState(page)).templates[0].title).toBe('Parallel geändert');
  page.once('dialog', native => native.dismiss());
  await editor.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(editor.getByLabel('Tätigkeit')).toHaveValue('Mein Entwurf');
  expect((await getState(page)).templates[0].title).toBe('Parallel geändert');
  page.once('dialog', native => native.accept());
  await editor.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(editor).toHaveCount(0);
  expect((await getState(page)).templates[0].title).toBe('Mein Entwurf');
  expect((await getState(page)).blocks).toHaveLength(0);
});

test('reuse keeps drawn and manual times until duration is explicitly applied', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await enterWork(page, '2026-09-29', '08:00', '09:30', 'Reusable');
  await draw(page, '2026-09-30', 600, 660);
  await page.getByRole('dialog', { name: 'Schnellerfassung' }).getByRole('button', { name: 'Details bearbeiten …' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Schnellauswahl/ }).click();
  const picker = dialog.getByRole('region', { name: 'Schnellauswahl' });
  await picker.getByRole('tab', { name: 'Letzte Einträge' }).click();
  await picker.locator('.reuse-row').getByRole('button', { name: /übernehmen$/i }).click();
  await expect(dialog.getByLabel('Tätigkeit optional')).toHaveValue('Reusable');
  await expect(dialog.getByLabel('Beginn · Uhrzeit')).toHaveValue('10:00');
  await expect(dialog.getByLabel('Ende · Uhrzeit')).toHaveValue('11:00');
  await expect(dialog.getByRole('button', { name: 'Vorlagendauer übernehmen' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Vorlagendauer übernehmen' }).click();
  await expect(dialog.getByLabel('Ende · Uhrzeit')).toHaveValue('11:30');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();

  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  await dialog.getByLabel('Beginn · Datum').fill('2026-10-01');
  await dialog.getByLabel('Ende · Datum').fill('2026-10-01');
  await dialog.getByLabel('Beginn · Uhrzeit').fill('13:00');
  await dialog.getByLabel('Ende · Uhrzeit').fill('14:00');
  await dialog.getByRole('button', { name: /Schnellauswahl/ }).click();
  await picker.getByRole('tab', { name: 'Letzte Einträge' }).click();
  await picker.locator('.reuse-row').getByRole('button', { name: /übernehmen$/i }).click();
  await expect(dialog.getByLabel('Beginn · Uhrzeit')).toHaveValue('13:00');
  await expect(dialog.getByLabel('Ende · Uhrzeit')).toHaveValue('14:00');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
});

test('dirty picker protects edits and a failed or late save keeps the work draft', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tätigkeit optional').fill('Draft survives');
  await dialog.getByRole('button', { name: /Schnellauswahl/ }).click();
  const picker = dialog.getByRole('region', { name: 'Schnellauswahl' });
  await picker.getByRole('button', { name: 'Neue Vorlage' }).click();
  await picker.locator('.reuse-editor').getByLabel('Tätigkeit').fill('Unsaved');
  page.once('dialog', native => native.dismiss());
  await dialog.getByRole('button', { name: 'Dialog schließen', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(picker.locator('.reuse-editor').getByLabel('Tätigkeit')).toHaveValue('Unsaved');
  page.once('dialog', native => native.accept());
  await picker.locator('.reuse-editor').getByRole('button', { name: 'Zurück zur Schnellauswahl' }).click();
  await dialog.getByRole('button', { name: 'Zurück zur Arbeitszeit' }).click();
  await page.route('**/api/blocks', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Testfehler' }) });
    else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Testfehler');
  await expect(dialog.getByLabel('Tätigkeit optional')).toHaveValue('Draft survives');
  expect((await getState(page)).blocks).toHaveLength(0);
  await page.unroute('**/api/blocks');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/blocks', async route => {
    if (route.request().method() === 'POST') await held;
    await route.continue();
  });
  await dialog.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Arbeitszeit speichern …' })).toBeDisabled();
  const closeWork = dialog.getByRole('button', { name: 'Schließen', exact: true });
  await expect(closeWork).toBeEnabled();
  await closeWork.click();
  await expect(dialog).toHaveCount(0);
  release();
  await expect.poll(async () => (await getState(page)).blocks.length).toBe(1);
});

test('390px touch and keyboard use the picker without booking until Save', async ({ browser, localApp }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await seedGermanLanguage(context);
  try {
    const page = await context.newPage();
    await page.goto(localApp.url);
    await chooseWeek(page, '2026-09-28');
    await page.getByRole('button', { name: 'Schnellauswahl', exact: true }).tap();
    const picker = page.getByRole('dialog');
    await picker.getByRole('button', { name: 'Neue Vorlage' }).tap();
    const editor = picker.locator('.reuse-editor');
    await editor.getByLabel('Tätigkeit').fill('Mobil');
    await editor.getByLabel('Dauer in Minuten').fill('30');
    await editor.getByRole('button', { name: 'Vorlage speichern' }).tap();
    await expect(editor).toHaveCount(0);
    await picker.getByRole('tab', { name: 'Vorlagen' }).focus();
    await expect(picker.getByRole('tab', { name: 'Vorlagen' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(picker.getByRole('tab', { name: 'Letzte Einträge' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(picker.getByRole('tab', { name: 'Vorlagen' })).toHaveAttribute('aria-selected', 'true');
    await picker.locator('.reuse-row').getByRole('button', { name: /übernehmen$/i }).tap();
    const dialog = page.getByRole('dialog', { name: 'Arbeitszeit eintragen' });
    await expect(dialog.getByLabel('Tätigkeit optional')).toHaveValue('Mobil');
    expect((await getState(page)).blocks).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await dialog.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).tap();
    await expect(dialog).toHaveCount(0);
    expect((await getState(page)).blocks).toHaveLength(1);
  } finally { await context.close(); }
});
