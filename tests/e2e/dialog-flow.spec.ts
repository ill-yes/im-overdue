import type { Page } from '@playwright/test';
import { test, expect, chooseWeek, getState, openBlockNote, openBlockTemplate, assignImportSources, previewImport } from './isolated-fixture';
import type { ReusableInput } from '../../shared/types.js';

async function seedTemplates(page: Page, entries: ReusableInput[]) {
  for (const entry of entries) {
    const state = await getState(page);
    const response = await page.request.post('/api/templates', {
      headers: { Origin: new URL(page.url()).origin },
      data: { ...entry, expectedRevision: state.revision },
    });
    expect(response.status()).toBe(200);
  }
  await page.reload();
}

async function openWork(page: Page) {
  await page.getByRole('button', { name: 'Zeit eintragen', exact: true }).click();
  return page.getByRole('dialog');
}

async function selectTemplate(page: Page, title: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Schnellauswahl/ }).click();
  await dialog.locator('.reuse-row').filter({ has: page.getByText(title, { exact: true }) })
    .getByRole('button', { name: /übernehmen$/i }).click();
  await expect(dialog).toHaveAccessibleName('Arbeitszeit eintragen');
  await expect(dialog.getByLabel('Tätigkeit optional')).toBeFocused();
}

function endAfter(start: string, minutes: number) {
  const [hour, minute] = start.split(':').map(Number);
  const total = (hour * 60 + minute + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

test('one modal shows only its active view and retains the work draft, search and tab', async ({ page }) => {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
  const dialog = await openWork(page);
  await dialog.getByLabel('Tätigkeit optional').fill('Arbeitsentwurf');
  await openBlockNote(page);
  await dialog.getByRole('textbox', { name: 'Notiz optional', exact: true }).fill('Bleibt erhalten');
  await dialog.getByLabel('Beginn · Uhrzeit').fill('08:15');
  await dialog.getByLabel('Ende · Uhrzeit').fill('10:45');
  await openBlockTemplate(page);
  await dialog.getByLabel('Als Vorlage merken').check();
  const modalNode = await dialog.evaluate(element => {
    (window as Window & { __workModal?: Element }).__workModal = element;
    return true;
  });
  expect(modalNode).toBe(true);
  await dialog.getByRole('button', { name: /Schnellauswahl/ }).click();
  await expect(dialog).toHaveAccessibleName('Schnellauswahl');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog.getByLabel('Tätigkeit optional')).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Arbeitszeit speichern', exact: true })).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'Letzte Einträge' }).click();
  await dialog.getByRole('searchbox', { name: 'Tätigkeit oder Notiz suchen' }).fill('Alpha');
  await dialog.getByRole('button', { name: 'Zurück zur Arbeitszeit' }).click();
  await expect(dialog).toHaveAccessibleName('Arbeitszeit eintragen');
  await expect(dialog.getByLabel('Tätigkeit optional')).toHaveValue('Arbeitsentwurf');
  await expect(dialog.getByRole('textbox', { name: 'Notiz optional', exact: true })).toHaveValue('Bleibt erhalten');
  await expect(dialog.getByLabel('Beginn · Uhrzeit')).toHaveValue('08:15');
  await expect(dialog.getByLabel('Ende · Uhrzeit')).toHaveValue('10:45');
  await expect(dialog.getByLabel('Als Vorlage merken')).toBeChecked();
  await dialog.getByRole('button', { name: /Schnellauswahl/ }).click();
  await expect(dialog.getByRole('tab', { name: 'Letzte Einträge' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('searchbox', { name: 'Tätigkeit oder Notiz suchen' })).toHaveValue('Alpha');
  expect(await dialog.evaluate(element => element === (window as Window & { __workModal?: Element }).__workModal)).toBe(true);
  expect((await getState(page)).blocks).toHaveLength(0);
});

test('editor back and Escape go up one level and restore focus to their trigger', async ({ page }) => {
  await page.goto('/');
  await seedTemplates(page, [{ title: 'Alpha', note: '', durationMinutes: 30 }]);
  const dialog = await openWork(page);
  await dialog.getByLabel('Tätigkeit optional').fill('Behalten');
  await dialog.getByRole('button', { name: /Schnellauswahl/ }).click();
  await dialog.getByRole('searchbox', { name: 'Tätigkeit oder Notiz suchen' }).fill('Alpha');
  await dialog.getByRole('button', { name: 'Neue Vorlage', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Neue Vorlage');
  await expect(dialog.locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true })).toBeFocused();
  await expect(dialog.getByRole('tablist')).toHaveCount(0);
  await expect(dialog.getByRole('searchbox')).toHaveCount(0);
  await expect(dialog.locator('.reuse-row').getByRole('button', { name: /übernehmen$/i })).toHaveCount(0);
  await expect(dialog.getByLabel('Tätigkeit optional')).toBeHidden();
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => {
      const focused = document.activeElement;
      return Boolean(focused && element.contains(focused) && !focused.closest('[hidden], [inert]'));
    })).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveAccessibleName('Schnellauswahl');
  await expect(dialog.getByRole('button', { name: 'Neue Vorlage', exact: true })).toBeFocused();
  await expect(dialog.getByRole('searchbox')).toHaveValue('Alpha');
  const editTrigger = dialog.getByRole('button', { name: 'Vorlage Alpha bearbeiten' });
  await editTrigger.click();
  await expect(dialog).toHaveAccessibleName('Vorlage bearbeiten');
  await dialog.locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true }).fill('Alpha aktualisiert');
  await dialog.getByRole('button', { name: 'Vorlage speichern', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Schnellauswahl');
  await expect(dialog.getByRole('button', { name: 'Vorlage Alpha aktualisiert bearbeiten' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveAccessibleName('Arbeitszeit eintragen');
  await expect(dialog.getByRole('button', { name: /Schnellauswahl/ })).toBeFocused();
  await expect(dialog.getByLabel('Tätigkeit optional')).toHaveValue('Behalten');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await getState(page)).blocks).toHaveLength(0);
});

for (const exit of ['header', 'backdrop'] as const) {
  test(`${exit} closes every view with exactly one dirty guard`, async ({ page }) => {
    await page.goto('/');
    const dialog = await openWork(page);
    await dialog.getByLabel('Tätigkeit optional').fill('Arbeitsentwurf');
    await dialog.getByRole('button', { name: /Schnellauswahl/ }).click();
    await dialog.getByRole('button', { name: 'Neue Vorlage', exact: true }).click();
    await dialog.locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true }).fill('Vorlagenentwurf');
    let confirmations = 0;
    let accept = false;
    page.on('dialog', async native => { confirmations++; await (accept ? native.accept() : native.dismiss()); });
    const close = async () => {
      if (exit === 'header') await dialog.getByRole('button', { name: 'Dialog schließen', exact: true }).click();
      else await page.locator('.modal-backdrop').dispatchEvent('mousedown');
    };
    await close();
    expect(confirmations).toBe(1);
    await expect(dialog).toHaveAccessibleName('Neue Vorlage');
    await expect(dialog.locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true })).toHaveValue('Vorlagenentwurf');
    accept = true;
    await close();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(confirmations).toBe(2);
    const state = await getState(page);
    expect(state.blocks).toHaveLength(0);
    expect(state.templates).toHaveLength(0);
  });
}

