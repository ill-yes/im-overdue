import { describe, expect, it } from 'vitest';
import { addDays, clipToDay, dayBounds, instantAtMinute, localDate, localTime, minutesBetween, offsetAt, periodBounds, resolveLocal, splitAtMidnights, weekStartFor } from '../shared/time.js';

const zone = 'Europe/Berlin';
describe('local calendar and elapsed time', () => {
  it('starts weeks on Monday, including year boundaries', () => {
    expect(weekStartFor('2026-10-04')).toBe('2026-09-28');
    expect(weekStartFor('2027-01-01')).toBe('2026-12-28');
  });
  it('has 24 hours normally, 23 in spring and 25 in autumn', () => {
    expect(dayBounds('2026-10-01', zone).minutes).toBe(1440);
    expect(dayBounds('2026-03-29', zone).minutes).toBe(1380);
    expect(dayBounds('2026-10-25', zone).minutes).toBe(1500);
  });
  it('maps spring drag positions to real instants without a missing 02:00 slot', () => {
    expect(localTime(instantAtMinute('2026-03-29', 120, zone), zone)).toBe('03:00');
    expect(minutesBetween(instantAtMinute('2026-03-29', 60, zone), instantAtMinute('2026-03-29', 180, zone))).toBe(120);
  });
  it('maps both autumn 02:00 slots separately and labels their offsets', () => {
    const early = instantAtMinute('2026-10-25', 120, zone);
    const late = instantAtMinute('2026-10-25', 180, zone);
    expect(localTime(early, zone)).toBe('02:00');
    expect(localTime(late, zone)).toBe('02:00');
    expect(offsetAt(early, zone)).toBe('+02:00');
    expect(offsetAt(late, zone)).toBe('+01:00');
    expect(minutesBetween(early, late)).toBe(60);
  });
  it('requires explicit choice for ambiguous times and rejects nonexistent local times', () => {
    expect(resolveLocal('2026-03-29', '02:30', zone)).toEqual({ kind: 'missing' });
    expect(resolveLocal('2026-10-25', '02:30', zone)).toEqual({ kind: 'ambiguous', earlier: '2026-10-25T00:30:00Z', later: '2026-10-25T01:30:00Z' });
    expect(resolveLocal('2026-10-01', '08:00', zone)).toEqual({ kind: 'valid', instant: '2026-10-01T06:00:00Z' });
  });
  it('splits at local midnight, not UTC midnight', () => {
    expect(splitAtMidnights('2026-10-01T21:00:00Z', '2026-10-01T23:00:00Z', zone)).toEqual([
      { start: '2026-10-01T21:00:00Z', end: '2026-10-01T22:00:00Z' },
      { start: '2026-10-01T22:00:00Z', end: '2026-10-01T23:00:00Z' },
    ]);
  });
  it('clips half-open intervals without counting the end in the next day', () => {
    expect(clipToDay('2026-10-01T20:00:00Z', '2026-10-01T22:00:00Z', '2026-10-02', zone)).toBeNull();
    expect(clipToDay('2026-10-01T20:00:00Z', '2026-10-01T23:00:00Z', '2026-10-02', zone)?.minutes).toBe(60);
  });
  it('rejects inverted and excessively long work intervals', () => {
    expect(() => splitAtMidnights('2026-10-01T12:00:00Z', '2026-10-01T11:00:00Z', zone)).toThrow();
    expect(() => splitAtMidnights('2026-10-01T12:00:00Z', '2026-11-01T12:00:00Z', zone)).toThrow();
  });
  it.each([
    ['2026-09-28T08:00:00+02:00', '2026-10-05T08:00:00+02:00', 168],
    ['2026-03-23T08:00:00+01:00', '2026-03-30T08:00:00+02:00', 167],
    ['2026-10-19T08:00:00+02:00', '2026-10-26T08:00:00+01:00', 169],
  ])('limits a work interval to seven local days from %s, including DST', (start, end, hours) => {
    const pieces = splitAtMidnights(start, end, zone);
    expect(pieces.reduce((sum, part) => sum + minutesBetween(part.start, part.end), 0)).toBe(hours * 60);
    const tooLate = new Date(Date.parse(end) + 60_000).toISOString();
    expect(() => splitAtMidnights(start, tooLate, zone)).toThrow('sieben lokale Kalendertage');
  });
  it('uses the configured timezone instead of the host timezone', () => {
    expect(localDate('2026-10-01T22:30:00Z', zone)).toBe('2026-10-02');
    expect(localDate('2026-10-01T22:30:00Z', 'America/New_York')).toBe('2026-10-01');
  });
  it('calculates exact calendar periods, including leap years', () => {
    expect(periodBounds('2026-10-31', 'month')).toEqual({ from: '2026-10-01', to: '2026-11-01' });
    expect(periodBounds('2026-11-01', 'quarter')).toEqual({ from: '2026-10-01', to: '2027-01-01' });
    expect(periodBounds('2026-10-01', 'year')).toEqual({ from: '2026-01-01', to: '2027-01-01' });
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});
