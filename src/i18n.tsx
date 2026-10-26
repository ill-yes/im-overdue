import { useSyncExternalStore, useEffect, type ReactNode } from 'react';
import { languageLocale, localized, translate, type Language, type Messages, type MessageParams, type TextValue } from '../shared/i18n.js';
import { serverMessages } from '../shared/server-messages.js';

export type { Language, Messages, MessageParams, TextValue } from '../shared/i18n.js';
export { localized, translate, languageLocale } from '../shared/i18n.js';
export const LANGUAGE_STORAGE_KEY = 'im-overdue-language';
const listeners = new Set<() => void>();
let currentLanguage: Language | undefined;

export function initialLanguage(storage?: Pick<Storage, 'getItem'>): Language {
  try { return storage?.getItem(LANGUAGE_STORAGE_KEY) === 'de' ? 'de' : 'en'; } catch { return 'en'; }
}
export function getLanguage(): Language {
  if (!currentLanguage) {
    let storage: Storage | undefined;
    try { storage = typeof window === 'undefined' ? undefined : window.localStorage; } catch { /* Storage can be blocked. */ }
    currentLanguage = initialLanguage(storage);
  }
  return currentLanguage;
}
export function setLanguage(language: Language) {
  if (language !== 'en' && language !== 'de') return;
  currentLanguage = language;
  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* Keep the in-memory preference usable. */ }
  listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useLanguage() { return useSyncExternalStore(subscribe, getLanguage, () => 'en' as const); }

export function text(value: TextValue | null | undefined, language: Language = getLanguage()): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if ('catalog' in value) return translate(value.catalog, value.key, value.params, language);
  if ('messageKey' in value && typeof value.messageKey === 'string' && Object.hasOwn(serverMessages, value.messageKey)) {
    return translate(serverMessages, value.messageKey as keyof typeof serverMessages, value.messageParams, language);
  }
  return value.message;
}
export function errorText(issue: unknown, fallback: TextValue): TextValue {
  return issue instanceof Error || (typeof issue === 'object' && issue !== null && 'message' in issue && typeof issue.message === 'string') ? issue as TextValue : fallback;
}
export function useMessages<C extends Messages>(catalog: C) {
  const language = useLanguage();
  return {
    language,
    locale: languageLocale(language),
    t: (key: keyof C & string, params?: MessageParams) => translate(catalog, key, params, language),
    m: (key: keyof C & string, params?: MessageParams) => localized(catalog, key, params),
    text: (value: TextValue | null | undefined) => text(value, language),
  };
}

const metadata = {
  title: { en: "I'm Overdue – Your time account", de: "I'm Overdue – Dein Zeitkonto" },
  description: { en: 'Your activities, working time and balance. Self-hosted and private.', de: 'Deine Aktivitäten, Arbeitszeit und dein Zeitkonto. Selbst gehostet und privat.' },
} satisfies Messages;
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { language, t } = useMessages(metadata);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t('title');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('description'));
  }, [language]);
  return children;
}
export function LanguageSelector() {
  const language = useLanguage();
  return <label className="language-selector"><span className="language-selector-label">Language / Sprache</span><select aria-label="Language / Sprache" value={language} onChange={event => setLanguage(event.target.value as Language)}><option value="en">English</option><option value="de">Deutsch</option></select></label>;
}
