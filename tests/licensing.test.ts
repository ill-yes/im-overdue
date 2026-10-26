import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const identifier = 'PolyForm-Noncommercial-1.0.0';

describe('project licensing metadata', () => {
  it('preserves the official PolyForm Noncommercial 1.0.0 text without additions', () => {
    // Official plain text: https://polyformproject.org/licenses/noncommercial/1.0.0.txt
    // Normalize only Git checkout line endings, not the license wording or whitespace.
    const license = read('LICENSE').replaceAll('\r\n', '\n');
    expect(createHash('sha256').update(license).digest('hex'))
      .toBe('ffcca38841adb694b6f380647e15f17c446a4d1656fed51a1e2041d064c94cc8');
  });

  it('keeps package and lockfile metadata aligned without enabling npm publication', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    expect(pkg.license).toBe(identifier);
    expect(lock.packages[''].license).toBe(identifier);
    expect(pkg.private).toBe(true);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
  });

  it('keeps project attribution separate from the standard text and third-party rights', () => {
    expect(read('NOTICE')).toContain('Required Notice: Copyright (c) 2026 ill-yes (https://github.com/ill-yes)');
    expect(read('NOTICE')).toContain("not the project's PolyForm license");
    expect(read('COMMERCIAL-LICENSE.md')).toContain('This document grants no license');
    expect(read('CONTRIBUTING.md')).toContain('Contributors retain their rights');
    expect(read('LICENSE')).not.toContain('ill-yes');
  });
});
