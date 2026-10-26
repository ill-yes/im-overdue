import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api.js';

afterEach(() => vi.unstubAllGlobals());

it('sends the captured review key without changing legacy week requests', async () => {
  const request = vi.fn().mockImplementation(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', request);
  await api.setWeek('2026-10-19', 'closed', 7, true, true, 'shown-review');
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
    status: 'closed', expectedRevision: 7, confirmCurrent: true, confirmWarnings: true, reviewKey: 'shown-review',
  });
  await api.setWeek('2026-10-19', 'open', 8);
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
    status: 'open', expectedRevision: 8, confirmCurrent: false, confirmWarnings: false,
  });
});

it('uses canonical four-digit years for the allowance endpoint', async () => {
  const request = vi.fn().mockImplementation(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', request);
  await api.saveVacationAllowance({ year: 42, entitlementDays: 30, carryoverDays: 0 }, 1);
  expect(request.mock.calls[0][0]).toBe('/api/vacation-allowances/0042');
});
