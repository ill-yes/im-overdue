import { describe, expect, it } from 'vitest';
import { formatPackageCounts } from '../src/components/data-sources/format';

describe('package count display parity', () => {
  it('keeps the field order and wording used by both package rows and details', () => {
    expect(formatPackageCounts({ total: 10, new: 4, updated: 2, unchanged: 4, duplicates: 3 })).toBe(
      '10 Belege · 4 neu · 2 aktualisiert · 4 unverändert · 3 Duplikate',
    );
  });

  it('preserves zero and single-item labels without introducing wording changes', () => {
    expect(formatPackageCounts({ total: 1, new: 1, updated: 0, unchanged: 0, duplicates: 0 })).toBe(
      '1 Belege · 1 neu · 0 aktualisiert · 0 unverändert · 0 Duplikate',
    );
    expect(formatPackageCounts({ total: 0, new: 0, updated: 0, unchanged: 0, duplicates: 0 })).toBe(
      '0 Belege · 0 neu · 0 aktualisiert · 0 unverändert · 0 Duplikate',
    );
  });

  it('uses English labels and number separators when requested and never changes the counts', () => {
    const counts = { total: 1000, new: 900, updated: 20, unchanged: 80, duplicates: 3 };
    const before = { ...counts };
    expect(formatPackageCounts(counts, 'en')).toBe('1,000 pieces of evidence · 900 new · 20 updated · 80 unchanged · 3 duplicates');
    expect(formatPackageCounts(counts, 'de')).toBe('1.000 Belege · 900 neu · 20 aktualisiert · 80 unverändert · 3 Duplikate');
    expect(counts).toEqual(before);
  });
});
