import type { Page, Route } from '@playwright/test';
import { test, expect, chooseWeek, getState } from './isolated-fixture';
import type { AppState } from '../../shared/types.js';
import { weekReview } from '../../shared/week-review.js';

const review = (page: Page) => page.getByRole('dialog', { name: 'Woche abschließen', exact: true });
async function mutate(page: Page, path: string, method: string, values: object): Promise<AppState> {
  const state = await getState(page);
  const response = await page.request.fetch(path, { method, headers: { Origin: new URL(page.url()).origin }, data: { ...values, expectedRevision: state.revision } });
  expect(response.status()).toBe(200);
  return response.json();
}
async function setup(page: Page) {
  await page.goto('/');
  await chooseWeek(page, '2026-09-28');
}
async function openReview(page: Page) {
  await page.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect(review(page)).toBeVisible();
  await expect(review(page).locator('form')).toHaveAttribute('aria-busy', 'false');
  return review(page);
}

test('closing always opens a review; warnings must be acknowledged and cancellation writes nothing', async ({ page }) => {
  await setup(page);
  const before = await getState(page);
  let closes = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/weeks\//.test(request.url())) closes++; });
  const dialog = await openReview(page);
  await expect(dialog.getByRole('button', { name: 'Woche abschließen', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('region')).toHaveCount(5);
  await dialog.locator('form').dispatchEvent('submit');
  expect(closes).toBe(0);
  await dialog.getByRole('checkbox', { name: /Hinweise geprüft/ }).check();
  await expect(dialog.getByRole('button', { name: 'Woche abschließen', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  expect(await getState(page)).toEqual(before);
  expect(closes).toBe(0);
});

test('full vacation covers a missing day; half vacation, long work and evidence outside work remain reviewable', async ({ page }) => {
  await setup(page);
  await mutate(page, '/api/vacations', 'PUT', { days: [{ date: '2026-09-28', fraction: 1 }, { date: '2026-09-29', fraction: 0.5 }] });
  await mutate(page, '/api/blocks', 'POST', { start: '2026-09-30T04:00:00Z', end: '2026-09-30T17:01:00Z', title: 'Langer Tag', note: '' });
  await mutate(page, '/api/import/commit', 'POST', { format: 'json', text: JSON.stringify({ schemaVersion: 1, activities: [
    { source: 'slack', id: 'inside', title: 'Abgedeckter Hinweis', start: '2026-09-30T08:00:00Z' },
    { source: 'slack', id: 'outside', title: 'Offener Hinweis', start: '2026-09-30T18:00:00Z' },
  ] }) });
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  const before = await getState(page);
  const dialog = await openReview(page);
  await expect(dialog.getByRole('region', { name: 'Montag, 28. September 2026', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: 'Dienstag, 29. September 2026', exact: true })).toContainText('Soll-Arbeitstag ohne erfasste Arbeitszeit');
  const wednesday = dialog.getByRole('region', { name: 'Mittwoch, 30. September 2026', exact: true });
  await expect(wednesday).toContainText('Mehr als zwölf Stunden');
  await expect(wednesday).toContainText('1 Hinweis außerhalb');
  await wednesday.getByRole('button', { name: 'Tag prüfen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('aside.day-review').getByLabel('Tag wählen')).toHaveValue('2026-09-30');
  await expect(page.locator('aside.day-review')).toContainText('Offener Hinweis');
  expect(await getState(page)).toEqual(before);
  expect(before.blocks).toHaveLength(1);
  expect(before.activities).toHaveLength(2);
});

test('acknowledged review sends its captured revision and explicit warning confirmation', async ({ page }) => {
  await setup(page);
  const before = await getState(page);
  const sent: Record<string, unknown>[] = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/weeks/2026-09-28') sent.push(request.postDataJSON()); });
  const dialog = await openReview(page);
  await dialog.getByRole('checkbox', { name: /Hinweise geprüft/ }).check();
  await dialog.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.status-pill')).toHaveText('Abgeschlossen');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ status: 'closed', expectedRevision: before.revision, confirmWarnings: true });
  expect((await getState(page)).blocks).toEqual([]);
  expect((await getState(page)).activities).toEqual([]);
});

test('a concurrent write refreshes the review and requires a new acknowledgment before closure', async ({ page }) => {
  await setup(page);
  const dialog = await openReview(page);
  await dialog.getByRole('checkbox', { name: /Hinweise geprüft/ }).check();
  const changed = await mutate(page, '/api/vacations', 'PUT', { days: [{ date: '2026-09-28', fraction: 1 }] });
  await dialog.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('zwischenzeitlich geändert');
  await expect(dialog.getByRole('checkbox', { name: /Hinweise geprüft/ })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Woche abschließen', exact: true })).toBeDisabled();
  expect((await getState(page)).weeks).toEqual(changed.weeks);
  await expect(dialog.getByRole('region', { name: 'Montag, 28. September 2026', exact: true })).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: /Hinweise geprüft/ }).check();
  await dialog.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await getState(page)).vacations).toEqual(changed.vacations);
  expect((await getState(page)).weeks.find(week => week.weekStart === '2026-09-28')?.status).toBe('closed');
});

test('a fully vacation-covered past week closes from a clear review without an acknowledgment checkbox', async ({ page }) => {
  await setup(page);
  await mutate(page, '/api/vacations', 'PUT', { days: ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map(date => ({ date, fraction: 1 })) });
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  const dialog = await openReview(page);
  await expect(dialog).toContainText('Keine offenen Hinweise');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.status-pill')).toHaveText('Abgeschlossen');
});

test('a clock-only review rejection refreshes the same revision and requires acknowledgment of newly past workdays', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-28T21:59:00Z'));
  await setup(page);
  const before = await getState(page);
  const bodies: Record<string, unknown>[] = [];
  let now = '2026-09-28T21:59:00Z';
  let reviewLoads = 0;
  await page.route('**/api/weeks/2026-09-28/review', async route => {
    reviewLoads++;
    await route.fulfill({ json: weekReview(before, '2026-09-28', now) });
  });
  await page.route('**/api/weeks/2026-09-28', async route => {
    bodies.push(route.request().postDataJSON());
    // Cross local midnight while the captured confirmation is in flight.
    await page.clock.setFixedTime(new Date('2026-09-28T22:01:00Z'));
    now = '2026-09-28T22:01:00Z';
    await route.fulfill({ status: 409, json: {
      code: 'WEEK_REVIEW_REQUIRED', message: 'Die Abschlussprüfung hat sich geändert.',
      review: weekReview(before, '2026-09-28', now),
    } });
  });
  const dialog = await openReview(page);
  await expect(dialog).toContainText('Keine offenen Hinweise');
  const acknowledgment = dialog.getByRole('checkbox', { name: /Hinweise geprüft/ });
  await acknowledgment.check();
  await dialog.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Abschlussprüfung hat sich geändert');
  await expect(dialog.getByRole('region', { name: 'Montag, 28. September 2026', exact: true })).toContainText('Soll-Arbeitstag ohne erfasste Arbeitszeit');
  await expect(acknowledgment).not.toBeChecked();
  expect(reviewLoads).toBeGreaterThanOrEqual(2);
  await expect(dialog.getByRole('button', { name: 'Woche abschließen', exact: true })).toBeDisabled();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ expectedRevision: before.revision, confirmWarnings: true });
  expect(typeof bodies[0].reviewKey).toBe('string');
  const captured = JSON.parse(bodies[0].reviewKey as string);
  expect(captured.slice(0, 3)).toEqual(['2026-09-28', before.revision, '2026-09-28']);
  expect(captured[3]).toEqual([]);
  expect(await getState(page)).toEqual(before);
  await acknowledgment.check();
  await expect(dialog.getByRole('button', { name: 'Woche abschließen', exact: true })).toBeEnabled();
  // The server clock is real; this test covers the browser's rejected-confirmation path.
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  expect(await getState(page)).toEqual(before);
});

test('a delayed old review cannot replace the loaded review or acknowledgment after closing and reopening', async ({ page }) => {
  await setup(page);
  const before = await getState(page);
  let held: Route | undefined;
  let requests = 0;
  await page.route('**/api/weeks/2026-09-28/review', async route => {
    requests++;
    if (requests === 1) held = route;
    else await route.fulfill({ response: await route.fetch() });
  });
  await page.getByRole('button', { name: 'Woche abschließen', exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await expect(review(page).locator('form')).toHaveAttribute('aria-busy', 'true');
  await expect(review(page).getByRole('checkbox')).toHaveCount(0);
  await expect(review(page).getByRole('button', { name: 'Woche abschließen', exact: true })).toHaveCount(0);
  await review(page).getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(review(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Weitere Kalenderaktionen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Urlaub eintragen', exact: true }).click();
  const vacation = page.getByRole('dialog', { name: 'Urlaub', exact: true });
  await vacation.getByLabel('Von', { exact: true }).fill('2026-09-28');
  await vacation.getByLabel('Bis einschließlich', { exact: true }).fill('2026-09-28');
  await vacation.getByRole('button', { name: 'Urlaub eintragen', exact: true }).click();
  await expect(vacation).toHaveCount(0);
  const changed = await getState(page);
  expect(changed.revision).toBeGreaterThan(before.revision);
  const dialog = await openReview(page);
  const acknowledgment = dialog.getByRole('checkbox', { name: /Hinweise geprüft/ });
  await acknowledgment.check();
  await expect(dialog.getByRole('region', { name: 'Montag, 28. September 2026', exact: true })).toHaveCount(0);
  const response = held!.request().response();
  await held!.fulfill({ json: weekReview(before, '2026-09-28', '2026-10-22T12:00:00Z') });
  await (await response)?.finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(dialog.locator('form')).toHaveAttribute('aria-busy', 'false');
  await expect(acknowledgment).toBeChecked();
  await expect(dialog.getByRole('region', { name: 'Montag, 28. September 2026', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await getState(page)).toEqual(changed);
});
