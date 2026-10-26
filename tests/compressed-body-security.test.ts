import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/compressed-body-server.ts', import.meta.url));

async function isolatedScenario(mode: 'valid' | 'trailing', scenario: string) {
  const directory = await mkdtemp(join(tmpdir(), 'im-overdue-compressed-body-'));
  try {
    // An unhandled decoder error must terminate only this disposable server,
    // never the Vitest worker. Do not inherit database/password configuration.
    const result = await execute(process.execPath, ['--import', 'tsx', fixture, directory, mode, scenario], {
      cwd: root,
      env: { NODE_ENV: 'test' },
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    expect(result.stdout.trim()).toBe('compressed-body scenario passed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('compressed JSON request security (GHSA-27r3-jxmh-p828)', () => {
  it.each(['gzip', 'deflate', 'br'])('preserves valid %s login, API mutation and import requests', async encoding => {
    await isolatedScenario('valid', encoding);
  }, 15_000);

  it.each(['/api/auth/login', '/api/notes/day/2026-09-28', '/api/import/preview'])(
    'keeps the process and later requests alive after trailing gzip bytes at %s',
    async path => { await isolatedScenario('trailing', path); },
    15_000,
  );
});
