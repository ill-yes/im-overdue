import { describe, expect, it } from 'vitest';
import { holidayForDate, holidayProfileForDate, holidayReviewRequired, regionalHolidays } from '../shared/holidays.js';
import { GERMAN_STATES, type GermanState, type HolidayProfile } from '../shared/types.js';

const profile = (region: GermanState | null, effectiveFrom = '1990-01-01'): HolidayProfile =>
  ({ id: `${region}-${effectiveFrom}`, effectiveFrom, region, ruleVersion: 1 });
const holiday = (date: string, region: GermanState = 'BE') => holidayForDate({ holidayProfiles: [profile(region)] }, date);
const dates = (year: number, region: GermanState) => regionalHolidays(year, region).map((item) => item.date);

describe('version 1 German whole-state public holidays', () => {
  const common = ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14',
    '2026-05-25', '2026-10-03', '2026-12-25', '2026-12-26'];
  it.each<[GermanState, string[]]>([
    ['BW', ['2026-01-06', '2026-06-04', '2026-11-01']],
    ['BY', ['2026-01-06', '2026-06-04', '2026-11-01']],
    ['BE', ['2026-03-08']],
    ['BB', ['2026-04-05', '2026-05-24', '2026-10-31']],
    ['HB', ['2026-10-31']], ['HH', ['2026-10-31']], ['HE', ['2026-06-04']],
    ['MV', ['2026-03-08', '2026-10-31']], ['NI', ['2026-10-31']],
    ['NW', ['2026-06-04', '2026-11-01']], ['RP', ['2026-06-04', '2026-11-01']],
    ['SL', ['2026-06-04', '2026-08-15', '2026-11-01']],
    ['SN', ['2026-10-31', '2026-11-18']], ['ST', ['2026-01-06', '2026-10-31']],
    ['SH', ['2026-10-31']], ['TH', ['2026-09-20', '2026-10-31']],
  ])('has the exact 2026 calendar for %s', (region, extras) => {
    expect(dates(2026, region)).toEqual([...common, ...extras].sort());
    expect(regionalHolidays(2026, region).every((item) => item.source === 'regional')).toBe(true);
  });

  it.each([
    [2000, '2000-04-23', '2000-04-21', '2000-06-12'],
    [2008, '2008-03-23', '2008-03-21', '2008-05-12'],
    [2011, '2011-04-24', '2011-04-22', '2011-06-13'],
    [2024, '2024-03-31', '2024-03-29', '2024-05-20'],
    [2038, '2038-04-25', '2038-04-23', '2038-06-14'],
  ])('calculates Gregorian Easter and offsets in %i', (year, easter, goodFriday, whitMonday) => {
    expect(dates(year, 'BB')).toContain(easter);
    expect(dates(year, 'BE')).toContain(goodFriday);
    expect(dates(year, 'BE')).toContain(whitMonday);
  });

  it('retains both names when two statutory holidays share one date', () => {
    expect(holiday('2008-05-01')).toEqual({ date: '2008-05-01', name: 'Tag der Arbeit / Christi Himmelfahrt',
      nameEn: 'Labour Day / Ascension Day', source: 'regional' });
    expect(dates(2008, 'BE').filter((date) => date === '2008-05-01')).toHaveLength(1);
  });

  it.each([
    ['2026-01-01', 'Neujahr', "New Year's Day"],
    ['2026-03-08', 'Internationaler Frauentag', "International Women's Day"],
    ['2026-04-03', 'Karfreitag', 'Good Friday'],
    ['2026-04-06', 'Ostermontag', 'Easter Monday'],
    ['2026-05-01', 'Tag der Arbeit', 'Labour Day'],
    ['2026-05-14', 'Christi Himmelfahrt', 'Ascension Day'],
    ['2026-05-25', 'Pfingstmontag', 'Whit Monday'],
    ['2026-10-03', 'Tag der Deutschen Einheit', 'German Unity Day'],
    ['2026-12-25', '1. Weihnachtstag', 'Christmas Day'],
    ['2026-12-26', '2. Weihnachtstag', 'Boxing Day'],
  ])('supplies stable German and English names for %s', (date, name, nameEn) => {
    expect(holiday(date)).toEqual({ date, name, nameEn, source: 'regional' });
  });

  it('does not turn local holidays or protected days into whole-state holidays', () => {
    expect(holiday('2026-08-15', 'BY')).toBeNull();
    expect(holiday('2026-08-08', 'BY')).toBeNull();
    expect(holiday('2026-11-18', 'BY')).toBeNull();
    expect(holiday('2026-06-04', 'SN')).toBeNull();
    expect(holiday('2026-06-04', 'TH')).toBeNull();
    expect(holiday('2026-12-24')).toBeNull();
    expect(holiday('2026-12-31')).toBeNull();
    expect(holiday('2026-05-08', 'BB')).toBeNull();
  });

  it('applies changed effective years instead of projecting modern rules backwards', () => {
    expect(holiday('2018-03-08', 'BE')).toBeNull();
    expect(holiday('2019-03-08', 'BE')?.nameEn).toBe("International Women's Day");
    expect(holiday('2022-03-08', 'MV')).toBeNull();
    expect(holiday('2023-03-08', 'MV')?.nameEn).toBe("International Women's Day");
    expect(holiday('2018-09-20', 'TH')).toBeNull();
    expect(holiday('2019-09-20', 'TH')?.nameEn).toBe("World Children's Day");
    expect(holiday('1992-01-06', 'ST')).toBeNull();
    expect(holiday('1993-01-06', 'ST')?.nameEn).toBe('Epiphany');
  });

  it('limits Reformation Day to its permanent regions and the 2017 nationwide one-off', () => {
    for (const region of GERMAN_STATES) expect(holiday('2017-10-31', region)?.nameEn).toBe('Reformation Day');
    for (const region of ['HB', 'HH', 'NI', 'SH'] as const) {
      expect(holiday('2016-10-31', region)).toBeNull();
      expect(holiday('2018-10-31', region)?.nameEn).toBe('Reformation Day');
    }
    expect(holiday('2018-10-31', 'BE')).toBeNull();
    expect(holiday('2016-10-31', 'SN')?.nameEn).toBe('Reformation Day');
  });

  it.each<[GermanState, number]>([['BB', 1991], ['MV', 1992], ['SN', 1993], ['ST', 1992], ['TH', 1995]])(
    'starts whole-state Reformation in %s at its evidenced state-law boundary', (region, firstYear) => {
      expect(holiday(`${firstYear - 1}-10-31`, region)).toBeNull();
      expect(holiday(`${firstYear}-10-31`, region)?.nameEn).toBe('Reformation Day');
    });

  it.each<[GermanState, number, string, string]>([
    ['MV', 1992, '1992-04-19', '1992-06-07'],
    ['SN', 1992, '1992-04-19', '1992-06-07'],
    ['TH', 1994, '1994-04-03', '1994-05-22'],
  ])('preserves inherited Sunday holidays in %s through %i', (region, lastYear, easter, pentecost) => {
    expect(holiday(easter, region)?.nameEn).toBe('Easter Sunday');
    expect(holiday(pentecost, region)?.nameEn).toBe('Whit Sunday');
    expect(regionalHolidays(lastYear + 1, region).some((item) => item.nameEn.endsWith('Sunday'))).toBe(false);
  });
  it('retains evidenced ST Sundays but requires an override for its unresolved 1992 Whit Sunday', () => {
    expect(holiday('1991-03-31', 'ST')?.nameEn).toBe('Easter Sunday');
    expect(holiday('1991-05-19', 'ST')?.nameEn).toBe('Whit Sunday');
    expect(holiday('1992-04-19', 'ST')?.nameEn).toBe('Easter Sunday');
    expect(holiday('1992-06-07', 'ST')).toBeNull();
    expect(holidayForDate({ holidayProfiles: [profile('ST')], holidayOverrides: [
      { date: '1992-06-07', name: 'Pfingstsonntag' },
    ] }, '1992-06-07')?.source).toBe('manual');
  });

  it.each([[1990, '1990-11-21'], [1991, '1991-11-20'], [1992, '1992-11-18'],
    [1993, '1993-11-17'], [1994, '1994-11-16']] as const)('includes historical repentance days in %i', (year, date) => {
    for (const region of GERMAN_STATES) {
      expect(holiday(date, region)?.name).toBe('Buß- und Bettag');
    }
  });
  it('retains the repentance day only in Saxony from 1995', () => {
    for (const region of GERMAN_STATES) {
      expect(regionalHolidays(1995, region).some((item) => item.name === 'Buß- und Bettag')).toBe(region === 'SN');
    }
    expect(holiday('2022-11-16', 'SN')?.name).toBe('Buß- und Bettag');
  });

  it('applies Berlin special holidays on their exact years only', () => {
    for (const year of [2020, 2025]) expect(holiday(`${year}-05-08`)?.nameEn).toBe('Liberation Day');
    for (const year of [2019, 2021, 2024, 2026]) expect(holiday(`${year}-05-08`)).toBeNull();
    expect(holiday('2025-05-08', 'BB')).toBeNull();
    expect(holiday('2028-06-17')?.nameEn).toBe('75th anniversary of the uprising of 17 June 1953');
    expect(holiday('2027-06-17')).toBeNull();
    expect(holiday('2029-06-17')).toBeNull();
  });

  it('does not project the former western national holiday onto eastern territory', () => {
    expect(holiday('1990-06-17', 'NW')?.nameEn).toBe('German Unity Day');
    expect(holiday('1990-06-17', 'SN')).toBeNull();
    expect(holiday('1990-06-17', 'BE')).toBeNull();
    expect(holiday('1991-06-17', 'NW')).toBeNull();
    for (const region of GERMAN_STATES) expect(holiday('1990-10-03', region)?.nameEn).toBe('German Unity Day');
  });

  it.each<[string, GermanState, string, string]>([
    ['2026-01-06', 'ST', 'Heilige Drei Könige', 'Epiphany'],
    ['2026-04-05', 'BB', 'Ostersonntag', 'Easter Sunday'],
    ['2026-05-24', 'BB', 'Pfingstsonntag', 'Whit Sunday'],
    ['2026-06-04', 'HE', 'Fronleichnam', 'Corpus Christi'],
    ['2026-08-15', 'SL', 'Mariä Himmelfahrt', 'Assumption Day'],
    ['2026-09-20', 'TH', 'Weltkindertag', "World Children's Day"],
    ['2026-10-31', 'SH', 'Reformationstag', 'Reformation Day'],
    ['2026-11-01', 'RP', 'Allerheiligen', "All Saints' Day"],
    ['2026-11-18', 'SN', 'Buß- und Bettag', 'Day of Repentance and Prayer'],
  ])('supplies both names for regional holiday %s (%s)', (date, region, name, nameEn) => {
    expect(holiday(date, region)).toEqual({ date, name, nameEn, source: 'regional' });
  });

  it('never generates holidays before 1990 or silently uses a future rule version', () => {
    for (const region of GERMAN_STATES) expect(regionalHolidays(1989, region)).toEqual([]);
    expect(() => regionalHolidays(2026, 'BE', 2 as 1)).toThrow(RangeError);
    expect(() => regionalHolidays(2026.5, 'BE')).toThrow(RangeError);
  });
  it('returns independent results that cannot mutate later calculations', () => {
    const first = regionalHolidays(2026, 'BE');
    first[0].name = 'Changed';
    first.splice(1);
    expect(regionalHolidays(2026, 'BE')[0].name).toBe('Neujahr');
    expect(regionalHolidays(2026, 'BE')).toHaveLength(10);
  });
});

