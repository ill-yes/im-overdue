import type { Page } from '@playwright/test';
import { test, expect, chooseWeek, getState, openSourceFilters, openAppAction, createFilterSource } from './isolated-fixture';

const route = (page: Page, name: 'Kalender' | 'Zeitkonto' | 'Vorlagen') => page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name, exact: true });
const templates = (page: Page) => page.getByRole('region', { name: 'Vorlagen', exact: true });
const reports = (page: Page) => page.getByRole('region', { name: 'Zeitkonto', exact: true });

for (const width of [1440, 390]) {
  test(`app action waits for the loaded header before choosing its ${width}px layout`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let waiting = false;
    // Session readiness mounts AppHeader; state alone only holds its content.
    // Gate both startup requests so the helper starts before layout is known.
    await page.route(/\/api\/(?:auth\/session|state)$/, async route => {
      waiting = true;
      await held;
      await route.continue();
    });
    try {
      await page.goto('/');
      await expect.poll(() => waiting).toBe(true);
      const opening = openAppAction(page, 'Einstellungen');
      // This browser round trip follows the helper's first locator operation,
      // so an eager layout decision observes the header while it is still absent.
      await expect(page.locator('.site-header')).toHaveCount(0);
      release();
      await opening;
      await expect(page.locator('.site-header')).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(page.getByRole('dialog', { name: 'Einstellungen', exact: true })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Allgemein', exact: true })).toHaveAttribute('aria-selected', 'true');
    } finally { release(); }
  });
}

async function seed(page: Page) {
  await page.goto('/');
  for (const [path, values] of [
    ['/api/templates', { title: 'Konzeptarbeit', note: 'Entwurf', durationMinutes: 90 }],
    ['/api/blocks', { title: 'Konzeptarbeit', note: '', start: '2026-09-28T06:00:00Z', end: '2026-09-28T07:30:00Z' }],
  ] as const) {
    const before = await getState(page);
    const response = await page.request.post(path, { headers: { Origin: new URL(page.url()).origin }, data: { ...values, expectedRevision: before.revision } });
    expect(response.status()).toBe(200);
  }
  await page.reload();
  await chooseWeek(page, '2026-09-28');
}

