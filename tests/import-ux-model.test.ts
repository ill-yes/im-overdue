import { describe, expect, it } from 'vitest';
import type { DataSource, ImportAnalysis, Source } from '../shared/types.js';
import { canSkipAssignments, initialAssignments } from '../src/components/import/assignments';

const source = (id: string, type: Source): DataSource => ({
  id, type, name: id, activityCount: 0, packageCount: 0,
  lastImportedAt: null, firstActivityStart: null, legacyCount: 0,
});
const analysis: ImportAnalysis = {
  sources: [{ source: 'slack', count: 2 }], total: 2, duplicates: 0, errors: [],
};

describe('source-specific import shortcut', () => {
  it('skips only for one valid detected type matching the explicit existing source', () => {
    const targets = [source('work', 'slack'), source('personal', 'slack')];
    expect(canSkipAssignments(analysis, targets, 'work')).toBe(true);
    expect(initialAssignments(analysis, targets, 'work')).toEqual({ slack: 'work' });
  });

  it('keeps assignment review for global, missing and mismatched targets', () => {
    const targets = [source('work', 'slack'), source('code', 'github')];
    expect(canSkipAssignments(analysis, targets)).toBe(false);
    expect(canSkipAssignments(analysis, targets, 'missing')).toBe(false);
    expect(canSkipAssignments(analysis, targets, 'code')).toBe(false);
    expect(canSkipAssignments(analysis, [], 'work')).toBe(false);
  });

  it('keeps assignment review for multiple types, empty input and analysis errors', () => {
    const targets = [source('work', 'slack'), source('code', 'github')];
    expect(canSkipAssignments({ ...analysis, sources: [...analysis.sources, { source: 'github', count: 1 }] }, targets, 'work')).toBe(false);
    expect(canSkipAssignments({ ...analysis, sources: [], total: 0 }, targets, 'work')).toBe(false);
    expect(canSkipAssignments({ ...analysis, errors: [{ row: 1, message: 'Ungültige Zeile' }] }, targets, 'work')).toBe(false);
  });
});
