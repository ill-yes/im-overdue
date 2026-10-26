import { afterEach, describe, expect, it } from 'vitest';
import {
  duration,
  formatActivityDateTime,
  longDate,
  periodLabel,
  shortDate,
  sourceLabel,
  weekLabel,
} from '../src/format.js';

import { dateObj, fullDate, shortDate as calendarDate, weekday } from '../src/calendar/format.js';
import { setLanguage } from '../src/i18n.js';

const previousZone = process.env.TZ;
afterEach(() => {
  setLanguage('en');
  if (previousZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousZone;
});
describe('display formatting', () => {
  it('defaults to English with British dates and supports explicit German', () => {
    expect(shortDate('2026-09-28')).toBe('28/09/2026');
    expect(weekLabel('2026-09-28', 'en')).toBe('28/09/2026 – 04/10/2026');
    expect(periodLabel('2026-06-01', 'month', 'en')).toBe('June 2026');
    expect(longDate('2026-10-02', 'en')).toBe('Friday, 2 October 2026');
    expect(periodLabel('2026-06-01', 'quarter', 'en')).toBe('Q2 2026');
    expect(periodLabel('2026-06-01', 'quarter', 'de')).toBe('2. Quartal 2026');
    expect(sourceLabel('other', 'en')).toBe('Other');
    expect(sourceLabel('google_calendar', 'en')).toBe('Calendar');
    expect(formatActivityDateTime('2026-10-25T01:15:00.000000001Z', 'Europe/Berlin', 'en')).toBe('25/10/2026 · 02:15:00.000000001 +01:00');
  });
  it('updates shared calendar formatters immediately when the language changes', () => {
    const date = dateObj('2026-09-28');
    setLanguage('en');
    expect(weekday.format(date)).toBe('Mon');
    expect(fullDate.format(date)).toBe('28/09');
    expect(calendarDate.format(date)).toBe('28 Sept 2026');
    setLanguage('de');
    expect(weekday.format(date)).toBe('Mo');
    expect(fullDate.format(date)).toBe('28.09.');
    expect(calendarDate.format(date)).toBe('28. Sept. 2026');
    expect(weekLabel('2026-09-28')).toBe('28.09.2026 – 04.10.2026');
    expect(fullDate.format(date, 'en')).toBe('28/09');
  });
  it('keeps calendar dates and months independent of the computer timezone', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(shortDate('2026-09-28', 'de')).toBe('28.09.2026');
    expect(weekLabel('2026-09-28', 'de')).toBe('28.09.2026 – 04.10.2026');
    expect(periodLabel('2026-06-01', 'month', 'de')).toBe('Juni 2026');
    expect(longDate('2026-10-02', 'de')).toBe('Freitag, 2. Oktober 2026');
  });
  it('formats minutes without decimal-hour ambiguity', () => {
    expect(duration(125, true)).toBe('+2:05 h');
    expect(duration(-35, true)).toBe('−0:35 h');
    expect(duration(0, true)).toBe('±0 h');
    expect(duration(240.5)).toBe('4:00:30 h');
    expect(duration(-0.5, true)).toBe('−0:00:30 h');
    expect(duration(480.0000000001)).toBe('8 h');
  });
  it('preserves activity precision and repeated wall-time offsets', () => {
    expect(formatActivityDateTime('2026-10-25T00:15:00Z', 'Europe/Berlin', 'de')).toBe('25.10.2026 · 02:15 +02:00');
    expect(formatActivityDateTime('2026-10-25T01:15:00.000000001Z', 'Europe/Berlin', 'de')).toBe(
      '25.10.2026 · 02:15:00.000000001 +01:00',
    );
    expect(formatActivityDateTime('2026-10-02T00:15:30Z', 'America/New_York', 'de')).toBe(
      '01.10.2026 · 20:15:30 -04:00',
    );
  });
  it('uses one source label across every evidence surface', () => {
    expect(sourceLabel('other', 'de')).toBe('Sonstige');
    expect(sourceLabel('google_calendar', 'de')).toBe('Kalender');
  });
});
