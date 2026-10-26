export type Language = 'en' | 'de';
export type MessageParams = Readonly<Record<string, string | number>>;
export type Messages = Readonly<Record<string, Readonly<Record<Language, string>>>>;
export interface LocalizedMessage {
  catalog: Messages;
  key: string;
  params?: MessageParams;
}
export interface MessageProblem {
  message: string;
  messageKey?: string;
  messageParams?: MessageParams;
}
export type TextValue = string | LocalizedMessage | MessageProblem | Error;

export const languageLocale = (language: Language): 'en-GB' | 'de-DE' => language === 'de' ? 'de-DE' : 'en-GB';

export function translate<C extends Messages>(catalog: C, key: keyof C & string, params: MessageParams = {}, language: Language = 'en'): string {
  const template = catalog[key]?.[language] ?? catalog[key]?.en ?? key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}

export function localized<C extends Messages>(catalog: C, key: keyof C & string, params?: MessageParams): LocalizedMessage {
  return { catalog, key, params };
}
