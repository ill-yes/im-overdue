import type { Page } from '@playwright/test';
import type { AppState } from '../../shared/types.js';
import { test, expect, chooseWeek, getState } from './isolated-fixture';

const original = {
  start: '2026-09-28T08:00:00Z', end: '2026-09-28T09:00:00Z',
  title: 'Original activity', note: 'Original note',
};

async function mutate(page: Page, path: string, method: string, data: object = {}): Promise<AppState> {
  const state: AppState = await (await page.request.get(new URL('/api/state', page.url()).href)).json();
  const response = await page.request.fetch(new URL(path, page.url()).href, {
    method, headers: { Origin: new URL(page.url()).origin }, data: { ...data, expectedRevision: state.revision },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function editBlock(page: Page): Promise<string> {
  await page.goto('/');
  const state = await mutate(page, '/api/blocks', 'POST', original);
  await page.reload();
  await chooseWeek(page, '2026-09-28');
  await page.locator('[data-work-block]').click();
  await page.getByRole('dialog').locator('input[data-dialog-autofocus]').fill('My activity');
  return state.blocks[0].id;
}

async function saveConflict(page: Page, id: string) {
  const response = page.waitForResponse(r => r.url().endsWith(`/api/blocks/${id}`) && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  expect((await response).status()).toBe(409);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('zwischenzeitlich geändert');
  await expect(page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true })).toBeEnabled();
}

test('a foreign block edit requires explicit overwrite and cancellation preserves both drafts', async ({ page }) => {
  const id = await editBlock(page);
  const peer = await mutate(page, `/api/blocks/${id}`, 'PUT', { ...original, note: 'Foreign note' });
  let writes = 0;
  page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith(`/api/blocks/${id}`)) writes++; });
  await saveConflict(page, id);

  const dismissed = page.waitForEvent('dialog');
  const firstClick = page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  const firstPrompt = await dismissed;
  expect(firstPrompt.message()).toContain('Änderungen überschreiben?');
  await firstPrompt.dismiss(); await firstClick;
  expect(writes).toBe(1);
  expect((await getState(page)).blocks[0].note).toBe('Foreign note');
  await expect(page.getByRole('dialog').locator('input[data-dialog-autofocus]')).toHaveValue('My activity');

  const accepted = page.waitForEvent('dialog');
  const successful = page.waitForResponse(r => r.url().endsWith(`/api/blocks/${id}`) && r.request().method() === 'PUT');
  const secondClick = page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await (await accepted).accept(); await secondClick;
  const response = await successful;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON().expectedRevision).toBe(peer.revision);
  expect(writes).toBe(2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await getState(page)).blocks[0]).toMatchObject({ title: 'My activity', note: 'Original note' });
});

test('an overwrite confirmation cannot authorize a newer unseen revision', async ({ page }) => {
  const id = await editBlock(page);
  await mutate(page, `/api/blocks/${id}`, 'PUT', { ...original, note: 'First peer change' });
  await saveConflict(page, id);
  const prompt = page.waitForEvent('dialog');
  const response = page.waitForResponse(r => r.url().endsWith(`/api/blocks/${id}`) && r.request().method() === 'PUT');
  const click = page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  const confirmation = await prompt;
  await mutate(page, `/api/blocks/${id}`, 'PUT', { ...original, note: 'Newer peer change' });
  await confirmation.accept(); await click;
  expect((await response).status()).toBe(409);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('zwischenzeitlich geändert');
  expect((await getState(page)).blocks[0].note).toBe('Newer peer change');
  await expect(page.getByRole('dialog').locator('input[data-dialog-autofocus]')).toHaveValue('My activity');
});

test('an unrelated revision does not require overwriting the unchanged target', async ({ page }) => {
  const id = await editBlock(page);
  await mutate(page, '/api/blocks', 'POST', { ...original, start: '2026-09-29T08:00:00Z', end: '2026-09-29T09:00:00Z', title: 'Other block' });
  await saveConflict(page, id);
  let prompts = 0;
  page.on('dialog', async dialog => { prompts++; await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(prompts).toBe(0);
  const blocks = (await getState(page)).blocks;
  expect(blocks.find(block => block.id === id)?.title).toBe('My activity');
  expect(blocks.some(block => block.title === 'Other block')).toBe(true);
});

test('a deleted target stays deleted and the editor retains its draft', async ({ page }) => {
  const id = await editBlock(page);
  await mutate(page, `/api/blocks/${id}`, 'DELETE');
  await saveConflict(page, id);
  const response = page.waitForResponse(r => r.url().endsWith(`/api/blocks/${id}`) && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Arbeitszeit speichern', exact: true }).click();
  expect((await response).status()).toBe(404);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('nicht gefunden');
  await expect(page.getByRole('dialog').locator('input[data-dialog-autofocus]')).toHaveValue('My activity');
  expect((await getState(page)).blocks).toHaveLength(0);
});
