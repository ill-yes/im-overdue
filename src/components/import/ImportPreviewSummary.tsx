import type { ImportPreview, Source } from '../../../shared/types.js';
import { sourceLabel } from '../../format';
import { ImportEvidenceSummary } from './ImportEvidenceSummary';
import type { PreviewPeriod, SourceCount } from './preview-model';
import { useMessages } from '../../i18n';
import { importMessages } from '../../locales/import';

export function ImportPreviewSummary({
  preview,
  period,
  previewZone,
  sources,
  hiddenSources,
  sourceNames = {},
}: {
  preview: ImportPreview;
  period: PreviewPeriod | null;
  previewZone: string;
  sources: SourceCount[];
  hiddenSources: SourceCount[];
  sourceNames?: Partial<Record<Source, string>>;
}) {
  const { t, text, locale } = useMessages(importMessages);
  const number = (value: number) => value.toLocaleString(locale);
  return (
    <>
      <div className="preview-stats">
        <span>
          <b>{number(preview.counts.new)}</b> {t('newCount')}
        </span>
        <span>
          <b>{number(preview.counts.updated)}</b> {t('updatedCount')}
        </span>
        <span>
          <b>{number(preview.counts.unchanged)}</b> {t('unchangedCount')}
        </span>
        <span>
          <b>{number(preview.counts.duplicates)}</b> {t('duplicates')}
        </span>
        <span className={preview.errors.length ? 'error-count' : ''}>
          <b>{number(preview.errors.length)}</b> {t('errors')}
        </span>
      </div>
      <ImportEvidenceSummary
        period={period}
        timezone={previewZone}
        sources={sources}
        sourceNames={sourceNames}
        emptyPeriodLabel={t('noValid')}
      />
      {hiddenSources.length > 0 && (
        <p className="imp-filter-note">
          {t(hiddenSources.length === 1 ? 'hiddenPreviewOne' : 'hiddenPreviewMany', { sources: hiddenSources.map(([source]) => sourceNames[source] ?? sourceLabel(source)).join(', ') })}
        </p>
      )}
      {preview.errors.length > 0 && (
        <div className="preview-errors" role="alert">
          <strong>{t('blocked')}</strong>
          <ul>
            {preview.errors.slice(0, 20).map((entry, i) => (
              <li key={i}>
                {entry.row ? t('errorRow', { row: number(entry.row) }) : ''}
                {text(entry)}
              </li>
            ))}
          </ul>
          {preview.errors.length > 20 && <p>{t('moreErrors', { count: number(preview.errors.length - 20) })}</p>}
        </div>
      )}
    </>
  );
}