describe('dated holiday profiles and explicit overrides', () => {
  it('identifies the unresolved historical date until the user explicitly adds or excludes it', () => {
    const state = { holidayProfiles: [profile('ST')] };
    expect(holidayReviewRequired(state, '1992-06-07')).toBe(true);
    expect(holidayForDate(state, '1992-06-07')).toBeNull();
    expect(holidayReviewRequired({ holidayProfiles: [profile('BY')] }, '1992-06-07')).toBe(false);
    expect(holidayReviewRequired({ ...state, holidayOverrides: [{ date: '1992-06-07', name: null }] }, '1992-06-07')).toBe(false);
  });
  it('never leaks mutations through the bounded rule cache', () => {
    const state = { holidayProfiles: [profile('BE')] };
    holidayForDate(state, '2026-12-25')!.name = 'mutated';
    expect(holidayForDate(state, '2026-12-25')!.name).toBe('1. Weihnachtstag');
  });
  it('chooses the latest applicable unsorted profile at inclusive boundaries without mutation', () => {
    const profiles = [profile(null, '2026-07-01'), profile('BE'), profile('BY', '2026-04-01')];
    const copy = JSON.stringify(profiles);
    expect(holidayProfileForDate(profiles, '1989-12-31')).toBeUndefined();
    expect(holidayProfileForDate(profiles, '2026-03-31')?.region).toBe('BE');
    expect(holidayProfileForDate(profiles, '2026-04-01')?.region).toBe('BY');
    expect(holidayProfileForDate(profiles, '2026-07-01')?.region).toBeNull();
    expect(JSON.stringify(profiles)).toBe(copy);
  });
  it('handles absent profiles, future profiles, region-null disablement, and legacy snapshots', () => {
    expect(holidayForDate({}, '2026-01-01')).toBeNull();
    expect(holidayForDate({ holidayProfiles: [profile('BY', '2027-01-01')] }, '2026-01-01')).toBeNull();
    expect(holidayForDate({ holidayProfiles: [profile('BE'), profile(null, '2026-01-01')] }, '2026-01-01')).toBeNull();
    expect(holiday('1989-12-25')).toBeNull();
  });
  it('gives exclusion and addition overrides precedence over all automatic behavior', () => {
    const state = { holidayProfiles: [profile('BY')], holidayOverrides: [
      { date: '2026-01-06', name: null }, { date: '2026-08-15', name: 'Mariä Himmelfahrt (local)' },
      { date: '2026-12-25', name: 'Personal closure' }, { date: '1980-01-02', name: 'Historic closure' },
    ] };
    expect(holidayForDate(state, '2026-01-06')).toBeNull();
    expect(holidayForDate(state, '2026-08-15')).toEqual({ date: '2026-08-15', name: 'Mariä Himmelfahrt (local)',
      nameEn: 'Mariä Himmelfahrt (local)', source: 'manual' });
    expect(holidayForDate(state, '2026-12-25')?.source).toBe('manual');
    expect(holidayForDate(state, '1980-01-02')?.name).toBe('Historic closure');
    expect(holidayForDate({ holidayProfiles: [profile(null)], holidayOverrides: [{ date: '2026-01-02', name: 'Local' }] },
      '2026-01-02')?.name).toBe('Local');
    expect(holidayForDate({ holidayOverrides: [{ date: '2026-01-02', name: 'Local' }] }, '2026-01-02')?.source).toBe('manual');
  });
  it('keeps DST-boundary dates as calendar dates without consulting an instant or time zone', () => {
    expect(holiday('2024-03-31', 'BB')).toEqual({ date: '2024-03-31', name: 'Ostersonntag', nameEn: 'Easter Sunday', source: 'regional' });
    expect(holiday('2021-10-31', 'SN')).toEqual({ date: '2021-10-31', name: 'Reformationstag', nameEn: 'Reformation Day', source: 'regional' });
  });
});
