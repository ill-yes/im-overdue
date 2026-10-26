import { localDate, minutesBetween } from '../shared/time.js';
import type { RecentEntry, ReusableInput, WorkBlock } from '../shared/types.js';
import { REUSABLE_DURATION_MAX_MINUTES, reusableKey } from '../shared/reuse.js';

export interface LegacyEntry extends ReusableInput {
  id: string;
  workDate: string;
}

export function recentReuseEntries(entries: RecentEntry[], limit = 20): RecentEntry[] {
  return [...entries]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function legacyReuseEntries(blocks: WorkBlock[], zone = 'UTC'): LegacyEntry[] {
  const seen = new Set<string>();
  return blocks
    .filter((block) => block.createdAt === null)
    .sort((a, b) => b.start.localeCompare(a.start) || b.id.localeCompare(a.id))
    .flatMap((block) => {
      const durationMinutes = minutesBetween(block.start, block.end);
      if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > REUSABLE_DURATION_MAX_MINUTES) return [];
      const title = block.title.trim();
      const note = block.note.trim();
      const signature = reusableKey({ title, note, durationMinutes });
      if (seen.has(signature)) return [];
      seen.add(signature);
      return [{ id: block.id, workDate: localDate(block.start, zone), title, note, durationMinutes }];
    });
}

export function matchesReuse(entry: ReusableInput, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase('de-DE').split(/\s+/).filter(Boolean);
  const haystack = `${entry.title} ${entry.note}`.toLocaleLowerCase('de-DE');
  return terms.every((term) => haystack.includes(term));
}
