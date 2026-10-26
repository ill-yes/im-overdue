import type { Source } from '../../../shared/types.js';
import { formatActivityDateTime, sourceLabel } from '../../format';
import type { PreviewPeriod, SourceCount } from './preview-model';
import { languageLocale, translate, useMessages, type Language } from '../../i18n';
import { importMessages } from '../../locales/import';

export function ImportEvidenceSummary({
  period,
  timezone,
  sources,
  sourceNames = {},
  emptyPeriodLabel,
  language: requestedLanguage,
}: {
  period: PreviewPeriod | null;
  timezone: string;
  sources: SourceCount[];
  sourceNames?: Partial<Record<Source, string>>;
  emptyPeriodLabel: string;
  language?: Language;
}) {
  const { language: currentLanguage } = useMessages(importMessages);
  const language = requestedLanguage ?? currentLanguage;
  const locale = languageLocale(language);
  const t = (key: keyof typeof importMessages) => translate(importMessages, key, {}, language);
  return (
    <div className="imp-evidence">
      <div>
        <small>{t('evidencePeriod')}</small>
        <strong>
          {period
            ? `${formatActivityDateTime(period.first, timezone, language)} – ${formatActivityDateTime(period.last, timezone, language)}`
            : emptyPeriodLabel}
        </strong>
      </div>
      <div>
        <small>{t('sources')}</small>
        <strong>
          {sources.length
            ? sources.map(([source, count]) => `${sourceNames[source] ?? sourceLabel(source, language)} ${count.toLocaleString(locale)}`).join(' · ')
            : '—'}
        </strong>
      </div>
    </div>
  );
}
