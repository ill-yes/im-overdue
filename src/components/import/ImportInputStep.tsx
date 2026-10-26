import { ArrowLeft, Download, FileUp, Upload } from 'lucide-react';
import exampleJson from '../../../examples/activities.json?raw';
import exampleCsv from '../../../examples/activities.csv?raw';
import { downloadBlob } from '../../download';
import type { ImportFlowController } from './useImportFlow';
import { useMessages } from '../../i18n';
import { importMessages } from '../../locales/import';

function downloadExample(format: 'json' | 'csv'): void {
  const content = format === 'json' ? exampleJson : exampleCsv;
  const blob = new Blob([content], {
    type: format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8',
  });
  downloadBlob(blob, `im-overdue-beispiel.${format}`);
}

export function ImportInputStep({ flow }: { flow: ImportFlowController }) {
  const { t, text } = useMessages(importMessages);
  const {
    heading, inputMode, isBusy, chooseInputMode, dragging, setDragging, drop,
    fileName, fileChange, reading, pasteFormat, pasteText, changePasteFormat,
    changePasteText, error, leave, onBack, onClose, runAnalysis, selectedText, previewing,
  } = flow;
  return (
    <section aria-label={t('inputSection')}>
      <h3 className="imp-step-title" tabIndex={-1} ref={heading} data-dialog-autofocus>
        {t('inputTitle')}
      </h3>
      <p className="muted small">
        {t('inputDescription')}
      </p>
      <div className="imp-input-modes" aria-label={t('inputMode')}>
        <button type="button" className={inputMode === 'file' ? 'selected' : ''} aria-pressed={inputMode === 'file'} onClick={() => chooseInputMode('file')} disabled={isBusy}><FileUp size={15} /> {t('chooseFile')}</button>
        <button type="button" className={inputMode === 'paste' ? 'selected' : ''} aria-pressed={inputMode === 'paste'} onClick={() => chooseInputMode('paste')} disabled={isBusy}>{t('pasteData')}</button>
      </div>
      {inputMode === 'file' && <label
        className={`file-drop imp-file ${dragging ? 'imp-dragging' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={drop}
      >
        <FileUp size={21} />
        <span>
          <strong>{fileName || t('dropFile')}</strong>
          <small>{t('limits')}</small>
        </span>
        <input
          type="file"
          accept=".json,.csv,application/json,text/csv"
          disabled={isBusy}
          onChange={fileChange}
        />
      </label>}
      {reading && (
        <p role="status" className="muted small">
          {t('reading')}
        </p>
      )}
      <div className="imp-example">
        <span>{t('viewFormat')}</span>
        <button type="button" onClick={() => downloadExample('json')}>
          <Download size={13} /> {t('jsonExample')}
        </button>
        <button type="button" onClick={() => downloadExample('csv')}>
          <Download size={13} /> {t('csvExample')}
        </button>
      </div>
      {inputMode === 'paste' && <div className="import-input-grid imp-paste-input">
        <label className="field">
          {t('format')}
          <select
            value={pasteFormat}
            disabled={isBusy}
            onChange={(e) => changePasteFormat(e.target.value as 'json' | 'csv')}
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <label className="field grow">
          {t('pasteData')}
          <textarea
            rows={5}
            value={pasteText}
            disabled={isBusy}
            onChange={(e) => changePasteText(e.target.value)}
            placeholder={
              pasteFormat === 'json'
                ? '{"schemaVersion":1,"activities":[]}'
                : 'source,id,start,end,title,url'
            }
          />
        </label>
      </div>}
      {error && (
        <p className="form-error" role="alert">
          {text(error)}
        </p>
      )}
      <div className="dialog-actions imp-footer">
        <button className="button secondary" type="button" onClick={() => leave(onBack ?? onClose)}>
          {onBack ? <><ArrowLeft size={15} /> {t('backToSource')}</> : t('close')}
        </button>
        <button
          className="button primary"
          type="button"
          onClick={runAnalysis}
          disabled={isBusy || !selectedText.trim()}
        >
          <Upload size={15} /> {previewing ? t('checking') : t('checkFile')}
        </button>
      </div>
    </section>
  );
}
