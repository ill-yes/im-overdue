import { Temporal } from '../shared/time.js';
import type { Source } from '../shared/types.js';

import { getLanguage, languageLocale, type Language } from './i18n.js';

const dateFormatters = (language: Language) => ({
  short: new Intl.DateTimeFormat(languageLocale(language), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }),
  long: new Intl.DateTimeFormat(languageLocale(language), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
  month: new Intl.DateTimeFormat(languageLocale(language), { month: 'long', year: 'numeric', timeZone: 'UTC' }),
});
const formats = { en: dateFormatters('en'), de: dateFormatters('de') };
const SOURCE_LABELS: Record<Source, Record<Language, string>> = {
  google_calendar: { en: 'Calendar', de: 'Kalender' },
  slack: { en: 'Slack', de: 'Slack' },
  github: { en: 'GitHub', de: 'GitHub' },
  other: { en: 'Other', de: 'Sonstige' },
};

export function duration(minutes: number, signed = false): string {
  const seconds = Math.round(Math.abs(minutes) * 60);
  const hours = Math.floor(seconds / 3600);
  const rest = Math.floor(seconds / 60) % 60;
  const remainder = seconds % 60;
  const body = remainder
    ? `${hours}:${String(rest).padStart(2, '0')}:${String(remainder).padStart(2, '0')} h`
    : rest === 0 ? `${hours} h` : `${hours}:${String(rest).padStart(2, '0')} h`;
  return `${signed ? (minutes > 0 ? '+' : minutes < 0 ? '−' : '±') : ''}${body}`;
}

export function shortDate(date: string, language: Language = getLanguage()): string {
  return formats[language].short.format(Temporal.PlainDate.from(date).toZonedDateTime('UTC').epochMilliseconds);
}

export function longDate(date: string, language: Language = getLanguage()): string {
  return formats[language].long.format(Temporal.PlainDate.from(date).toZonedDateTime('UTC').epochMilliseconds);
}

export function formatActivityDateTime(instant: string, zone: string, language: Language = getLanguage()): string {
  const date = Temporal.Instant.from(instant).toZonedDateTimeISO(zone);
  const day = shortDate(date.toPlainDate().toString(), language);
  const hasSeconds =
    date.second !== 0 || date.millisecond !== 0 || date.microsecond !== 0 || date.nanosecond !== 0;
  const time = date.toPlainTime().toString(hasSeconds ? {} : { smallestUnit: 'minute' });
  return `${day} · ${time} ${date.offset}`;
}

export function weekLabel(week: string, language: Language = getLanguage()): string {
  const monday = Temporal.PlainDate.from(week);
  const sunday = monday.add({ days: 6 });
  return `${shortDate(week, language)} – ${shortDate(sunday.toString(), language)}`;
}

export function sourceLabel(source: Source, language: Language = getLanguage()): string {
  return SOURCE_LABELS[source][language];
}

export function periodLabel(anchor: string, kind: 'month' | 'quarter' | 'year', language: Language = getLanguage()): string {
  const d = Temporal.PlainDate.from(anchor);
  if (kind === 'year') return `${d.year}`;
  if (kind === 'quarter') {
    const quarter = Math.floor((d.month - 1) / 3) + 1;
    return language === 'de' ? `${quarter}. Quartal ${d.year}` : `Q${quarter} ${d.year}`;
  }
  return formats[language].month.format(d.toZonedDateTime('UTC').epochMilliseconds);
}