for (const entry of ['work', 'standalone'] as const) {
  test(`${entry} A to B reuse keeps replacing automatic duration until a time is edited`, async ({ page }) => {
    await page.goto('/');
    await seedTemplates(page, [
      { title: 'Alpha', note: 'A', durationMinutes: 30 },
      { title: 'Beta', note: 'B', durationMinutes: 90 },
    ]);
    await chooseWeek(page, '2026-09-28');
    const dialog = page.getByRole('dialog');
    if (entry === 'standalone') {
      await page.getByRole('button', { name: 'Schnellauswahl', exact: true }).click();
      await dialog.locator('.reuse-row').filter({ has: page.getByText('Alpha', { exact: true }) })
        .getByRole('button', { name: /übernehmen$/i }).click();
    } else {
      await openWork(page);
      await selectTemplate(page, 'Alpha');
    }
    const start = await dialog.getByLabel('Beginn · Uhrzeit').inputValue();
    await expect(dialog.getByLabel('Ende · Uhrzeit')).toHaveValue(endAfter(start, 30));
    await selectTemplate(page, 'Beta');
    await expect(dialog.getByLabel('Beginn · Uhrzeit')).toHaveValue(start);
    await expect(dialog.getByLabel('Ende · Uhrzeit')).toHaveValue(endAfter(start, 90));
    await expect(dialog.getByRole('textbox', { name: 'Notiz optional', exact: true })).toHaveValue('B');
    await dialog.getByLabel('Ende · Uhrzeit').fill('17:23');
    await selectTemplate(page, 'Alpha');
    await expect(dialog.getByLabel('Ende · Uhrzeit')).toHaveValue('17:23');
    await expect(dialog.getByRole('button', { name: 'Vorlagendauer übernehmen' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Vorlagendauer übernehmen' }).click();
    await expect(dialog.getByLabel('Ende · Uhrzeit')).toHaveValue(endAfter(start, 30));
    expect((await getState(page)).blocks).toHaveLength(0);
  });
}

for (const entry of ['picker', 'work'] as const) {
  test(`${entry} template pending locks navigation and closing but failure retains its draft`, async ({ page }) => {
    await page.goto('/');
    const dialog = await openWork(page);
    await dialog.getByLabel('Tätigkeit optional').fill('Arbeitsentwurf');
    if (entry === 'picker') {
      await dialog.getByRole('button', { name: /Schnellauswahl/ }).click();
      await dialog.getByRole('button', { name: 'Neue Vorlage', exact: true }).click();
      await dialog.locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true }).fill('Vorlagenentwurf');
    }
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/api/templates', async route => {
      requests++;
      await held;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Vorlagenspeicherung fehlgeschlagen' }) });
    });
    try {
      if (entry === 'work') await openBlockTemplate(page);
      await dialog.getByRole('button', { name: entry === 'picker' ? 'Vorlage speichern' : 'Nur als Vorlage speichern', exact: true }).click();
      await expect.poll(() => requests).toBe(1);
      await expect(dialog.getByRole('button', { name: 'Dialog schließen', exact: true })).toBeDisabled();
      const navigation = dialog.getByRole('button', { name: entry === 'picker' ? 'Zurück zur Schnellauswahl' : /Schnellauswahl/ });
      await expect(navigation).toBeDisabled();
      if (entry === 'work') await expect(dialog.getByRole('button', { name: 'Schließen', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await page.locator('.modal-backdrop').dispatchEvent('mousedown');
      await expect(dialog).toHaveAccessibleName(entry === 'picker' ? 'Neue Vorlage' : 'Arbeitszeit eintragen');
      await dialog.locator(entry === 'picker' ? '.reuse-editor' : '.block-dialog-form').dispatchEvent('submit');
      expect(requests).toBe(1);
      release();
      await expect(dialog.getByRole('alert')).toContainText('Vorlagenspeicherung fehlgeschlagen');
      await expect(dialog.getByRole('button', { name: 'Dialog schließen', exact: true })).toBeEnabled();
      await expect(entry === 'picker' ? dialog.locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true }) : dialog.getByLabel('Tätigkeit optional'))
        .toHaveValue(entry === 'picker' ? 'Vorlagenentwurf' : 'Arbeitsentwurf');
      const state = await getState(page);
      expect(state.templates).toHaveLength(0);
      expect(state.blocks).toHaveLength(0);
    } finally { release(); }
  });
}

