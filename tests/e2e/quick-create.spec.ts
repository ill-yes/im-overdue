import { seedGermanLanguage } from './language-fixture';
import type { Page, Locator } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { test, expect, chooseWeek, getState } from './isolated-fixture';
import { minutesBetween } from '../../shared/time.js';
import type { AppState, BlockInput, ReusableInput } from '../../shared/types.js';

const quick = (page: Page) => page.getByRole('dialog', { name: 'Schnellerfassung', exact: true });
const list = (page: Page) => quick(page).getByRole('region', { name: 'Schnellauswahl', exact: true });
const lane = (page: Page, date = '2026-09-28') => page.locator(`[data-work-lane][data-date="${date}"]`);

async function mutate(page: Page, path: string, method: string, input: object): Promise<AppState> {
  const current = await getState(page);
  const response = await page.request.fetch(path, {
    method, headers: { Origin: new URL(page.url()).origin },
    data: { ...input, expectedRevision: current.revision },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function seed(page: Page, templates: ReusableInput[] = [], blocks: BlockInput[] = []) {
  for (const template of templates) await mutate(page, '/api/templates', 'POST', template);
  for (const block of blocks) await mutate(page, '/api/blocks', 'POST', block);
  await page.reload();
  await chooseWeek(page, '2026-09-28');
}

async function draw(page: Page, date = '2026-09-28', from = 480, to = 540) {
  const workLane = lane(page, date);
  const scroll = page.locator('.ov-calendar-scroll');
  await scroll.scrollIntoViewIfNeeded();
  await scroll.evaluate((element, values) => {
    const target = element.querySelector<HTMLElement>(`[data-work-lane][data-date="${values.date}"]`);
    if (!target) throw new Error('Missing draw lane');
    const frame = element.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    element.scrollLeft += box.left + box.width / 2 - frame.left - frame.width / 2;
    element.scrollTop = Math.max(0, values.from * 56 / 60 - 90);
  }, { date, from });
  const box = await workLane.boundingBox();
  if (!box) throw new Error(`Missing work lane ${date}`);
  await page.mouse.move(box.x + box.width / 2, box.y + from * 56 / 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + to * 56 / 60, { steps: 10 });
  await page.mouse.up();
  await expect(quick(page)).toBeVisible();
  return quick(page);
}

async function setup(page: Page) {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
}

test('clicking a four-minute bounded gap keeps exact endpoints and writes only on save', async ({ page }) => {
  await setup(page);
  await seed(page, [], [
    { start: '2026-09-28T06:00:00Z', end: '2026-09-28T07:07:00Z', title: 'Davor', note: '' },
    { start: '2026-09-28T07:11:00Z', end: '2026-09-28T08:00:00Z', title: 'Danach', note: '' },
  ]);
  const before = await getState(page);
  const gap = lane(page).getByRole('button', { name: 'Zeitlücke 09:07–09:11 füllen', exact: true });
  await gap.focus();
  await page.keyboard.press('Enter');
  await expect(quick(page)).toBeVisible();
  expect(await getState(page)).toEqual(before);
  await quick(page).getByLabel('Tätigkeit', { exact: true }).fill('Exakte Lücke');
  await quick(page).getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(quick(page)).toHaveCount(0);
  const created = (await getState(page)).blocks.find(block => block.title === 'Exakte Lücke');
  expect(created).toMatchObject({ start: '2026-09-28T07:07:00Z', end: '2026-09-28T07:11:00Z' });
  expect(minutesBetween(created!.start, created!.end)).toBe(4);
});

test('a repeated-hour DST gap saves the exact real-time interval', async ({ page }) => {
  await setup(page);
  await seed(page, [], [
    { start: '2026-10-25T00:00:00Z', end: '2026-10-25T00:45:00Z', title: 'Erste Stunde', note: '' },
    { start: '2026-10-25T01:15:00Z', end: '2026-10-25T02:00:00Z', title: 'Zweite Stunde', note: '' },
  ]);
  await chooseWeek(page, '2026-10-25');
  await page.locator('.ov-calendar-scroll').evaluate(element => { element.scrollTop = 0; element.scrollLeft = element.scrollWidth; });
  const gap = lane(page, '2026-10-25').locator('[data-work-gap]');
  await expect(gap).toHaveCount(1);
  await gap.click();
  await expect(quick(page)).toBeVisible();
  await quick(page).getByLabel('Tätigkeit', { exact: true }).fill('Zeitumstellung');
  await quick(page).getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(quick(page)).toHaveCount(0);
  const created = (await getState(page)).blocks.find(block => block.title === 'Zeitumstellung');
  expect(created).toMatchObject({ start: '2026-10-25T00:45:00Z', end: '2026-10-25T01:15:00Z' });
  expect(minutesBetween(created!.start, created!.end)).toBe(30);
});

test('dragging inside a bounded gap draws a shorter draft while outside gaps opens the full editor', async ({ page }) => {
  await setup(page);
  await seed(page, [], [
    { start: '2026-09-28T06:00:00Z', end: '2026-09-28T07:00:00Z', title: 'Davor', note: '' },
    { start: '2026-09-28T09:00:00Z', end: '2026-09-28T10:00:00Z', title: 'Danach', note: '' },
  ]);
  const before = await getState(page);
  await draw(page, '2026-09-28', 570, 600);
  await quick(page).getByLabel('Tätigkeit', { exact: true }).fill('Gezogener Teil');
  await quick(page).getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(quick(page)).toHaveCount(0);
  expect((await getState(page)).blocks.find(block => block.title === 'Gezogener Teil')).toMatchObject({
    start: '2026-09-28T07:30:00Z', end: '2026-09-28T08:00:00Z',
  });
  for (const minute of [420, 780]) {
    await page.locator('.ov-calendar-scroll').evaluate((element, minute) => { element.scrollTop = minute * 56 / 60 - 90; }, minute);
    const box = (await lane(page).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + minute * 56 / 60);
    await expect(page.getByRole('dialog', { name: 'Arbeitszeit eintragen', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  }
  expect((await getState(page)).blocks).toHaveLength(before.blocks.length + 1);
});

for (const input of ['mouse', 'touch'] as const) {
  test(`${input} fallback opens a visually swallowed four-minute gap without writing until save`, async ({ browser, localApp }, testInfo) => {
    const context = await browser.newContext({
      baseURL: localApp.url, viewport: { width: input === 'touch' ? 390 : 1440, height: input === 'touch' ? 844 : 1000 },
      hasTouch: input === 'touch', isMobile: input === 'touch',
    });
    await seedGermanLanguage(context);
    try {
      const page = await context.newPage();
      await setup(page);
      await seed(page, [], [
        { start: '2026-09-28T07:00:00Z', end: '2026-09-28T07:01:00Z', title: 'Eine Minute', note: '' },
        { start: '2026-09-28T07:05:00Z', end: '2026-09-28T08:00:00Z', title: 'Danach', note: '' },
      ]);
      const before = await getState(page);
      let writes = 0;
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/blocks') writes++; });
      const trigger = page.getByRole('button', { name: 'Kleine Lücken (1)', exact: true });
      const choices = page.getByRole('group', { name: 'Kleine Zeitlücken', exact: true });
      const choice = choices.getByRole('button', { name: 'Zeitlücke am 28.09.2026 09:01–09:05 füllen', exact: true });
      const activate = async (locator: Locator) => { if (input === 'touch') await locator.tap(); else await locator.click(); };
      await activate(trigger);
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(choice).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`small-gap-${input}-choices-viewport.png`) });
      await activate(choice);
      await expect(choices).toHaveCount(0);
      await expect(quick(page)).toBeVisible();
      await expect(page.locator('[data-quick-preview]')).toContainText('09:01–09:05');
      await assertWithinViewport(quick(page), page);
      await page.screenshot({ path: testInfo.outputPath(`small-gap-${input}-quick-viewport.png`) });
      expect(await getState(page)).toEqual(before);
      expect(writes).toBe(0);
      await activate(quick(page).getByRole('button', { name: 'Schnellerfassung schließen', exact: true }));
      expect(await getState(page)).toEqual(before);
      expect(writes).toBe(0);
      await activate(trigger);
      await activate(choice);
      await expect(quick(page)).toBeVisible();
      await quick(page).getByLabel('Tätigkeit', { exact: true }).fill('Vier Minuten aus der Auswahl');
      await activate(quick(page).getByRole('button', { name: 'Speichern', exact: true }));
      await expect(quick(page)).toHaveCount(0);
      expect(writes).toBe(1);
      const block = (await getState(page)).blocks.find(value => value.title === 'Vier Minuten aus der Auswahl');
      expect(block).toMatchObject({ start: '2026-09-28T07:01:00Z', end: '2026-09-28T07:05:00Z' });
      expect(minutesBetween(block!.start, block!.end)).toBe(4);
    } finally { await context.close(); }
  });
}

test('small-gap fallback scrolls an offscreen Sunday anchor into the mobile calendar before opening quick capture', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await seed(page, [], [
    { start: '2026-10-04T07:00:00Z', end: '2026-10-04T07:01:00Z', title: 'Sonntag kurz', note: '' },
    { start: '2026-10-04T07:05:00Z', end: '2026-10-04T08:00:00Z', title: 'Sonntag danach', note: '' },
  ]);
  const before = await getState(page);
  const scroll = page.locator('.ov-calendar-scroll');
  await scroll.evaluate(element => { element.scrollLeft = 0; element.scrollTop = 20 * 56; });
  await expect(page.locator('[data-calendar-day="2026-10-04"] .ov-day-date')).not.toBeInViewport();
  await page.getByRole('button', { name: 'Kleine Lücken (1)', exact: true }).click();
  await page.getByRole('group', { name: 'Kleine Zeitlücken', exact: true }).getByRole('button', { name: 'Zeitlücke am 04.10.2026 09:01–09:05 füllen', exact: true }).click();
  await expect(quick(page)).toBeVisible();
  await expect(page.locator('[data-calendar-day="2026-10-04"] .ov-day-date')).toBeInViewport();
  await expect(lane(page, '2026-10-04').locator('[data-quick-preview]')).toBeInViewport();
  await expect(lane(page, '2026-10-04').locator('[data-quick-preview]')).toContainText('09:01–09:05');
  expect(await scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  expect(await scroll.evaluate(element => element.scrollTop)).toBeLessThan(10 * 56);
  await assertWithinViewport(quick(page), page);
  await quick(page).getByRole('button', { name: 'Schnellerfassung schließen', exact: true }).click();
  expect(await getState(page)).toEqual(before);
});

test('Escape closes the small-gap disclosure and restores its trigger before leaving calendar focus mode', async ({ page }) => {
  await setup(page);
  await seed(page, [], [
    { start: '2026-09-28T07:00:00Z', end: '2026-09-28T07:01:00Z', title: 'Kurz', note: '' },
    { start: '2026-09-28T07:05:00Z', end: '2026-09-28T08:00:00Z', title: 'Danach', note: '' },
  ]);
  const before = await getState(page);
  await page.getByRole('button', { name: 'Fokusansicht', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Kleine Lücken (1)', exact: true });
  await trigger.click();
  const choices = page.getByRole('group', { name: 'Kleine Zeitlücken', exact: true });
  await choices.getByRole('button').focus();
  await page.keyboard.press('Escape');
  await expect(choices).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.app-shell')).toHaveClass(/calendar-focused/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/calendar-focused/);
  expect(await getState(page)).toEqual(before);
});

async function assertWithinViewport(locator: Locator, page: Page) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

for (const title of ['Konzeptarbeit', '']) {
  test(`draw opens nonmodal quick capture and saves ${title ? 'a custom title' : 'an empty title'}`, async ({ page }) => {
    await setup(page);
    const dialog = await draw(page, '2026-09-28', 480, 600);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(dialog).not.toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('.modal-backdrop')).toHaveCount(0);
    await expect(page.locator('.block-dialog-form')).toHaveCount(0);
    await expect(dialog.getByLabel('Tätigkeit', { exact: true })).toBeFocused();
    await expect(page.locator('[data-quick-preview]')).toHaveCount(1);
    expect((await getState(page)).blocks).toHaveLength(0);
    await dialog.getByLabel('Tätigkeit', { exact: true }).fill(title);
    if (title) await dialog.getByLabel('Tätigkeit', { exact: true }).press('Enter');
    else await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-quick-preview]')).toHaveCount(0);
    const state = await getState(page);
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({ title, note: '', start: '2026-09-28T06:00:00Z', end: '2026-09-28T08:00:00Z' });
    await expect(page.locator(`[data-work-block="${state.blocks[0].id}"]`)).toBeFocused();
    await page.reload();
    expect((await getState(page)).blocks[0].title).toBe(title);
  });
}

for (const nextInteraction of ['none', 'focus', 'dismiss'] as const) {
  test(`quick save waits for the DOM commit with ${nextInteraction === 'none' ? 'focus on the saved block' : `a newer ${nextInteraction} interaction`}`, async ({ page }) => {
    // Hold React's scheduled rendering while native animation frames continue.
    // This forces the save response to arrive before the menu's removal commits.
    await page.addInitScript(() => {
      const postMessage = MessagePort.prototype.postMessage;
      let held = false;
      const messages: Array<() => void> = [];
      MessagePort.prototype.postMessage = function (message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        const post = () => Reflect.apply(postMessage, this, [message, options]);
        if (held) messages.push(post);
        else post();
      };
      Object.assign(window, {
        quickCommitGate: {
          hold: () => { held = true; },
          release: () => { held = false; messages.splice(0).forEach(post => post()); },
        },
      });
    });
    await setup(page);
    const dialog = await draw(page);
    await dialog.getByLabel('Tätigkeit', { exact: true }).fill('Commit-Fokus');
    await page.evaluate(() => (window as unknown as { quickCommitGate: { hold: () => void } }).quickCommitGate.hold());
    try {
      await dialog.getByLabel('Tätigkeit', { exact: true }).press('Enter');
      await expect.poll(async () => (await getState(page)).blocks).toHaveLength(1);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(dialog).toBeVisible();
      const nextTarget = page.getByLabel('Woche über Datum wählen');
      if (nextInteraction === 'focus') await nextTarget.focus();
      if (nextInteraction === 'dismiss') await page.keyboard.press('Escape');
      await page.evaluate(() => (window as unknown as { quickCommitGate: { release: () => void } }).quickCommitGate.release());
      await expect(dialog).toHaveCount(0);
      const created = (await getState(page)).blocks[0];
      expect(created.title).toBe('Commit-Fokus');
      const expectedFocus = nextInteraction === 'focus' ? nextTarget : nextInteraction === 'dismiss' ? page.locator('body') : page.locator(`[data-work-block="${created.id}"]`);
      await expect(expectedFocus).toBeFocused();
    } finally {
      await page.evaluate(() => (window as unknown as { quickCommitGate: { release: () => void } }).quickCommitGate.release());
    }
  });
}

for (const source of ['recent', 'template'] as const) {
  test(`direct ${source} selection copies title and note, keeps drawn duration and supports Undo`, async ({ page }) => {
    await setup(page);
    const entry = { title: 'Wiederverwendung', note: 'Besprechung mit Team', durationMinutes: 150 };
    await seed(page, source === 'template' ? [entry] : [], source === 'recent' ? [
      { title: entry.title, note: entry.note, start: '2026-09-29T06:00:00Z', end: '2026-09-29T08:30:00Z' },
    ] : []);
    const before = await getState(page);
    const dialog = await draw(page, '2026-09-28', 600, 645);
    await expect(page.getByRole('button', { name: /Rückgängig/ })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Schnellauswahl', exact: true }).click();
    await list(page).getByRole('button', { name: 'Wiederverwendung übernehmen', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const state = await getState(page);
    const created = state.blocks.find(block => !before.blocks.some(old => old.id === block.id))!;
    expect(created).toMatchObject({ title: entry.title, note: entry.note, start: '2026-09-28T08:00:00Z', end: '2026-09-28T08:45:00Z' });
    expect(minutesBetween(created.start, created.end)).toBe(45);
    expect(state.templates).toEqual(before.templates);
    await page.getByRole('button', { name: /Rückgängig/ }).click();
    await expect.poll(async () => (await getState(page)).blocks).toEqual(before.blocks);
  });
}

test('quick selection orders recent, templates and older entries, deduplicates title/note and searches both', async ({ page, localApp }) => {
  await setup(page);
  await seed(page, [
    { title: 'Doppelt', note: 'Gemeinsame Notiz', durationMinutes: 180 },
    { title: 'Doppelt', note: 'Gemeinsame Notiz', durationMinutes: 90 },
    { title: 'Vorlage', note: 'Nur im Kommentar auffindbar', durationMinutes: 30 },
    { title: 'Doppelt', note: 'Andere Notiz', durationMinutes: 60 },
  ], [
    { title: 'Früher erstellt', note: '', start: '2026-09-29T06:00:00Z', end: '2026-09-29T07:00:00Z' },
    { title: 'Doppelt', note: 'Gemeinsame Notiz', start: '2026-09-30T06:00:00Z', end: '2026-09-30T07:00:00Z' },
  ]);
  // Legacy-only metadata is seeded exclusively in this test's temporary database.
  const database = new DatabaseSync(join(localApp.directory, 'app.sqlite'));
  try {
    database.prepare('INSERT INTO blocks(id,start,end,title,note,created_at) VALUES (?,?,?,?,?,NULL)')
      .run('legacy-quick', '2026-09-27T06:00:00Z', '2026-09-27T07:00:00Z', 'Älterer Eintrag', 'Altbestand');
  } finally { database.close(); }
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  await draw(page);
  await quick(page).getByRole('button', { name: 'Schnellauswahl', exact: true }).click();
  const choices = list(page).getByRole('button', { name: /übernehmen$/ });
  await expect(choices).toHaveCount(6);
  expect(await choices.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual([
    'Doppelt übernehmen', 'Früher erstellt übernehmen', 'Doppelt übernehmen', 'Vorlage übernehmen', 'Doppelt übernehmen', 'Älterer Eintrag übernehmen',
  ]);
  await expect(list(page).getByRole('region', { name: 'Letzte Einträge', exact: true }).getByRole('button', { name: 'Doppelt übernehmen', exact: true })).toHaveCount(1);
  await expect(list(page).getByRole('region', { name: 'Vorlagen', exact: true }).getByRole('button', { name: 'Doppelt übernehmen', exact: true })).toHaveCount(2);
  const search = list(page).getByRole('searchbox', { name: 'Tätigkeit oder Notiz suchen' });
  await search.fill('kommentar');
  await expect(choices).toHaveCount(1);
  await expect(choices).toHaveAccessibleName('Vorlage übernehmen');
  await search.fill('doppelt gemeinsame');
  await expect(choices).toHaveCount(2);
  await search.fill('unauffindbar');
  await expect(choices).toHaveCount(0);
  expect((await getState(page)).blocks).toHaveLength(3);
});

test('keyboard opens selection; Escape closes submenu, then quick capture, then focus', async ({ page }) => {
  await setup(page);
  await seed(page, [{ title: 'Tastatur-Auswahl', note: '', durationMinutes: 30 }]);
  await page.getByRole('button', { name: 'Fokusansicht' }).click();
  const dialog = await draw(page);
  const trigger = dialog.getByRole('button', { name: 'Schnellauswahl', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowRight');
  await expect(list(page)).toBeVisible();
  await expect(list(page).getByRole('searchbox')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(list(page).getByRole('button', { name: 'Tastatur-Auswahl übernehmen' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(list(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(lane(page)).toBeFocused();
  await expect(page.locator('.app-shell')).toHaveClass(/calendar-focused/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/calendar-focused/);
  expect((await getState(page)).blocks).toHaveLength(0);
});

test('hover opens quick selection and crossing the desktop submenu gap keeps it reachable', async ({ page }) => {
  await setup(page);
  await seed(page, [{ title: 'Hover-Auswahl', note: '', durationMinutes: 120 }]);
  const dialog = await draw(page);
  const trigger = dialog.getByRole('button', { name: 'Schnellauswahl', exact: true });
  await trigger.hover();
  await expect(list(page)).toBeVisible();
  const triggerBox = (await trigger.boundingBox())!;
  const listBox = (await list(page).boundingBox())!;
  const listOnRight = listBox.x > triggerBox.x;
  const gapX = listOnRight
    ? (triggerBox.x + triggerBox.width + listBox.x) / 2
    : (listBox.x + listBox.width + triggerBox.x) / 2;
  await page.mouse.move(gapX, Math.max(triggerBox.y, listBox.y) + 10);
  await expect(list(page)).toBeVisible();
  await list(page).getByRole('button', { name: 'Hover-Auswahl übernehmen' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await getState(page)).blocks[0].title).toBe('Hover-Auswahl');
});

for (const width of [390, 800]) {
test(`${width}px inline physical trigger click opens the list without selecting an entry underneath`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await setup(page);
  await seed(page, [{ title: 'Nicht versehentlich buchen', note: '', durationMinutes: 180 }]);
  const dialog = await draw(page);
  const trigger = dialog.getByRole('button', { name: 'Schnellauswahl', exact: true });
  await trigger.hover();
  await expect(list(page)).toHaveCount(0);
  const box = (await trigger.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(list(page)).toBeVisible();
  await expect(list(page).getByRole('searchbox')).toBeFocused();
  expect((await getState(page)).blocks).toHaveLength(0);
  await list(page).getByRole('button', { name: 'Nicht versehentlich buchen übernehmen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await getState(page)).blocks).toHaveLength(1);
});
}

test('close, outside click, focus exit and calendar navigation discard the draft without a block request', async ({ page }) => {
  let requests = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/blocks') requests++; });
  for (const exit of ['close', 'outside', 'focus', 'week', 'month'] as const) {
    await setup(page);
    const dialog = await draw(page);
    await dialog.getByLabel('Tätigkeit', { exact: true }).fill('Verwerfen');
    if (exit === 'close') await dialog.getByRole('button', { name: 'Schnellerfassung schließen' }).click();
    if (exit === 'outside') await page.getByRole('heading', { name: 'Wochenkalender', exact: true }).click();
    if (exit === 'focus') await page.getByLabel('Woche über Datum wählen').focus();
    if (exit === 'week') await chooseWeek(page, '2026-10-05');
    if (exit === 'month') await page.getByRole('group', { name: 'Kalenderansicht' }).getByRole('button', { name: 'Monat', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-quick-preview]')).toHaveCount(0);
    expect(requests).toBe(0);
    expect((await getState(page)).blocks).toHaveLength(0);
  }
});

test('drawing a new interval replaces an unsaved capture without writing the old draft', async ({ page }) => {
  await setup(page);
  const dialog = await draw(page);
  await dialog.getByLabel('Tätigkeit', { exact: true }).fill('Alter ungespeicherter Entwurf');
  const box = (await lane(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 600 * 56 / 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 660 * 56 / 60, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Tätigkeit', { exact: true })).toHaveValue('');
  await expect(page.locator('[data-quick-preview]')).toHaveCount(1);
  expect((await getState(page)).blocks).toHaveLength(0);
  await dialog.getByLabel('Tätigkeit', { exact: true }).fill('Neuer Entwurf');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await getState(page)).blocks).toEqual([expect.objectContaining({ title: 'Neuer Entwurf', start: '2026-09-28T08:00:00Z', end: '2026-09-28T09:00:00Z' })]);
});

test('quick capture prevents global keyboard Undo and a physical click on the disabled toolbar Undo', async ({ page }) => {
  await setup(page);
  await seed(page, [], [{ title: 'Bleibt gespeichert', note: '', start: '2026-09-29T06:00:00Z', end: '2026-09-29T07:00:00Z' }]);
  const before = await getState(page);
  let undoRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/blocks/undo') undoRequests++; });
  const dialog = await draw(page);
  await dialog.getByLabel('Tätigkeit', { exact: true }).press('ControlOrMeta+z');
  await expect(dialog).toBeVisible();
  await dialog.locator('header').evaluate(element => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, metaKey: true, bubbles: true }));
  });
  await expect(dialog).toBeVisible();
  expect(await getState(page)).toEqual(before);
  const undo = page.getByRole('button', { name: /Rückgängig/ });
  await expect(undo).toBeDisabled();
  const box = (await undo.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(undoRequests).toBe(0);
  expect(await getState(page)).toEqual(before);
});

test('touch keeps full time entry and can choose from an inline quick list after mouse drawing', async ({ browser, localApp }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await seedGermanLanguage(context);
  try {
    const page = await context.newPage();
    await page.goto(localApp.url);
    await chooseWeek(page, '2026-09-28');
    await seed(page, [{ title: 'Touch-Auswahl', note: 'Per Antippen', durationMinutes: 180 }]);
    await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).tap();
    const details = page.getByRole('dialog', { name: 'Arbeitszeit eintragen', exact: true });
    await expect(details).toBeVisible();
    await expect(quick(page)).toHaveCount(0);
    await expect(details.getByLabel('Beginn · Uhrzeit')).toBeVisible();
    await details.getByRole('button', { name: 'Abbrechen', exact: true }).tap();
    expect((await getState(page)).blocks).toHaveLength(0);
    const dialog = await draw(page);
    await dialog.getByRole('button', { name: 'Schnellauswahl', exact: true }).tap();
    await expect(list(page)).toBeVisible();
    await assertWithinViewport(list(page), page);
    await list(page).getByRole('button', { name: 'Touch-Auswahl übernehmen', exact: true }).tap();
    await expect(dialog).toHaveCount(0);
    expect((await getState(page)).blocks[0]).toMatchObject({ title: 'Touch-Auswahl', note: 'Per Antippen', start: '2026-09-28T06:00:00Z', end: '2026-09-28T07:00:00Z' });
  } finally { await context.close(); }
});

test('Details carries title and exact drawn times through ordinary, spring and autumn days', async ({ page }) => {
  await setup(page);
  for (const scenario of [
    { week: '2026-09-28', date: '2026-09-28', from: 480, to: 540, start: '08:00', end: '09:00', isoStart: '2026-09-28T06:00:00Z', isoEnd: '2026-09-28T07:00:00Z' },
    { week: '2026-03-23', date: '2026-03-29', from: 60, to: 180, start: '01:00', end: '04:00', isoStart: '2026-03-29T00:00:00Z', isoEnd: '2026-03-29T02:00:00Z' },
    { week: '2026-10-19', date: '2026-10-25', from: 120, to: 180, start: '02:00', end: '02:00', isoStart: '2026-10-25T00:00:00Z', isoEnd: '2026-10-25T01:00:00Z' },
  ]) {
    await chooseWeek(page, scenario.week);
    const dialog = await draw(page, scenario.date, scenario.from, scenario.to);
    await dialog.getByLabel('Tätigkeit', { exact: true }).fill(`Details ${scenario.date}`);
    await dialog.getByRole('button', { name: 'Details bearbeiten …', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const details = page.getByRole('dialog', { name: 'Arbeitszeit eintragen' });
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(details.getByLabel('Tätigkeit optional')).toHaveValue(`Details ${scenario.date}`);
    await expect(details.getByLabel('Beginn · Datum')).toHaveValue(scenario.date);
    await expect(details.getByLabel('Beginn · Uhrzeit')).toHaveValue(scenario.start);
    await expect(details.getByLabel('Ende · Uhrzeit')).toHaveValue(scenario.end);
    if (scenario.date === '2026-10-25') {
      await expect(details.getByLabel('Beginn liegt zweimal vor')).toHaveValue('earlier');
      await expect(details.getByLabel('Ende liegt zweimal vor')).toHaveValue('later');
    }
    await details.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
    await expect(details).toHaveCount(0);
    expect((await getState(page)).blocks.find(block => block.title === `Details ${scenario.date}`))
      .toMatchObject({ start: scenario.isoStart, end: scenario.isoEnd });
  }
});

for (const width of [390, 1440]) {
  test(`${width}px edge anchor keeps capture and quick selection inside the viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await setup(page);
    await seed(page, Array.from({ length: 20 }, (_, index) => ({ title: `Auswahl ${index}`, note: 'Eine Notiz', durationMinutes: 30 })));
    const dialog = await draw(page, '2026-10-04', 900, 945);
    await assertWithinViewport(dialog, page);
    await dialog.getByRole('button', { name: 'Schnellauswahl', exact: true }).click();
    await expect(list(page)).toBeVisible();
    await assertWithinViewport(list(page), page);
    const mainBox = (await dialog.boundingBox())!;
    const listBox = (await list(page).boundingBox())!;
    if (width === 390) {
      expect(listBox.x).toBeGreaterThanOrEqual(mainBox.x - 1);
      expect(listBox.x + listBox.width).toBeLessThanOrEqual(mainBox.x + mainBox.width + 1);
    } else {
      expect(listBox.x + listBox.width <= mainBox.x + 1 || listBox.x >= mainBox.x + mainBox.width - 1).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`quick-capture-${width}.png`) });
    await list(page).getByRole('searchbox').fill('Auswahl 19');
    await list(page).getByRole('button', { name: 'Auswahl 19 übernehmen', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await getState(page)).blocks[0].title).toBe('Auswahl 19');
  });
}

test('capture follows a visible anchor on scroll and discards it when the anchor leaves view', async ({ page }) => {
  await setup(page);
  const dialog = await draw(page, '2026-09-28', 540, 600);
  const scroll = page.locator('.ov-calendar-scroll');
  const before = (await dialog.boundingBox())!;
  await scroll.evaluate(element => { element.scrollTop += 28; });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => (await dialog.boundingBox())!.y).toBeLessThan(before.y);
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-quick-preview]')).toHaveCount(0);
  expect((await getState(page)).blocks).toHaveLength(0);
});

test('declining a closed-week reopen keeps quick title and exact interval without a write', async ({ page }) => {
  await setup(page);
  await mutate(page, '/api/weeks/2026-09-28', 'POST', { status: 'closed', confirmCurrent: true, confirmWarnings: true });
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  const before = await getState(page);
  const dialog = await draw(page);
  await dialog.getByLabel('Tätigkeit', { exact: true }).fill('Abgeschlossene Woche');
  page.once('dialog', native => native.dismiss());
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Tätigkeit', { exact: true })).toHaveValue('Abgeschlossene Woche');
  await expect(dialog.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
  expect(await getState(page)).toEqual(before);
  page.once('dialog', native => native.accept());
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await getState(page)).blocks[0]).toMatchObject({ start: '2026-09-28T06:00:00Z', end: '2026-09-28T07:00:00Z' });
});

test('revision conflict refresh retains quick draft; retry reports overlap without losing it', async ({ page }) => {
  await setup(page);
  const dialog = await draw(page);
  await dialog.getByLabel('Tätigkeit', { exact: true }).fill('Mein Entwurf');
  await mutate(page, '/api/blocks', 'POST', { title: 'Parallel', note: '', start: '2026-09-28T06:00:00Z', end: '2026-09-28T07:00:00Z' });
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('zwischenzeitlich geändert');
  await expect(dialog.getByLabel('Tätigkeit', { exact: true })).toHaveValue('Mein Entwurf');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Arbeitsblöcke dürfen sich nicht überschneiden.');
  await expect(dialog.getByLabel('Tätigkeit', { exact: true })).toHaveValue('Mein Entwurf');
  await expect(page.locator('[data-quick-preview]')).toHaveCount(1);
  expect((await getState(page)).blocks.map(block => block.title)).toEqual(['Parallel']);
});

test('a rejected direct choice retains its title and note; retry uses the drawn interval', async ({ page }) => {
  await setup(page);
  await seed(page, [{ title: 'Fehlversuch', note: 'Notiz bleibt', durationMinutes: 180 }]);
  const dialog = await draw(page);
  await dialog.getByRole('button', { name: 'Schnellauswahl', exact: true }).click();
  await page.route('**/api/blocks', route => route.fulfill({ status: 503, json: { message: 'Schnellspeicherung fehlgeschlagen' } }));
  await list(page).getByRole('button', { name: 'Fehlversuch übernehmen', exact: true }).click();
  await expect(dialog.getByRole('alert').first()).toContainText('Schnellspeicherung fehlgeschlagen');
  await page.keyboard.press('Escape');
  await expect(dialog.getByLabel('Tätigkeit', { exact: true })).toHaveValue('Fehlversuch');
  await expect(dialog).toContainText('Notiz bleibt');
  expect((await getState(page)).blocks).toHaveLength(0);
  await page.unroute('**/api/blocks');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await getState(page)).blocks[0]).toMatchObject({ title: 'Fehlversuch', note: 'Notiz bleibt', start: '2026-09-28T06:00:00Z', end: '2026-09-28T07:00:00Z' });
});

test('a timezone conflict followed by Details keeps the original zone and drawn instants', async ({ page }) => {
  await setup(page);
  const dialog = await draw(page);
  await dialog.getByLabel('Tätigkeit', { exact: true }).fill('Zeitzonenentwurf');
  await mutate(page, '/api/settings', 'PUT', { timezone: 'America/New_York' });
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('zwischenzeitlich geändert');
  await expect(dialog.getByLabel('Tätigkeit', { exact: true })).toHaveValue('Zeitzonenentwurf');
  await dialog.getByRole('button', { name: 'Details bearbeiten …', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Arbeitszeit eintragen' });
  await expect(details.getByLabel('Beginn · Uhrzeit')).toHaveValue('08:00');
  await expect(details.getByLabel('Ende · Uhrzeit')).toHaveValue('09:00');
  await expect(details.getByRole('status')).toContainText('bleibt in Europe/Berlin');
  await details.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(details).toHaveCount(0);
  expect((await getState(page)).blocks[0]).toMatchObject({ title: 'Zeitzonenentwurf', start: '2026-09-28T06:00:00Z', end: '2026-09-28T07:00:00Z' });
});

for (const result of ['success', 'failure'] as const) {
  test(`late quick ${result} cannot contaminate a newer session; pending locks and double submit are guarded`, async ({ page }) => {
    await setup(page);
    const old = await draw(page);
    await old.getByLabel('Tätigkeit', { exact: true }).fill('Alter Entwurf');
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/api/blocks', async route => {
      requests++;
      await held;
      if (result === 'success') await route.fulfill({ response: await route.fetch() });
      else await route.fulfill({ status: 503, json: { message: 'Alter Speicherfehler' } });
    });
    try {
      const save = old.getByRole('button', { name: 'Speichern', exact: true });
      await save.click();
      await expect.poll(() => requests).toBe(1);
      await expect(old.getByLabel('Tätigkeit', { exact: true })).toBeDisabled();
      await expect(old.getByRole('button', { name: 'Schnellauswahl', exact: true })).toBeDisabled();
      await expect(old.getByRole('button', { name: 'Details bearbeiten …' })).toBeDisabled();
      await old.locator('form').dispatchEvent('submit');
      expect(requests).toBe(1);
      await expect(old.getByRole('button', { name: 'Schnellerfassung schließen' })).toBeEnabled();
      await old.getByRole('button', { name: 'Schnellerfassung schließen' }).click();
      await expect(old).toHaveCount(0);
      const current = await draw(page, '2026-09-29', 600, 660);
      await expect(current.getByLabel('Tätigkeit', { exact: true })).toBeEnabled();
      await current.getByLabel('Tätigkeit', { exact: true }).fill('Neuer Entwurf');
      await expect(current.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
      await current.locator('form').dispatchEvent('submit');
      expect(requests).toBe(1);
      release();
      await expect(current.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
      await expect(current).toBeVisible();
      await expect(current.getByLabel('Tätigkeit', { exact: true })).toHaveValue('Neuer Entwurf');
      await expect(current.getByRole('alert')).toHaveCount(0);
      await expect(current.getByLabel('Tätigkeit', { exact: true })).toBeFocused();
      const state = await getState(page);
      expect(state.blocks.map(block => block.title)).toEqual(result === 'success' ? ['Alter Entwurf'] : []);
      await page.unroute('**/api/blocks');
      await current.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(current).toHaveCount(0);
      const created = (await getState(page)).blocks.find(block => block.title === 'Neuer Entwurf')!;
      expect(created).toMatchObject({ start: '2026-09-29T08:00:00Z', end: '2026-09-29T09:00:00Z' });
    } finally { release(); }
  });
}
