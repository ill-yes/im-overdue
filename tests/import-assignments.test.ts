import { describe, expect, it } from 'vitest';
import type { DataSource, ImportAnalysis, Source } from '../shared/types.js';
import { assignmentsComplete, initialAssignments } from '../src/components/import/assignments';

function source(id: string, type: Source): DataSource {
  return { id, type, name: id, activityCount: 0, packageCount: 0,
    lastImportedAt: null, firstActivityStart: null, legacyCount: 0 };
}
const analysis: ImportAnalysis = {
  sources: [{ source: 'slack', count: 3 }, { source: 'github', count: 2 }],
  total: 5, duplicates: 0, errors: [],
};

describe('import source assignments', () => {
  it('automatically chooses only unambiguous sources of the matching type', () => {
    expect(initialAssignments(analysis, [source('s1', 'slack'), source('s2', 'slack'), source('g1', 'github')]))
      .toEqual({ github: 'g1' });
  });

  it('preselects the explicitly opened source only for its own type', () => {
    const targets = [source('s1', 'slack'), source('s2', 'slack'), source('g1', 'github'), source('g2', 'github')];
    expect(initialAssignments(analysis, targets, 's2')).toEqual({ slack: 's2' });
    expect(initialAssignments(analysis, targets, 'missing')).toEqual({});
  });

  it('requires a valid matching target for every detected source type', () => {
    const targets = [source('s1', 'slack'), source('g1', 'github')];
    expect(assignmentsComplete(analysis, { slack: 's1', github: 'g1' }, targets)).toBe(true);
    expect(assignmentsComplete(analysis, { slack: 'g1', github: 'g1' }, targets)).toBe(false);
    expect(assignmentsComplete(analysis, { slack: 's1' }, targets)).toBe(false);
    expect(assignmentsComplete(analysis, { slack: 's1', github: 'g1' }, targets.slice(0, 1))).toBe(false);
  });

  it('blocks empty or invalid input even when assignments exist', () => {
    const targets = [source('s1', 'slack'), source('g1', 'github')];
    const assignments = { slack: 's1', github: 'g1' };
    expect(assignmentsComplete({ ...analysis, errors: [{ row: 2, message: 'Ungültige Zeit' }] }, assignments, targets)).toBe(false);
    expect(assignmentsComplete({ ...analysis, total: 0, sources: [] }, assignments, targets)).toBe(false);
  });

  it('does not mutate the analysis, sources or a previous assignment selection', () => {
    const targets = [source('s1', 'slack'), source('g1', 'github')];
    const original = JSON.stringify({ analysis, targets });
    const chosen = initialAssignments(analysis, targets);
    chosen.slack = 'changed';
    expect(initialAssignments(analysis, targets)).toEqual({ slack: 's1', github: 'g1' });
    expect(JSON.stringify({ analysis, targets })).toBe(original);
  });
});
