import { describe, expect, it } from 'vitest';
import type { WorkBlock } from '../shared/types.js';
import { legacyReuseEntries, matchesReuse, recentReuseEntries } from '../src/reuse-model.js';

const block = (id: string, start: string, end: string, createdAt: string | null = null): WorkBlock => ({
  id, start, end, createdAt, title: 'Review', note: 'Projekt A',
});

describe('reusable entry lists', () => {
  it('shows the latest creation events, capped at 20', () => {
    const entries = Array.from({ length: 23 }, (_, index) => ({
      id: String(index), createdAt: `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00Z`,
      title: 'Review', note: '', durationMinutes: 60,
    }));
    expect(recentReuseEntries(entries).map((entry) => entry.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => String(22 - index)),
    );
  });

  it('retains the server creation order when timestamps share a millisecond', () => {
    const entries = ['a-newest', 'z-older'].map(id => ({
      id, createdAt: '2026-10-02T10:00:00.000Z', title: id, note: '', durationMinutes: 60,
    }));
    expect(recentReuseEntries(entries).map(entry => entry.id)).toEqual(['a-newest', 'z-older']);
  });

  it('derives full legacy durations, sorts by work date and deduplicates values', () => {
    const blocks = [
      block('old', '2026-03-29T00:30:00Z', '2026-03-29T02:30:00Z'),
      block('duplicate', '2026-03-30T00:30:00Z', '2026-03-30T02:30:00Z'),
      block('new', '2026-04-01T08:00:00Z', '2026-04-01T09:00:00Z', '2026-04-02T08:00:00Z'),
    ];
    expect(legacyReuseEntries(blocks)).toEqual([{ id: 'duplicate', workDate: '2026-03-30', title: 'Review', note: 'Projekt A', durationMinutes: 120 }]);
  });

  it('filters across title and note case insensitively', () => {
    expect(matchesReuse({ title: 'Review', note: 'Projekt A', durationMinutes: 30 }, ' review PROJEKT ')).toBe(true);
    expect(matchesReuse({ title: 'Review', note: 'Projekt A', durationMinutes: 30 }, 'Planung')).toBe(false);
  });
});