for (const result of ['success', 'failure'] as const) {
  test(`late ${result} work save cannot close or mark a newer editor`, async ({ page }) => {
    await page.goto('/');
    await chooseWeek(page, '2026-09-28');
    const dialog = await openWork(page);
    await dialog.getByLabel('Tätigkeit optional').fill('Alter Entwurf');
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let received = false;
    await page.route('**/api/blocks', async route => {
      received = true;
      await held;
      if (result === 'success') await route.fulfill({ response: await route.fetch() });
      else await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Alter Speicherfehler' }) });
    });
    try {
      await dialog.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
      await expect.poll(() => received).toBe(true);
      await expect(dialog.getByRole('button', { name: 'Arbeitszeit speichern …', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Dialog schließen', exact: true })).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await openWork(page);
      await dialog.getByLabel('Tätigkeit optional').fill('Neuer Entwurf');
      release();
      if (result === 'success') await expect.poll(async () => (await getState(page)).blocks.length).toBe(1);
      else await expect(page.locator('.app-alert')).toContainText('Alter Speicherfehler');
      await expect(dialog).toHaveAccessibleName('Arbeitszeit eintragen');
      await expect(dialog.getByLabel('Tätigkeit optional')).toHaveValue('Neuer Entwurf');
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Arbeitszeit speichern', exact: true })).toBeEnabled();
    } finally { release(); }
  });
}

test('390px long lists scroll within the modal while header and back action remain reachable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await seedTemplates(page, Array.from({ length: 32 }, (_, index) => ({
    title: `Vorlage ${String(index).padStart(2, '0')} mit langem Tätigkeitsnamen und Zusatz`,
    note: 'Ein längerer erläuternder Hinweis zur Tätigkeit, der mobil umbrechen muss.', durationMinutes: 30,
  })));
  const dialog = await openWork(page);
  await dialog.getByRole('button', { name: /Schnellauswahl/ }).click();
  await expect(dialog.locator('.reuse-row')).toHaveCount(32);
  expect(await dialog.evaluate(element => getComputedStyle(element).overflow)).toBe('hidden');
  const headerBefore = await dialog.locator('.modal-header').boundingBox();
  expect(headerBefore).not.toBeNull();
  const scrolled = await dialog.evaluate(element => {
    const targets = [...element.querySelectorAll<HTMLElement>('*')].filter(candidate => {
      const style = getComputedStyle(candidate);
      return /auto|scroll/.test(style.overflowY) && candidate.scrollHeight > candidate.clientHeight + 1;
    });
    for (const candidate of targets) candidate.scrollTop = candidate.scrollHeight;
    return targets.length;
  });
  expect(scrolled).toBeGreaterThan(0);
  await expect(dialog.getByRole('button', { name: 'Dialog schließen', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Zurück zur Arbeitszeit', exact: true })).toBeInViewport();
  const headerAfter = await dialog.locator('.modal-header').boundingBox();
  expect(headerAfter?.y).toBeCloseTo(headerBefore!.y, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await dialog.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dialog-picker-390px.png') });
  await dialog.getByRole('button', { name: 'Neue Vorlage', exact: true }).click();
  expect(await dialog.evaluate(element => getComputedStyle(element).overflow)).toBe('hidden');
  await expect(dialog.getByRole('button', { name: 'Vorlage speichern', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Zurück zur Schnellauswahl', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dialog-template-390px.png') });
});

for (const result of ['success', 'failure'] as const) {
  test(`pending template DELETE ${result} disables every control and traps forward and backward Tab on the dialog`, async ({ page }) => {
    await page.goto('/');
    await seedTemplates(page, [{ title: 'Zu löschen', note: 'Erhalten bei Fehler', durationMinutes: 30 }]);
    const template = (await getState(page)).templates[0];
    const outerTrigger = page.getByRole('button', { name: 'Schnellauswahl', exact: true });
    await outerTrigger.click();
    const dialog = page.getByRole('dialog', { name: 'Schnellauswahl', exact: true });
    const activeTab = dialog.getByRole('tab', { name: 'Vorlagen', exact: true });
    await expect(activeTab).toHaveAttribute('tabindex', '0');
    const search = dialog.getByRole('searchbox', { name: 'Tätigkeit oder Notiz suchen' });
    await search.fill('Zu löschen');
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route(`**/api/templates/${template.id}`, async route => {
      expect(route.request().method()).toBe('DELETE');
      requests++;
      await held;
      if (result === 'success') await route.fulfill({ response: await route.fetch() });
      else await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Vorlagenlöschung fehlgeschlagen' }) });
    });
    try {
      page.once('dialog', native => native.accept());
      await dialog.getByRole('button', { name: 'Vorlage Zu löschen löschen', exact: true }).click();
      await expect.poll(() => requests).toBe(1);
      await expect(activeTab).toHaveAttribute('tabindex', '0');
      await expect(activeTab).toBeDisabled();
      await expect(dialog.getByRole('tab', { name: 'Letzte Einträge', exact: true })).toBeDisabled();
      await expect(dialog.locator('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Dialog schließen', exact: true })).toBeDisabled();
      for (const key of ['Tab', 'Shift+Tab']) {
        await outerTrigger.evaluate(element => element.focus());
        await expect(outerTrigger).toBeFocused();
        await page.keyboard.press(key);
        await expect(dialog).toBeFocused();
      }
      await page.keyboard.press('Escape');
      await page.locator('.modal-backdrop').dispatchEvent('mousedown');
      await expect(dialog).toBeVisible();
      expect(requests).toBe(1);
      release();
      if (result === 'success') {
        await expect(dialog.getByRole('status')).toContainText('Vorlage gelöscht.');
        await expect(search).toBeFocused();
        await expect(dialog.locator('.reuse-row')).toHaveCount(0);
        expect((await getState(page)).templates).toHaveLength(0);
      } else {
        await expect(dialog.getByRole('alert')).toContainText('Vorlagenlöschung fehlgeschlagen');
        await expect(dialog.locator('.reuse-row')).toHaveCount(1);
        expect((await getState(page)).templates).toEqual([template]);
      }
      await expect(search).toBeEnabled();
      await expect(search).toHaveValue('Zu löschen');
      await expect(dialog.getByRole('button', { name: 'Dialog schließen', exact: true })).toBeEnabled();
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: result === 'success' ? 'Neue Vorlage' : 'Dialog schließen', exact: true })).toBeFocused();
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(outerTrigger).toBeFocused();
    } finally { release(); }
  });
}

