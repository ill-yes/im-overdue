import { Temporal, dayBounds } from '../shared/time.js';
import type { TimesheetBlock, TimesheetDay } from '../shared/types.js';

import { getLanguage, type Language } from './i18n.js';

const WEEKDAYS = { de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };
const pad = (value: number) => String(value).padStart(2, '0');

export function reportDuration(minutes: number, signed = false): string {
  const seconds = Math.round(Math.abs(minutes) * 60);
  const hours = Math.floor(seconds / 3600);
  const remainder = seconds % 60;
  const body = `${hours}:${pad(Math.floor(seconds / 60) % 60)}${remainder ? `:${pad(remainder)}` : ''}`;
  const sign = seconds === 0 ? '' : minutes < 0 ? '−' : signed ? '+' : '';
  return `${sign}${body}`;
}

export function reportDate(date: string, includeYear = false, language: Language = getLanguage()): string {
  const day = Temporal.PlainDate.from(date);
  const separator = language === 'de' ? '.' : '/';
  return `${WEEKDAYS[language][day.dayOfWeek - 1]} ${pad(day.day)}${separator}${pad(day.month)}${language === 'de' || includeYear ? separator : ''}${includeYear ? day.year : ''}`;
}

export function reportBlockTime(day: TimesheetDay, block: TimesheetBlock, timezone: string): string {
  const bounds = dayBounds(day.date, timezone);
  const start = Temporal.Instant.from(block.start).toZonedDateTimeISO(timezone);
  const endInstant = Temporal.Instant.from(block.end);
  const atBoundary = Temporal.Instant.compare(endInstant, bounds.end) === 0;
  const end = endInstant.toZonedDateTimeISO(timezone);
  // A 24:00 label belongs to the day being reported, before a possible midnight offset change.
  const endOffset = atBoundary
    ? endInstant.subtract({ nanoseconds: 1 }).toZonedDateTimeISO(timezone).offset
    : end.offset;
  const showOffsets = bounds.minutes !== 1440 || start.offset !== endOffset;
  const time = (value: typeof start) => {
    const precise = value.second !== 0 || value.millisecond !== 0 || value.microsecond !== 0 || value.nanosecond !== 0;
    return value.toPlainTime().toString(precise ? {} : { smallestUnit: 'minute' });
  };
  const from = `${time(start)}${showOffsets ? ` ${start.offset}` : ''}`;
  const to = `${atBoundary ? '24:00' : time(end)}${showOffsets ? ` ${endOffset}` : ''}`;
  return `${from}-${to}`;
}
