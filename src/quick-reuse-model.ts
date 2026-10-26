import { translate, type Language } from '../shared/i18n.js';
import { calendarMessages } from './locales/calendar.js';
import type { AppState, ReusableInput } from '../shared/types.js';
import { legacyReuseEntries, matchesReuse, recentReuseEntries } from './reuse-model';

export interface QuickReuseEntry extends ReusableInput { id: string; workDate?: string }
export interface QuickReuseGroup { id: string; label: string; entries: QuickReuseEntry[] }

function uniqueText<T extends QuickReuseEntry>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = JSON.stringify([entry.title.trim(), entry.note.trim()]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Reuse supplies text only: different durations are the same quick choice. */
export function quickReuseGroups(state: Pick<AppState, 'recentEntries' | 'templates' | 'blocks'>, zone: string, query = '', language: Language = 'en'): QuickReuseGroup[] {
  return [
    { id: 'recent', label: translate(calendarMessages, 'recent', {}, language), entries: uniqueText(recentReuseEntries(state.recentEntries)) },
    { id: 'templates', label: translate(calendarMessages, 'templates', {}, language), entries: uniqueText(state.templates) },
    { id: 'legacy', label: translate(calendarMessages, 'legacy', {}, language), entries: uniqueText(legacyReuseEntries(state.blocks, zone)) },
  ].map((group) => ({ ...group, entries: group.entries.filter((entry) => matchesReuse(entry, query)) }));
}
