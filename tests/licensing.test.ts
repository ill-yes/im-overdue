import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

describe('project licensing metadata', () => {
  it('preserves the MIT license text and copyright notice', () => {
    const license = read('LICENSE').replaceAll('\r\n', '\n');
    expect(createHash('sha256').update(license).digest('hex'))
      .toBe('8b76e22de96b520dbae99c27b4af1216fa3aef42a7074b26bfc7adf1f11b292e');
  });

  it('keeps package and lockfile metadata aligned without enabling npm publication', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    expect(pkg.license).toBe('MIT');
    expect(lock.packages[''].license).toBe('MIT');
    expect(pkg.private).toBe(true);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
  });

  it('preserves attribution and third-party license notices', () => {
    expect(read('NOTICE')).toContain('Copyright (c) 2026 ill-yes');
    expect(read('NOTICE')).toContain('Third-party software');
    expect(read('CONTRIBUTING.md')).toContain('Contributors retain their rights');
  });
});
