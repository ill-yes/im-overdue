import { Temporal } from '@js-temporal/polyfill';
import type { AppState, GermanState, HolidayProfile, ResolvedHoliday } from './types.js';

const easternStates: readonly GermanState[] = ['BB', 'MV', 'SN', 'ST', 'TH'];
// Before these state laws, Reformation Day depended on religious territories,
// not merely the Land; those local cases require an explicit override.
const statewideReformationFrom: Partial<Record<GermanState, number>> = {
  BB: 1991, MV: 1992, SN: 1993, ST: 1992, TH: 1995,
};
const sundayHolidaysThrough: Partial<Record<GermanState, number>> = {
  MV: 1992, SN: 1992, ST: 1991, TH: 1994,
};
const reformationStates: readonly GermanState[] = ['HB', 'HH', 'NI', 'SH'];
const corpusChristiStates: readonly GermanState[] = ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'];
const allSaintsStates: readonly GermanState[] = ['BW', 'BY', 'NW', 'RP', 'SL'];

/** Gregorian Easter, calculated as a calendar date without an instant/time zone. */
function easterSunday(year: number): Temporal.PlainDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return Temporal.PlainDate.from({ year, month: Math.floor(n / 31), day: n % 31 + 1 });
}

/** Version 1 is a fixed ruleset. Future rule changes require a new version. */
export function regionalHolidays(year: number, region: GermanState, ruleVersion: 1 = 1): ResolvedHoliday[] {
  if (ruleVersion !== 1) throw new RangeError('Unsupported holiday rule version.');
  if (!Number.isInteger(year)) throw new RangeError('Holiday year must be an integer.');
  if (year < 1990) return [];
  const easter = easterSunday(year);
  const holidays = new Map<string, ResolvedHoliday>();
  const add = (date: Temporal.PlainDate, name: string, nameEn: string) => {
    const key = date.toString();
    const existing = holidays.get(key);
    holidays.set(key, { date: key, name: existing ? `${existing.name} / ${name}` : name,
      nameEn: existing ? `${existing.nameEn} / ${nameEn}` : nameEn, source: 'regional' });
  };
  const fixed = (month: number, day: number, name: string, nameEn: string) =>
    add(Temporal.PlainDate.from({ year, month, day }), name, nameEn);
  const movable = (days: number, name: string, nameEn: string) => add(easter.add({ days }), name, nameEn);

  fixed(1, 1, 'Neujahr', "New Year's Day");
  if (region === 'BW' || region === 'BY' || (region === 'ST' && year >= 1993)) {
    fixed(1, 6, 'Heilige Drei Könige', 'Epiphany');
  }
  if ((region === 'BE' && year >= 2019) || (region === 'MV' && year >= 2023)) {
    fixed(3, 8, 'Internationaler Frauentag', "International Women's Day");
  }
  movable(-2, 'Karfreitag', 'Good Friday');
  const sundayHolidays = region === 'BB' || year <= (sundayHolidaysThrough[region] ?? 0);
  // ST's May 1992 law postdates Easter. Its exact commencement relative to
  // Whit Sunday (7 June) is unverified: that one day needs a manual override.
  if (sundayHolidays || (region === 'ST' && year === 1992)) movable(0, 'Ostersonntag', 'Easter Sunday');
  movable(1, 'Ostermontag', 'Easter Monday');
  fixed(5, 1, 'Tag der Arbeit', 'Labour Day');
  movable(39, 'Christi Himmelfahrt', 'Ascension Day');
  if (sundayHolidays) movable(49, 'Pfingstsonntag', 'Whit Sunday');
  movable(50, 'Pfingstmontag', 'Whit Monday');
  if (corpusChristiStates.includes(region)) movable(60, 'Fronleichnam', 'Corpus Christi');
  if (year === 1990 && !easternStates.includes(region) && region !== 'BE') {
    fixed(6, 17, 'Tag der Deutschen Einheit', 'German Unity Day');
  }
  if (region === 'SL') fixed(8, 15, 'Mariä Himmelfahrt', 'Assumption Day');
  if (region === 'TH' && year >= 2019) fixed(9, 20, 'Weltkindertag', "World Children's Day");
  fixed(10, 3, 'Tag der Deutschen Einheit', 'German Unity Day');
  const reformationFrom = statewideReformationFrom[region];
  if ((reformationFrom !== undefined && year >= reformationFrom) ||
    (reformationStates.includes(region) && year >= 2018) || year === 2017) {
    fixed(10, 31, 'Reformationstag', 'Reformation Day');
  }
  if (allSaintsStates.includes(region)) fixed(11, 1, 'Allerheiligen', "All Saints' Day");
  if (region === 'SN' || year <= 1994) {
    const november23 = Temporal.PlainDate.from({ year, month: 11, day: 23 });
    const daysBefore = (november23.dayOfWeek - 3 + 7) % 7 || 7;
    add(november23.subtract({ days: daysBefore }), 'Buß- und Bettag', 'Day of Repentance and Prayer');
  }
  fixed(12, 25, '1. Weihnachtstag', 'Christmas Day');
  fixed(12, 26, '2. Weihnachtstag', 'Boxing Day');
  if (region === 'BE' && (year === 2020 || year === 2025)) {
    fixed(5, 8, 'Tag der Befreiung', 'Liberation Day');
  }
  if (region === 'BE' && year === 2028) {
    fixed(6, 17, '75. Jahrestag des Aufstandes vom 17. Juni 1953', '75th anniversary of the uprising of 17 June 1953');
  }
  return [...holidays.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Latest effective profile wins; input order is not changed. */
export function holidayProfileForDate(profiles: HolidayProfile[], date: string): HolidayProfile | undefined {
  const day = Temporal.PlainDate.from(date).toString();
  return profiles.reduce<HolidayProfile | undefined>((latest, profile) =>
    profile.effectiveFrom <= day && (!latest || profile.effectiveFrom >= latest.effectiveFrom) ? profile : latest, undefined);
}

// A calendar renders the same year many times. Cache only the immutable rules,
// not user profiles or overrides; return copies so callers cannot mutate it.
const calendarCache = new Map<string, Map<string, ResolvedHoliday>>();

/** This historical transition lacks a verified commencement date. Do not infer credit. */
export function holidayReviewRequired(state: Pick<AppState, 'holidayProfiles' | 'holidayOverrides'>, date: string): boolean {
  return date === '1992-06-07' && !state.holidayOverrides?.some(override => override.date === date)
    && holidayProfileForDate(state.holidayProfiles ?? [], date)?.region === 'ST';
}

export function holidayForDate(state: Pick<AppState, 'holidayProfiles' | 'holidayOverrides'>, date: string): ResolvedHoliday | null {
  const day = Temporal.PlainDate.from(date);
  const key = day.toString();
  const override = state.holidayOverrides?.find((item) => item.date === key);
  if (override) return override.name === null ? null : { date: key, name: override.name, nameEn: override.name, source: 'manual' };
  const profile = holidayProfileForDate(state.holidayProfiles ?? [], key);
  if (!profile?.region) return null;
  const cacheKey = `${profile.ruleVersion}/${profile.region}/${day.year}`;
  let calendar = calendarCache.get(cacheKey);
  if (!calendar) {
    calendar = new Map(regionalHolidays(day.year, profile.region, profile.ruleVersion).map(holiday => [holiday.date, holiday]));
    if (calendarCache.size >= 128) calendarCache.delete(calendarCache.keys().next().value!);
    calendarCache.set(cacheKey, calendar);
  }
  const holiday = calendar.get(key);
  return holiday ? { ...holiday } : null;
}
