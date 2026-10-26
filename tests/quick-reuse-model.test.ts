import { describe, expect, it } from 'vitest';
import type { AppState } from '../shared/types.js';
import { quickReuseGroups } from '../src/quick-reuse-model';

const recent = (id: string, title: string, note: string, durationMinutes = 60) => ({ id, title, note, durationMinutes, createdAt: `2026-10-02T10:${id.padStart(2, '0')}:00Z` });
const state = (): Pick<AppState, 'recentEntries' | 'templates' | 'blocks'> => ({ recentEntries: [], templates: [], blocks: [] });

describe('quick reuse text groups', () => {
  it('keeps recent entries before templates and deduplicates text regardless of duration within each group', () => {
    const input = state();
    input.recentEntries = [recent('01', 'Review', 'Projekt A'), recent('02', 'Review', 'Projekt A', 120), recent('03', 'Review', 'Projekt B')];
    input.templates = [{ id: 'a', title: 'Review', note: 'Projekt A', durationMinutes: 30 }, { id: 'b', title: 'Review', note: 'Projekt A', durationMinutes: 90 }];
    const groups = quickReuseGroups(input, 'Europe/Berlin');
    expect(groups.map((group) => group.id)).toEqual(['recent', 'templates', 'legacy']);
    expect(groups[0].entries.map((entry) => entry.id)).toEqual(['03', '02']);
    expect(groups[1].entries.map((entry) => entry.id)).toEqual(['a']);
  });

  it('limits creation events to the existing recent 20 before deduplicating', () => {
    const input = state();
    input.recentEntries = Array.from({ length: 22 }, (_, index) => recent(String(index), index < 2 ? 'Older unique' : 'Same', ''));
    expect(quickReuseGroups(input, 'UTC')[0].entries.map((entry) => entry.title)).toEqual(['Same']);
  });

  it('searches title and note together in every source group', () => {
    const input = state();
    input.recentEntries = [recent('01', 'Review', 'Projekt Alpha'), recent('02', 'Call', 'Projekt Alpha')];
    input.templates = [{ id: 'template', title: 'Review', note: 'Projekt Alpha', durationMinutes: 30 }];
    expect(quickReuseGroups(input, 'UTC', ' REVIEW alpha ').map((group) => group.entries.length)).toEqual([1, 1, 0]);
  });

  it('isolates legacy entries and deduplicates their text without adopting a historical duration', () => {
    const input = state();
    input.blocks = [
      { id: 'old', title: 'Review', note: 'Legacy', createdAt: null, start: '2026-03-29T00:30:00Z', end: '2026-03-29T02:30:00Z' },
      { id: 'newer', title: 'Review', note: 'Legacy', createdAt: null, start: '2026-03-30T08:00:00Z', end: '2026-03-30T09:00:00Z' },
      { id: 'tracked', title: 'Tracked', note: '', createdAt: '2026-03-31T09:00:00Z', start: '2026-03-31T08:00:00Z', end: '2026-03-31T09:00:00Z' },
    ];
    expect(quickReuseGroups(input, 'Europe/Berlin')[2].entries.map((entry) => entry.id)).toEqual(['newer']);
  });
});
