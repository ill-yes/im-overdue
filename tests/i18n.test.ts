import { describe, expect, it, vi } from 'vitest';
import { languageLocale, localized, translate, type Messages } from '../shared/i18n.js';
import { initialLanguage, LANGUAGE_STORAGE_KEY, setLanguage, getLanguage, text } from '../src/i18n.js';
import { serverMessages } from '../shared/server-messages.js';
import { timesheetMessages } from '../shared/timesheet-messages.js';

const modules = import.meta.glob('../src/locales/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
const catalogs = Object.entries({ ...modules, server: { serverMessages, timesheetMessages } }).flatMap(([path, exports]) =>
  Object.entries(exports).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).length > 0 && Object.values(value).every(entry => entry && typeof entry === 'object' && ('en' in entry || 'de' in entry)))
    .map(([name, value]) => ({ name: `${path}:${name}`, catalog: value as Messages })),
);
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe('English-first language preference', () => {
  it('uses English for missing or invalid preferences and does not consult browser locale', () => {
    vi.stubGlobal('navigator', { language: 'de-DE', languages: ['de-DE'] });
    try {
      for (const value of [null, '', 'fr', 'de-DE', 'EN', 'en']) {
        const storage = { getItem: vi.fn(() => value) };
        expect(initialLanguage(storage)).toBe('en');
        expect(storage.getItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY);
      }
      expect(initialLanguage()).toBe('en');
      expect(initialLanguage({ getItem: () => 'de' })).toBe('de');
    } finally { vi.unstubAllGlobals(); }
  });

  it('survives blocked storage reads and writes while retaining an in-memory choice', () => {
    const failure = () => { throw new DOMException('Storage disabled', 'SecurityError'); };
    expect(initialLanguage({ getItem: failure })).toBe('en');
    vi.stubGlobal('window', { localStorage: { setItem: failure } });
    try {
      expect(() => setLanguage('de')).not.toThrow();
      expect(getLanguage()).toBe('de');
      setLanguage('en');
      expect(getLanguage()).toBe('en');
    } finally { vi.unstubAllGlobals(); }
  });

  it('uses the declared date and number locales', () => {
    expect(languageLocale('en')).toBe('en-GB');
    expect(languageLocale('de')).toBe('de-DE');
  });
});

describe('complete bilingual message catalogs', () => {
  it('discovers frontend and server catalogs', () => { expect(catalogs.length).toBeGreaterThanOrEqual(2); });
  for (const { name, catalog } of catalogs) {
    it(`${name} has matching, non-empty translations and interpolation parameters`, () => {
      for (const [key, entry] of Object.entries(catalog)) {
        expect(Object.keys(entry).sort(), `${name}:${key}`).toEqual(['de', 'en']);
        expect(entry.en.trim(), `${name}:${key}:en`).not.toBe('');
        expect(entry.de.trim(), `${name}:${key}:de`).not.toBe('');
        expect(placeholders(entry.en), `${name}:${key}`).toEqual(placeholders(entry.de));
        const params = Object.fromEntries(placeholders(entry.en).map(parameter => [parameter, 'example-value']));
        for (const language of ['en', 'de'] as const) {
          expect(translate(catalog, key, params, language), `${name}:${key}:${language}`).not.toMatch(/\{\w+\}/);
        }
      }
    });
  }

  it('keeps visible descriptors translatable without changing legacy messages or user text', () => {
    const problem = { message: 'The original legacy response', messageKey: 'error.import.commit', messageParams: { count: 3 } };
    expect(text(problem, 'en')).toBe('The import contains 3 errors. Please check the preview.');
    expect(text(problem, 'de')).toBe('Der Import enthält 3 Fehler. Bitte die Vorschau prüfen.');
    expect(problem.message).toBe('The original legacy response');
    expect(text({ message: 'User-provided text', messageKey: 'unknown.future.key' }, 'de')).toBe('User-provided text');
    expect(text('User-provided text', 'en')).toBe('User-provided text');
    const catalog = { message: { en: '{count} items', de: '{count} Einträge' } } satisfies Messages;
    const value = localized(catalog, 'message', { count: 2 });
    expect(text(value, 'en')).toBe('2 items');
    expect(text(value, 'de')).toBe('2 Einträge');
  });
});