test('main pages support direct hashes, history back and forward without modals', async ({ page }) => {
  await page.goto('/#/kalender');
  await expect(page.locator('[data-calendar-day]')).toHaveCount(7);
  await route(page, 'Zeitkonto').click();
  await expect(page).toHaveURL(/#\/zeitkonto$/);
  await expect(reports(page)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await route(page, 'Vorlagen').click();
  await expect(page).toHaveURL(/#\/vorlagen$/);
  await expect(templates(page)).toBeVisible();
  await page.goBack();
  await expect(reports(page)).toBeVisible();
  await page.goForward();
  await expect(templates(page)).toBeVisible();
  for (const [hash, title] of [['zeitkonto', 'Zeitkonto'], ['vorlagen', 'Vorlagen']] as const) {
    await page.goto(`/#/${hash}`);
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('account tabs support arrow, Home and End keys with one tab stop', async ({ page }) => {
  await page.goto('/#/zeitkonto');
  const hours = reports(page).getByRole('tab', { name: 'Stundenkonto', exact: true });
  const periods = reports(page).getByRole('tab', { name: 'Auswertungen', exact: true });
  const vacation = reports(page).getByRole('tab', { name: 'Urlaubskonto', exact: true });
  await hours.focus();
  for (const [key, selected, other] of [['ArrowRight', periods, hours], ['ArrowRight', vacation, periods], ['ArrowLeft', periods, vacation], ['End', vacation, periods], ['Home', hours, vacation]] as const) {
    await page.keyboard.press(key);
    await expect(selected).toBeFocused();
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    await expect(selected).toHaveAttribute('tabindex', '0');
    await expect(other).toHaveAttribute('tabindex', '-1');
  }
});

for (const [instant, expectedDay, expectedMonth, expectedYear] of [
  ['2026-10-01T01:00:00Z', '2026-09-30', 'September 2026', '2026'],
  ['2027-01-01T01:00:00Z', '2026-12-31', 'Dezember 2026', '2026'],
] as const) {
  test(`direct account route uses the saved app timezone at ${instant}`, async ({ page, localApp }) => {
    const state = await (await page.request.get(`${localApp.url}/api/state`)).json();
    const changed = await page.request.put(`${localApp.url}/api/settings`, { headers: { Origin: localApp.url }, data: { timezone: 'America/New_York', expectedRevision: state.revision } });
    expect(changed.status()).toBe(200);
    await page.clock.setFixedTime(new Date(instant));
    await page.goto('/#/zeitkonto');
    await reports(page).getByRole('tab', { name: 'Auswertungen', exact: true }).click();
    await expect(reports(page).locator('.period-nav:visible')).toContainText(expectedMonth);
    await reports(page).getByRole('tab', { name: 'Urlaubskonto', exact: true }).click();
    await expect(reports(page).getByRole('combobox', { name: 'Urlaubsjahr', exact: true })).toHaveValue(expectedYear);
    await route(page, 'Kalender').click();
    await expect(page.getByLabel('Woche über Datum wählen')).toHaveValue(expectedDay);
    await expect.poll(() => page.locator('.ov-calendar-scroll').evaluate(element => element.scrollTop)).toBe(7 * 56);
  });
}

for (const destination of ['zeitkonto', 'vorlagen'] as const) {
  test(`first calendar reveal after direct ${destination} route starts at 07:00 and preserves later scroll`, async ({ page }) => {
    await page.goto(`/#/${destination}`);
    await expect(page.getByRole('heading', { level: 1, name: destination === 'zeitkonto' ? 'Zeitkonto' : 'Vorlagen', exact: true })).toBeVisible();
    await route(page, 'Kalender').click();
    const scroll = page.locator('.ov-calendar-scroll');
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(7 * 56);
    await scroll.evaluate(element => { element.scrollTop = 240; });
    await route(page, 'Vorlagen').click();
    await route(page, 'Kalender').click();
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(240);
  });
}

test('template page route and history guards ask once and preserve a refused draft', async ({ page }) => {
  await page.goto('/#/kalender');
  await route(page, 'Vorlagen').click();
  await templates(page).getByRole('button', { name: 'Neue Vorlage', exact: true }).click();
  await templates(page).locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true }).fill('Ungespeicherter Entwurf');
  const before = await getState(page);
  let count = 0;
  let accept = false;
  page.on('dialog', async dialog => { count++; await (accept ? dialog.accept() : dialog.dismiss()); });
  await route(page, 'Zeitkonto').click();
  expect(count).toBe(1);
  await expect(page).toHaveURL(/#\/vorlagen$/);
  await expect(templates(page).locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true })).toHaveValue('Ungespeicherter Entwurf');
  await page.goBack();
  await expect.poll(() => count).toBe(2);
  await expect(page).toHaveURL(/#\/vorlagen$/);
  accept = true;
  await route(page, 'Kalender').click();
  expect(count).toBe(3);
  await expect(page).toHaveURL(/#\/kalender$/);
  await route(page, 'Vorlagen').click();
  await expect(templates(page).locator('.reuse-editor')).toHaveCount(0);
  expect(count).toBe(3);
  expect(await getState(page)).toEqual(before);
});

test('same-page multi-entry history traversal keeps a later refused Back recoverable', async ({ page }) => {
  await page.goto('/#/kalender');
  await route(page, 'Vorlagen').click();
  await route(page, 'Kalender').click();
  await page.evaluate(() => new Promise<void>(resolve => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history.go(-2);
  }));
  await route(page, 'Vorlagen').click();
  await templates(page).getByRole('button', { name: 'Neue Vorlage', exact: true }).click();
  await templates(page).locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true }).fill('Nach Historienwechsel');
  const before = await getState(page);
  let confirmations = 0;
  let accept = false;
  page.on('dialog', async prompt => { confirmations++; await (accept ? prompt.accept() : prompt.dismiss()); });
  await page.goBack();
  await expect.poll(() => confirmations).toBe(1);
  await expect(page).toHaveURL(/#\/vorlagen$/);
  await expect(templates(page).locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true })).toHaveValue('Nach Historienwechsel');
  accept = true;
  await page.goBack();
  await expect.poll(() => confirmations).toBe(2);
  await expect(page).toHaveURL(/#\/kalender$/);
  expect(await getState(page)).toEqual(before);
});

test('a refused hash exit followed by refused multi-entry Back restores the exact account entry', async ({ page }) => {
  await page.goto('/#/kalender');
  await route(page, 'Vorlagen').click();
  await templates(page).getByRole('button', { name: 'Neue Vorlage', exact: true }).click();
  await templates(page).locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true }).fill('Entwurf vor Hashwechsel');
  const before = await getState(page);
  let confirmations = 0;
  let accept = false;
  page.on('dialog', async prompt => { confirmations++; await (accept ? prompt.accept() : prompt.dismiss()); });
  await page.evaluate(() => { window.location.hash = '#/kalender'; });
  await expect.poll(() => confirmations).toBe(1);
  await expect(page).toHaveURL(/#\/vorlagen$/);
  await expect(templates(page).locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true })).toHaveValue('Entwurf vor Hashwechsel');
  accept = true;
  await route(page, 'Zeitkonto').click();
  expect(confirmations).toBe(2);
  await reports(page).getByRole('tab', { name: 'Urlaubskonto', exact: true }).click();
  const allowance = reports(page).getByLabel('Jahresanspruch in Tagen', { exact: true });
  await allowance.fill('25.5');
  const accountUrl = page.url();
  accept = false;
  await page.evaluate(() => { window.history.go(-2); });
  await expect.poll(() => confirmations).toBe(3);
  await expect(page).toHaveURL(accountUrl);
  await expect(reports(page)).toBeVisible();
  await expect(reports(page).getByRole('tab', { name: 'Urlaubskonto', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(allowance).toHaveValue('25.5');
  expect(confirmations).toBe(3);
  expect(await getState(page)).toEqual(before);
  accept = true;
  await route(page, 'Kalender').click();
  expect(confirmations).toBe(4);
  await expect(page).toHaveURL(/#\/kalender$/);
  await expect(page.locator('[data-calendar-day]')).toHaveCount(7);
  await route(page, 'Zeitkonto').click();
  await expect(reports(page)).toBeVisible();
  expect(confirmations).toBe(4);
  expect(await getState(page)).toEqual(before);
});

test('first account visit through a hash uses the selected historical calendar month', async ({ page }) => {
  await page.goto('/#/kalender');
  await chooseWeek(page, '2024-02-15');
  await page.evaluate(() => { window.location.hash = '#/zeitkonto'; });
  await reports(page).getByRole('tab', { name: 'Auswertungen', exact: true }).click();
  await expect(reports(page).locator('.period-nav:visible')).toContainText('Februar 2024');
  await reports(page).getByRole('tab', { name: 'Urlaubskonto', exact: true }).click();
  await expect(reports(page).getByRole('combobox', { name: 'Urlaubsjahr', exact: true })).toHaveValue('2024');
});

test('pending template page save blocks route changes and failure keeps the draft', async ({ page }) => {
  await page.goto('/#/vorlagen');
  await templates(page).getByRole('button', { name: 'Neue Vorlage', exact: true }).click();
  const editor = templates(page).locator('.reuse-editor');
  await editor.getByLabel('Tätigkeit', { exact: true }).fill('Vorlage bleibt');
  const before = await getState(page);
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  let confirmations = 0;
  page.on('dialog', async dialog => { confirmations++; await dialog.dismiss(); });
  await page.route('**/api/templates', async request => {
    writes++;
    await held;
    await request.fulfill({ status: 503, json: { message: 'Vorlage nicht gespeichert' } });
  });
  try {
    await editor.getByRole('button', { name: 'Vorlage speichern', exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    await route(page, 'Kalender').dispatchEvent('click');
    await route(page, 'Zeitkonto').dispatchEvent('click');
    await page.evaluate(() => { window.location.hash = '#/kalender'; });
    await expect(page).toHaveURL(/#\/vorlagen$/);
    await expect(editor.getByLabel('Tätigkeit', { exact: true })).toBeDisabled();
    await editor.dispatchEvent('submit');
    expect(writes).toBe(1);
    expect(confirmations).toBe(0);
    release();
    await expect(templates(page).getByRole('alert')).toContainText('Vorlage nicht gespeichert');
    await expect(editor.getByLabel('Tätigkeit', { exact: true })).toHaveValue('Vorlage bleibt');
    await expect(editor.getByRole('button', { name: 'Vorlage speichern', exact: true })).toBeEnabled();
    expect(await getState(page)).toEqual(before);
  } finally { release(); }
});

test('page roundtrips retain calendar day, filters, scroll, month and template search', async ({ page }) => {
  await seed(page);
  await createFilterSource(page, 'slack', 'Slack');
  await chooseWeek(page, '2026-09-28');
  await openSourceFilters(page);
  await page.getByRole('checkbox', { name: 'Slack', exact: true }).uncheck();
  await page.locator('[data-calendar-day="2026-09-30"]').getByRole('button', { name: /Tagesprüfung für/ }).click();
  const scroll = page.locator('.ov-calendar-scroll');
  await scroll.evaluate(element => { element.scrollTop = 240; element.scrollLeft = 90; });
  const offsets = await scroll.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }));
  await route(page, 'Vorlagen').click();
  const search = templates(page).getByRole('searchbox', { name: 'Tätigkeit oder Notiz suchen' });
  await search.fill('Konzept');
  await route(page, 'Zeitkonto').click();
  await route(page, 'Vorlagen').click();
  await expect(search).toHaveValue('Konzept');
  await route(page, 'Kalender').click();
  await expect(page.locator('[data-calendar-day="2026-09-30"]')).toHaveAttribute('data-selected-day', 'true');
  await openSourceFilters(page);
  await expect(page.getByRole('checkbox', { name: 'Slack', exact: true })).not.toBeChecked();
  await expect.poll(() => scroll.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }))).toEqual(offsets);
  await page.getByRole('group', { name: 'Kalenderansicht' }).getByRole('button', { name: 'Monat', exact: true }).click();
  await page.getByLabel('Monat wählen', { exact: true }).fill('2027-02');
  await route(page, 'Zeitkonto').click();
  await route(page, 'Kalender').click();
  await expect(page.getByLabel('Monat wählen', { exact: true })).toHaveValue('2027-02');
});

