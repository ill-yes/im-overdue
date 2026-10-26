import type { ImportPreview, Source } from '../../../shared/types.js';
import { localDate, Temporal } from '../../../shared/time.js';

export interface PreviewPeriod {
  first: string;
  last: string;
  openDate: string;
}

export type SourceCount = [Source, number];

export function periodOf(
  rows: ImportPreview['rows'],
  zone: string,
): PreviewPeriod | null {
  if (!rows.length) return null;
  let first = rows[0].activity.start;
  let last = rows[0].activity.end ?? first;
  for (const { activity } of rows) {
    if (Temporal.Instant.compare(activity.start, first) < 0) first = activity.start;
    const end = activity.end ?? activity.start;
    if (Temporal.Instant.compare(end, last) > 0) last = end;
  }
  return { first, last, openDate: localDate(first, zone) };
}

export function sourceCountsOf(rows: ImportPreview['rows']): SourceCount[] {
  const counts = new Map<Source, number>();
  for (const { activity } of rows) counts.set(activity.source, (counts.get(activity.source) ?? 0) + 1);
  return [...counts.entries()];
}
