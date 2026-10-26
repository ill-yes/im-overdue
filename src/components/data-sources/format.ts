import type { ImportCounts } from '../../../shared/types.js';
import { languageLocale, translate, type Language } from '../../../shared/i18n.js';
import { dataSourceMessages } from '../../locales/data-sources';

export function formatPackageCounts(counts: ImportCounts, language: Language = 'de'): string {
  const number = (value: number) => value.toLocaleString(languageLocale(language));
  return translate(dataSourceMessages, 'packageCounts', {
    total: number(counts.total), new: number(counts.new), updated: number(counts.updated),
    unchanged: number(counts.unchanged), duplicates: number(counts.duplicates),
  }, language);
}