test('hash navigation closes a source popover without leaking it onto another page', async ({ page }) => {
  await page.goto('/#/kalender');
  await openSourceFilters(page);
  await expect(page.getByRole('group', { name: 'Belege filtern', exact: true })).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/zeitkonto'; });
  await expect(reports(page)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Belege filtern', exact: true })).toHaveCount(0);
  await route(page, 'Kalender').click();
  await expect(page.getByRole('button', { name: 'Belege filtern', exact: true })).toHaveAttribute('aria-expanded', 'false');
});

test('leaving calendar focus through a hash restores bottom and right offsets on return', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/kalender');
  await chooseWeek(page, '2026-09-28');
  await page.locator('[data-calendar-day="2026-09-30"]').getByRole('button', { name: /Tagesprüfung für/ }).click();
  const scroll = page.locator('.ov-calendar-scroll');
  const origin = await scroll.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    element.scrollLeft = element.scrollWidth;
    return { top: element.scrollTop, left: element.scrollLeft };
  });
  expect(origin.top).toBeGreaterThan(0);
  expect(origin.left).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Fokusansicht', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/calendar-focused/);
  expect(await scroll.evaluate(element => element.scrollTop)).toBeLessThan(origin.top);
  await page.evaluate(() => { window.location.hash = '#/zeitkonto'; });
  await expect(reports(page)).toBeVisible();
  await route(page, 'Kalender').click();
  await expect(page.locator('.app-shell')).not.toHaveClass(/calendar-focused/);
  await expect.poll(() => scroll.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }))).toEqual(origin);
});

