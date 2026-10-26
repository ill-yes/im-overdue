import { Temporal } from '@js-temporal/polyfill';

export { Temporal };
export function addDays(date: string, count: number): string {
  return Temporal.PlainDate.from(date).add({ days: count }).toString();
}
export function weekStartFor(date: string): string {
  const d = Temporal.PlainDate.from(date);
  return d.subtract({ days: d.dayOfWeek - 1 }).toString();
}
export function today(zone: string): string { return Temporal.Now.plainDateISO(zone).toString(); }
export function localDate(instant: string, zone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDate().toString();
}
export function localTime(instant: string, zone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainTime().toString({ smallestUnit: 'minute' });
}
export function offsetAt(instant: string, zone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).offset;
}
export function localTimeWithOffset(instant: string, zone: string): string {
  const local = Temporal.Instant.from(instant).toZonedDateTimeISO(zone);
  return `${local.toPlainTime().toString({ smallestUnit: 'minute' }).slice(0, 5)} ${local.offset}`;
}
export function minutesBetween(start: string, end: string): number {
  return (Temporal.Instant.from(end).epochMilliseconds - Temporal.Instant.from(start).epochMilliseconds) / 60000;
}
export function dayBounds(date: string, zone: string): { start: string; end: string; minutes: number } {
  const d = Temporal.PlainDate.from(date);
  const start = d.toZonedDateTime(zone).toInstant().toString();
  const end = d.add({ days: 1 }).toZonedDateTime(zone).toInstant().toString();
  return { start, end, minutes: minutesBetween(start, end) };
}
export function instantAtMinute(date: string, minute: number, zone: string): string {
  return Temporal.Instant.from(dayBounds(date, zone).start).add({ minutes: minute }).toString();
}
export function minuteInDay(instant: string, date: string, zone: string): number {
  return minutesBetween(dayBounds(date, zone).start, instant);
}
export function shiftInstant(instant: string, minutes: number): string {
  return Temporal.Instant.from(instant).add({ minutes }).toString();
}
export type LocalResolution =
  | { kind: 'valid'; instant: string }
  | { kind: 'ambiguous'; earlier: string; later: string }
  | { kind: 'missing' };
export function resolveLocal(date: string, time: string, zone: string): LocalResolution {
  const plain = Temporal.PlainDateTime.from(`${date}T${time}`);
  const early = plain.toZonedDateTime(zone, { disambiguation: 'earlier' });
  const late = plain.toZonedDateTime(zone, { disambiguation: 'later' });
  if (!early.toPlainDateTime().equals(plain) || !late.toPlainDateTime().equals(plain)) return { kind: 'missing' };
  if (early.epochNanoseconds !== late.epochNanoseconds) {
    return { kind: 'ambiguous', earlier: early.toInstant().toString(), later: late.toInstant().toString() };
  }
  return { kind: 'valid', instant: early.toInstant().toString() };
}
export function clipToDay(start: string, end: string, date: string, zone: string): { start: string; end: string; minutes: number } | null {
  const bounds = dayBounds(date, zone);
  const a = Temporal.Instant.compare(start, bounds.start) > 0 ? start : bounds.start;
  const b = Temporal.Instant.compare(end, bounds.end) < 0 ? end : bounds.end;
  return Temporal.Instant.compare(a, b) < 0 ? { start: a, end: b, minutes: minutesBetween(a, b) } : null;
}
export function splitAtMidnights(start: string, end: string, zone: string): { start: string; end: string }[] {
  const latestEnd = Temporal.Instant.from(start).toZonedDateTimeISO(zone).add({ days: 7 }).toInstant();
  if (Temporal.Instant.compare(start, end) >= 0 || Temporal.Instant.compare(end, latestEnd) > 0) {
    throw new Error('Ein Arbeitsblock muss positiv und hoechstens sieben lokale Kalendertage lang sein.');
  }
  const result = [];
  let cursor = start;
  while (Temporal.Instant.compare(cursor, end) < 0) {
    const boundary = dayBounds(localDate(cursor, zone), zone).end;
    const next = Temporal.Instant.compare(boundary, end) < 0 ? boundary : end;
    result.push({ start: cursor, end: next });
    cursor = next;
  }
  return result;
}
export function datesInRange(from: string, toExclusive: string): string[] {
  const dates: string[] = [];
  for (let d = from; d < toExclusive; d = addDays(d, 1)) {
    if (dates.length >= 370) throw new Error('Zeitraum ist zu gross.');
    dates.push(d);
  }
  return dates;
}
export function periodBounds(anchor: string, kind: 'month' | 'quarter' | 'year'): { from: string; to: string } {
  const d = Temporal.PlainDate.from(anchor);
  const start = kind === 'year' ? d.with({ month: 1, day: 1 }) : kind === 'quarter'
    ? d.with({ month: Math.floor((d.month - 1) / 3) * 3 + 1, day: 1 }) : d.with({ day: 1 });
  return { from: start.toString(), to: start.add({ months: kind === 'year' ? 12 : kind === 'quarter' ? 3 : 1 }).toString() };
}