test('standalone picker Escape and completed reuse flow restore focus to the outer quick-select trigger', async ({ page }) => {
  await page.goto('/');
  await seedTemplates(page, [{ title: 'Übernehmen', note: 'Vorlageninhalt', durationMinutes: 45 }]);
  const outerTrigger = page.getByRole('button', { name: 'Schnellauswahl', exact: true });
  await outerTrigger.click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Schnellauswahl');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(outerTrigger).toBeFocused();

  await outerTrigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.reuse-row').filter({ has: page.getByText('Übernehmen', { exact: true }) })
    .getByRole('button', { name: /übernehmen$/i }).click();
  await expect(dialog).toHaveAccessibleName('Arbeitszeit eintragen');
  await expect(dialog.getByLabel('Tätigkeit optional')).toHaveValue('Übernehmen');
  await expect(dialog.getByLabel('Tätigkeit optional')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(outerTrigger).toBeFocused();
  expect((await getState(page)).blocks).toHaveLength(0);
});

test('1440x1200 workflow modal caps computed height at 880px and keeps root overflow hidden', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto('/');
  await seedTemplates(page, Array.from({ length: 32 }, (_, index) => ({
    title: `Desktop Vorlage ${index}`, note: 'Lange Liste zur Höhenprüfung', durationMinutes: 30,
  })));
  const dialog = await openWork(page);
  const assertHeightCap = async () => {
    const geometry = await dialog.evaluate(element => {
      const style = getComputedStyle(element);
      return { maxHeight: Number.parseFloat(style.maxHeight), overflow: style.overflow, height: element.getBoundingClientRect().height };
    });
    expect(Number.isFinite(geometry.maxHeight)).toBe(true);
    expect(geometry.maxHeight).toBeLessThanOrEqual(880);
    expect(geometry.height).toBeLessThanOrEqual(880);
    expect(geometry.overflow).toBe('hidden');
  };
  await assertHeightCap();
  await dialog.getByRole('button', { name: /Schnellauswahl/ }).click();
  await expect(dialog.locator('.reuse-row')).toHaveCount(32);
  await assertHeightCap();
  await expect(dialog.getByRole('button', { name: 'Zurück zur Arbeitszeit', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Neue Vorlage', exact: true }).click();
  await assertHeightCap();
  await expect(dialog.getByRole('button', { name: 'Vorlage speichern', exact: true })).toBeInViewport();
});

test('external template refresh alone is not dirty and work pending still allows picker navigation', async ({ page }) => {
  await page.goto('/');
  await seedTemplates(page, [{ title: 'Original', note: 'Ausgangsstand', durationMinutes: 30 }]);
  const template = (await getState(page)).templates[0];
  const dialog = await openWork(page);
  await dialog.getByLabel('Tätigkeit optional').fill('Alter Arbeitsentwurf');
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let received = false;
  await page.route('**/api/blocks', async route => {
    const response = await route.fetch();
    received = true;
    await held;
    const latest = await page.request.get('/api/state');
    await route.fulfill({ response, body: await latest.text() });
  });
  try {
    await dialog.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
    await expect.poll(() => received).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Schnellauswahl', exact: true }).click();
    await expect(dialog.getByRole('searchbox')).toBeEnabled();
    await dialog.getByRole('button', { name: 'Vorlage Original bearbeiten' }).click();
    const title = dialog.locator('.reuse-editor').getByLabel('Tätigkeit', { exact: true });
    await expect(title).toHaveValue('Original');
    await expect(title).toBeEnabled();
    const state = await getState(page);
    const changed = await page.request.put(`/api/templates/${template.id}`, {
      headers: { Origin: new URL(page.url()).origin },
      data: { expectedRevision: state.revision, title: 'Parallel geändert', note: 'Neuer Stand', durationMinutes: 90 },
    });
    expect(changed.status()).toBe(200);
    release();
    await expect(dialog.getByRole('status')).toContainText('zwischenzeitlich geändert');
    await expect(title).toHaveValue('Original');
    await expect(dialog.locator('.reuse-editor').getByLabel('Dauer in Minuten')).toHaveValue('30');
    await expect(dialog.getByRole('button', { name: 'Vorlage speichern', exact: true })).toBeDisabled();
    let confirmations = 0;
    page.on('dialog', async native => { confirmations++; await native.dismiss(); });
    await dialog.getByRole('button', { name: 'Zurück zur Schnellauswahl', exact: true }).click();
    await expect(dialog).toHaveAccessibleName('Schnellauswahl');
    expect(confirmations).toBe(0);
    await expect(dialog.locator('.reuse-row strong')).toHaveText(['Parallel geändert']);
    expect((await getState(page)).templates[0]).toMatchObject({ title: 'Parallel geändert', durationMinutes: 90 });
  } finally { release(); }
});

test('late import preview holds the shared request lock without contaminating a newly opened import editor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Importieren', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Aktivitäten importieren' });
  const older = JSON.stringify({ schemaVersion: 1, activities: [{ source: 'github', id: 'older-preview', start: '2026-09-28T09:00:00+02:00', title: 'Ältere Vorschau' }] });
  const newer = JSON.stringify({ schemaVersion: 1, activities: [{ source: 'github', id: 'newer-preview', start: '2026-09-28T10:00:00+02:00', title: 'Neuere Vorschau' }] });
  await page.getByRole('button', { name: 'Daten einfügen', exact: true }).click();
  await dialog.getByLabel('Daten einfügen', { exact: true }).fill(older);
  await dialog.getByRole('button', { name: 'Datei prüfen', exact: true }).click();
  await assignImportSources(page);
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let received = false;
  let olderDelivered = false;
  await page.route('**/api/import/preview', async route => {
    const isOlder = route.request().postDataJSON().text === older;
    if (isOlder) {
      received = true;
      await held;
    }
    await route.fulfill({ response: await route.fetch() });
    if (isOlder) olderDelivered = true;
  });
  try {
    await dialog.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
    await expect.poll(() => received).toBe(true);
    page.once('dialog', native => native.accept());
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Importieren', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Daten einfügen', exact: true })).toBeDisabled();
    await expect(dialog.locator('input[type=file]')).toBeDisabled();
    await expect(dialog.getByLabel('Daten einfügen', { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Datei prüfen', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('region', { name: 'Importvorschau' })).toHaveCount(0);
    release();
    await expect.poll(() => olderDelivered).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Daten einfügen', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('region', { name: 'Importvorschau' })).toHaveCount(0);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Daten einfügen', exact: true }).click();
    await expect(dialog.getByLabel('Daten einfügen', { exact: true })).toHaveValue('');
    await dialog.getByLabel('Daten einfügen', { exact: true }).fill(newer);
    await expect(dialog.getByRole('button', { name: 'Datei prüfen', exact: true })).toBeEnabled();
    await previewImport(page);
    await expect(dialog.getByRole('region', { name: 'Importvorschau' })).toContainText('Neuere Vorschau');
    await expect(dialog.getByRole('region', { name: 'Importvorschau' })).not.toContainText('Ältere Vorschau');
    await expect(dialog.getByRole('button', { name: 'Import bestätigen', exact: true })).toBeEnabled();
    expect((await getState(page)).activities).toHaveLength(0);
  } finally { release(); }
});
