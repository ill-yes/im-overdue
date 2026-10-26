import { afterEach, describe, expect, it } from 'vitest';
import { reportBlockTime, reportDate, reportDuration } from '../src/timesheet-format.js';
import type { TimesheetBlock, TimesheetDay } from '../shared/types.js';

const previousZone = process.env.TZ;
afterEach(() => {
  if (previousZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousZone;
});

const day = (date: string): TimesheetDay => ({
  date, status: 'closed', blocks: [], vacationFraction: 0, dayNote: '', weekNote: '',
  totals: { actualMinutes: 0, vacationMinutes: 0, targetMinutes: 0, balanceMinutes: 0 },
});
const block = (start: string, end: string): TimesheetBlock => ({ start, end, minutes: 0, title: '', note: '' });

describe('timesheet duration formatting', () => {
  it.each([
    [480, false, '8:00'],
    [30, false, '0:30'],
    [240.5, false, '4:00:30'],
    [480, true, '+8:00'],
    [240.5, true, '+4:00:30'],
    [-30, false, '−0:30'],
    [-30, true, '−0:30'],
    [-0.5, true, '−0:00:30'],
    [0, false, '0:00'],
    [0, true, '0:00'],
    [-0, true, '0:00'],
    [-0.000001, true, '0:00'],
    [0.000001, true, '0:00'],
    [480.0000000001, false, '8:00'],
    [59.999, false, '1:00'],
    [2400 / 7, false, '5:42:51'],
    [-2400 / 7, true, '−5:42:51'],
  ])('formats %s minutes (signed: %s) as %s', (minutes, signed, expected) => {
    expect(reportDuration(minutes, signed)).toBe(expected);
  });
});

describe('timesheet date formatting', () => {
  it('uses English by default and keeps weekday and calendar dates', () => {
    expect(reportDate('2026-09-28')).toBe('Mon 28/09');
    expect(reportDate('2026-09-28', true, 'en')).toBe('Mon 28/09/2026');
    expect(reportDate('2028-02-29', true, 'en')).toBe('Tue 29/02/2028');
  });
  it.each(['America/Los_Angeles', 'Pacific/Kiritimati', 'Europe/Berlin'])('keeps calendar dates stable in %s', timezone => {
    process.env.TZ = timezone;
    expect(reportDate('2026-09-28', false, 'de')).toBe('Mo 28.09.');
    expect(reportDate('2026-09-28', true, 'de')).toBe('Mo 28.09.2026');
    expect(reportDate('2026-10-04', false, 'de')).toBe('So 04.10.');
    expect(reportDate('2028-02-29', true, 'de')).toBe('Di 29.02.2028');
  });
});

describe('timesheet block formatting', () => {
  it('shows ordinary local intervals without redundant seconds or offsets', () => {
    expect(reportBlockTime(day('2026-09-28'), block('2026-09-28T06:00:00Z', '2026-09-28T10:00:00Z'), 'Europe/Berlin'))
      .toBe('08:00-12:00');
  });

  it('labels only the exact end of the local day as 24:00', () => {
    expect(reportBlockTime(day('2026-09-28'), block('2026-09-28T21:00:00Z', '2026-09-28T22:00:00Z'), 'Europe/Berlin'))
      .toBe('23:00-24:00');
    expect(reportBlockTime(day('2026-09-28'), block('2026-09-28T21:00:00Z', '2026-09-28T21:59:59.999999999Z'), 'Europe/Berlin'))
      .toBe('23:00-23:59:59.999999999');
    expect(reportBlockTime(day('2026-09-29'), block('2026-09-28T22:00:00Z', '2026-09-28T23:00:00Z'), 'Europe/Berlin'))
      .toBe('00:00-01:00');
  });

  it('preserves seconds and nanoseconds independently on both endpoints', () => {
    expect(reportBlockTime(day('2026-09-28'), block('2026-09-28T06:00:30Z', '2026-09-28T10:00:00.000000001Z'), 'Europe/Berlin'))
      .toBe('08:00:30-12:00:00.000000001');
    expect(reportBlockTime(day('2026-09-28'), block('2026-09-28T06:00:00.123456789Z', '2026-09-28T10:00:05.12Z'), 'Europe/Berlin'))
      .toBe('08:00:00.123456789-12:00:05.12');
  });

  it('labels both sides of the spring gap with their real offsets', () => {
    expect(reportBlockTime(day('2026-03-29'), block('2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z'), 'Europe/Berlin'))
      .toBe('01:30 +01:00-03:30 +02:00');
    expect(reportBlockTime(day('2026-03-29'), block('2026-03-29T06:00:00Z', '2026-03-29T10:00:00Z'), 'Europe/Berlin'))
      .toBe('08:00 +02:00-12:00 +02:00');
    expect(reportBlockTime(day('2026-03-29'), block('2026-03-29T20:00:00Z', '2026-03-29T22:00:00Z'), 'Europe/Berlin'))
      .toBe('22:00 +02:00-24:00 +02:00');
  });

  it('distinguishes repeated wall-clock times in the autumn fold without losing precision', () => {
    expect(reportBlockTime(day('2026-10-25'), block('2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z'), 'Europe/Berlin'))
      .toBe('02:30 +02:00-02:30 +01:00');
    expect(reportBlockTime(day('2026-10-25'), block('2026-10-25T00:15:00.000000001Z', '2026-10-25T01:15:30Z'), 'Europe/Berlin'))
      .toBe('02:15:00.000000001 +02:00-02:15:30 +01:00');
    expect(reportBlockTime(day('2026-10-25'), block('2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z'), 'Europe/Berlin'))
      .toBe('00:00 +02:00-24:00 +01:00');
  });

  it('keeps 24:00 on the reported side of a next-day midnight offset change', () => {
    expect(reportBlockTime(day('2018-11-03'), block('2018-11-03T23:00:00Z', '2018-11-04T03:00:00Z'), 'America/Sao_Paulo'))
      .toBe('20:00-24:00');
  });

  it('uses offsets for a non-hour DST transition', () => {
    expect(reportBlockTime(day('2026-10-04'), block('2026-10-03T15:15:00Z', '2026-10-03T15:45:00Z'), 'Australia/Lord_Howe'))
      .toBe('01:45 +10:30-02:45 +11:00');
  });
});