test('a deeply scrolled template list retains its actual list offset across page navigation', async ({ page }) => {
  await page.goto('/#/kalender');
  for (let index = 0; index < 30; index++) {
    const before = await getState(page);
    const response = await page.request.post('/api/templates', { headers: { Origin: new URL(page.url()).origin }, data: { title: `Tätigkeit ${String(index + 1).padStart(2, '0')}`, note: 'Wiederkehrende Arbeit', durationMinutes: 30, expectedRevision: before.revision } });
    expect(response.status()).toBe(200);
  }
  await page.reload();
  await route(page, 'Vorlagen').click();
  const list = templates(page).locator('.reuse-list-view > .dialog-scroll');
  const origin = await list.evaluate(element => {
    element.scrollTop = Math.min(1200, element.scrollHeight - element.clientHeight);
    return element.scrollTop;
  });
  expect(origin).toBeGreaterThan(300);
  await route(page, 'Zeitkonto').click();
  await route(page, 'Vorlagen').click();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(origin);
});

for (const [kind, moves, from, to] of [
  ['Monat', 1, '2026-10-01', '2026-11-01'],
  ['Quartal', 1, '2026-10-01', '2027-01-01'],
  ['Jahr', 0, '2026-01-01', '2027-01-01'],
] as const) {
  test(`account ${kind} export inherits the exact selected period`, async ({ page }) => {
    await seed(page);
    await route(page, 'Zeitkonto').click();
    await reports(page).getByRole('tab', { name: 'Auswertungen', exact: true }).click();
    await reports(page).getByRole('group', { name: 'Zeitraum', exact: true }).getByRole('button', { name: kind, exact: true }).click();
    for (let index = 0; index < moves; index++) await reports(page).getByRole('button', { name: 'Nächster Zeitraum', exact: true }).click();
    const received = page.waitForRequest(request => new URL(request.url()).pathname === '/api/timesheet');
    await reports(page).getByRole('button', { name: 'Stundenzettel', exact: true }).click();
    const url = new URL((await received).url());
    expect([url.searchParams.get('from'), url.searchParams.get('to')]).toEqual([from, to]);
    const sheet = page.getByRole('dialog', { name: 'Stundenzettel exportieren', exact: true });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Schließen', exact: true }).click();
    await expect(reports(page)).toBeVisible();
    await reports(page).getByRole('tab', { name: 'Urlaubskonto', exact: true }).click();
    await expect(reports(page).getByRole('button', { name: 'Stundenzettel', exact: true })).toHaveCount(0);
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`calendar and own pages fit the actual ${viewport.width}x${viewport.height} viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await chooseWeek(page, '2026-09-28');
    const assertGeometry = async () => {
      const top = await page.locator('.ov-calendar-dayhead').first().evaluate(element => element.getBoundingClientRect().top);
      expect(top).toBeLessThanOrEqual(viewport.width < 600 ? 400 : 280);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(page.locator('aside.day-review')).toHaveCount(0);
    };
    await assertGeometry();
    await page.screenshot({ path: testInfo.outputPath(`empty-${viewport.width}.png`) });
    await seed(page);
    await assertGeometry();
    await page.screenshot({ path: testInfo.outputPath(`populated-${viewport.width}.png`) });
    await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`calendar-actions-${viewport.width}.png`) });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`work-form-${viewport.width}.png`) });
    await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
    for (const title of ['Zeitkonto', 'Vorlagen'] as const) {
      await route(page, title).click();
      await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${title}-${viewport.width}.png`) });
    }
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`changed secondary surfaces have actual ${viewport.width}x${viewport.height} viewport captures`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await seed(page);
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${viewport.width}.png`) });
    };
    await openSourceFilters(page);
    await capture('source-popover');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Tag prüfen', exact: true }).click();
    await capture('day-review');
    await page.getByRole('button', { name: 'Tag prüfen', exact: true }).click();
    await openAppAction(page, 'Einstellungen');
    await capture('settings-prospective');
    await page.getByRole('dialog', { name: 'Einstellungen' }).getByRole('button', { name: 'Schließen', exact: true }).click();
    await openAppAction(page, 'Importieren');
    await capture('import-file');
    await page.getByRole('button', { name: 'Daten einfügen', exact: true }).click();
    await capture('import-paste');
    await page.getByRole('dialog', { name: 'Aktivitäten importieren' }).getByRole('button', { name: 'Dialog schließen', exact: true }).click();
    await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Abwesenheiten', exact: true }).click();
    await capture('vacation-form');
    await page.getByRole('dialog', { name: 'Abwesenheiten', exact: true }).getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await route(page, 'Zeitkonto').click();
    await reports(page).getByRole('tab', { name: 'Urlaubskonto', exact: true }).click();
    await capture('vacation-account');
    await route(page, 'Vorlagen').click();
    await templates(page).getByRole('button', { name: 'Neue Vorlage', exact: true }).click();
    await capture('template-editor');
  });
}
