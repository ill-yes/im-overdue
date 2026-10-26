import { ArrowLeft, ArrowRight } from 'lucide-react';
import { assignmentsComplete } from './assignments';
import { ImportPreviewRows } from './ImportPreviewRows';
import { ImportPreviewSummary } from './ImportPreviewSummary';
import type { ImportFlowController } from './useImportFlow';
import { useMessages } from '../../i18n';
import { importMessages } from '../../locales/import';

export function ImportPreviewStep({ flow }: { flow: ImportFlowController }) {
  const { t, text, locale } = useMessages(importMessages);
  const {
    heading, preview, selectedSource, previewZone, period, sources, hiddenSources,
    sourceNames, rows, page, expandedRow, setPage, setExpandedRow, availableSources,
    error, editAssignments, committing, canOpen, onOpenPeriod, setStep, commit,
    isBusy, timezone, analysis, assignments,
  } = flow;
  if (!preview) return null;
  return (
    <section className="preview" aria-label={t('previewSection')}>
      <h3 className="imp-step-title" tabIndex={-1} ref={heading}>
        {t('checkPreview')}
      </h3>
      <p className="muted small">
        {t('previewDescription', { source: selectedSource || t('pastedData'), count: preview.counts.total.toLocaleString(locale), timezone: previewZone })}
      </p>
      <ImportPreviewSummary
        preview={preview}
        period={period}
        previewZone={previewZone}
        sources={sources}
        hiddenSources={hiddenSources}
        sourceNames={sourceNames}
      />
      <ImportPreviewRows
        rows={rows}
        previewZone={previewZone}
        page={page}
        expandedRow={expandedRow}
        setPage={setPage}
        setExpandedRow={setExpandedRow}
        dataSources={availableSources}
      />
      {error && (
        <p className="form-error" role="alert">
          {text(error)}
        </p>
      )}
      <div className="dialog-actions imp-footer">
        <button
          className="button secondary push-left"
          type="button"
          onClick={editAssignments}
          disabled={committing}
        >
          <ArrowLeft size={15} /> {t('editAssignments')}
        </button>
        {canOpen && preview.counts.new + preview.counts.updated === 0 && (
          <button
            className="button secondary"
            type="button"
            onClick={() => onOpenPeriod(period!.openDate)}
          >
            {t('openPeriod')}
          </button>
        )}
        <button
          className="button primary"
          type="button"
          onClick={preview.counts.new + preview.counts.updated === 0 ? () => setStep('result') : commit}
          disabled={
            isBusy || preview.errors.length > 0 || previewZone !== timezone || !analysis || !assignmentsComplete(analysis, assignments, availableSources)
          }
        >
          {committing ? t('importing') : preview.counts.new + preview.counts.updated === 0 ? t('alreadyPresent') : t('confirmImport')} <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}
