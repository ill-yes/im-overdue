import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { ImportEvidenceSummary } from './ImportEvidenceSummary';
import type { ImportFlowController } from './useImportFlow';
import { useMessages } from '../../i18n';
import { importMessages } from '../../locales/import';

export function ImportResultStep({ flow }: { flow: ImportFlowController }) {
  const { t, locale } = useMessages(importMessages);
  const number = (value: number) => value.toLocaleString(locale);
  const {
    heading, preview, period, timezone, sources, sourceNames, hiddenSources,
    onClose, onBack, onOpenPeriod,
  } = flow;
  if (!preview) return null;
  return (
    <section className="imp-result" aria-label={t('resultSection')}>
      <h3 className="imp-step-title" tabIndex={-1} ref={heading}>
        {preview.counts.new + preview.counts.updated === 0 ? t('alreadyPresent') : t('completed')}
      </h3>
      <div className="imp-result-mark">
        <Check size={22} />
      </div>
      <p>
        {preview.counts.new + preview.counts.updated === 0
          ? t('noopDescription', { unchanged: number(preview.counts.unchanged) })
          : t('resultDescription', { added: number(preview.counts.new), updated: number(preview.counts.updated), unchanged: number(preview.counts.unchanged) })}
      </p>
      <ImportEvidenceSummary
        period={period}
        timezone={timezone}
        sources={sources}
        sourceNames={sourceNames}
        emptyPeriodLabel="—"
      />
      {hiddenSources.length > 0 && (
        <p className="imp-filter-note">
          {t(hiddenSources.length === 1 ? 'hiddenResultOne' : 'hiddenResultMany', { sources: hiddenSources.map(([source]) => sourceNames[source]).join(', ') })}
        </p>
      )}
      <div className="dialog-actions imp-footer">
        <button className="button secondary" type="button" onClick={onClose}>
          {t('close')}
        </button>
        {onBack && <button className="button secondary" type="button" onClick={onBack}>
          <ArrowLeft size={15} /> {t('backToDataSource')}
        </button>}
        {period && (
          <button
            className="button primary"
            type="button"
            onClick={() => onOpenPeriod(period.openDate)}
          >
            {t('openPeriod')} <ArrowRight size={15} />
          </button>
        )}
      </div>
    </section>
  );
}
