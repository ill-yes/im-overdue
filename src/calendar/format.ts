import { getLanguage, languageLocale, type Language } from '../i18n.js';

function dynamicDateFormat(options: Intl.DateTimeFormatOptions) {
  const formatters = {
    en: new Intl.DateTimeFormat(languageLocale('en'), { ...options, timeZone: 'UTC' }),
    de: new Intl.DateTimeFormat(languageLocale('de'), { ...options, timeZone: 'UTC' }),
  };
  return { format: (date: Date | number, language: Language = getLanguage()) => formatters[language].format(date) };
}

// Keep the existing .format API while resolving the current language on every render.
export const weekday = dynamicDateFormat({ weekday: 'short' });
export const fullDate = dynamicDateFormat({ day: '2-digit', month: '2-digit' });
export const shortDate = dynamicDateFormat({ day: 'numeric', month: 'short', year: 'numeric' });

export function durationLabel(minutes: number) {
  const absolute = Math.round(minutes);
  return `${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')} h`;
}

export function dateObj(date: string) {
  return new Date(`${date}T12:00:00Z`);
}
