import { ArrowLeft, ArrowRight } from 'lucide-react';
import { sourceLabel } from '../../format';
import { assignmentsComplete } from './assignments';
import type { ImportFlowController } from './useImportFlow';
import { useMessages } from '../../i18n';
import { importMessages } from '../../locales/import';

export function ImportAssignmentStep({ flow }: { flow: ImportFlowController }) {
  const { t, text, locale } = useMessages(importMessages);
  const number = (value: number) => value.toLocaleString(locale);
  const {
    heading, analysis, analyzedFileName, availableSources, assignments, isBusy,
    creatingType, changeAssignment, beginSourceDraft, sourceName, creating,
    setSourceName, cancelSourceDraft, createSource, error, editInput, runPreview, previewing,
  } = flow;
  if (!analysis) return null;
  return (
    <section aria-label={t('assignmentSection')}>
      <h3 className="imp-step-title" tabIndex={-1} ref={heading}>{t('assignTitle')}</h3>
      <p className="muted small">{t('assignmentDescription', { file: analyzedFileName || t('pastedData'), count: number(analysis.total) })}</p>
      <div className="imp-assignments">
        {analysis.sources.map(({ source, count }) => {
          const targets = availableSources.filter((entry) => entry.type === source);
          return <div className="imp-assignment" key={source}>
            <div className="imp-assignment-label"><strong>{sourceLabel(source)}</strong><small>{t('activityCount', { count: number(count) })}</small></div>
            <label className="field">{t('targetSource')}
              <select value={targets.some((entry) => entry.id === assignments[source]) ? assignments[source] : ''} disabled={isBusy || creatingType !== null} onChange={(event) => changeAssignment(source, event.target.value)}>
                <option value="">{targets.length ? t('chooseSource') : t('noMatchingSource')}</option>
                {targets.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
            <button className="imp-create-link" type="button" disabled={isBusy || creatingType !== null} onClick={() => beginSourceDraft(source)}>{t('newSource')}</button>
            {creatingType === source && <div className="imp-create-source">
              <label className="field">{t('newSourceName')}<input autoFocus maxLength={160} value={sourceName} disabled={creating} onChange={(event) => setSourceName(event.target.value)} placeholder={t('sourceNameExample', { source: sourceLabel(source) })} /></label>
              <p className="muted small">{t('sourceTypeDescription', { source: sourceLabel(source) })}</p>
              <div className="dialog-actions">
                <button className="button secondary" type="button" disabled={creating} onClick={cancelSourceDraft}>{t('cancel')}</button>
                <button className="button primary" type="button" disabled={isBusy || !sourceName.trim()} onClick={createSource}>{creating ? t('creatingSource') : t('createSource')}</button>
              </div>
            </div>}
          </div>;
        })}
      </div>
      {analysis.sources.length === 0 && !analysis.errors.length && <p className="imp-empty">{t('noActivities')}</p>}
      {analysis.duplicates > 0 && <p className="muted small">{t('mergedDuplicates', { count: number(analysis.duplicates) })}</p>}
      {analysis.errors.length > 0 && <div className="preview-errors" role="alert"><strong>{t('correctFile')}</strong><ul>{analysis.errors.slice(0, 20).map((entry, i) => <li key={i}>{entry.row ? t('errorRow', { row: number(entry.row) }) : ''}{text(entry)}</li>)}</ul>{analysis.errors.length > 20 && <p>{t('moreErrors', { count: number(analysis.errors.length - 20) })}</p>}</div>}
      {error && <p className="form-error" role="alert">{text(error)}</p>}
      <div className="dialog-actions imp-footer">
        <button className="button secondary push-left" type="button" disabled={isBusy} onClick={editInput}><ArrowLeft size={15} /> {t('editInput')}</button>
        <button className="button primary" type="button" disabled={isBusy || creatingType !== null || !assignmentsComplete(analysis, assignments, availableSources)} onClick={runPreview}>{previewing ? t('checking') : t('checkPreview')} <ArrowRight size={15} /></button>
      </div>
    </section>
  );
}
