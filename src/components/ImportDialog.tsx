import { useRef } from 'react';
import { Modal } from './Modal';
import { ImportInputStep } from './import/ImportInputStep';
import { ImportAssignmentStep } from './import/ImportAssignmentStep';
import { ImportPreviewStep } from './import/ImportPreviewStep';
import { ImportResultStep } from './import/ImportResultStep';
import { useImportFlow } from './import/useImportFlow';
import type { ImportFlowProps } from './import/types';
import { useMessages } from '../i18n';
import { importMessages } from '../locales/import';
import './import-dialog.css';

export type { ImportFlowProps } from './import/types';

export function ImportDialog(props: ImportFlowProps) {
  const { t } = useMessages(importMessages);
  const guard = useRef<(() => boolean) | null>(null);
  const close = () => { if (!guard.current || guard.current()) props.onClose(); };
  return <Modal title={t('title')} onClose={close} className="modal-wide imp-dialog">
    <ImportFlow {...props} onClose={close} onGuardChange={(next) => { guard.current = next; }} />
  </Modal>;
}

export function ImportFlow(props: ImportFlowProps) {
  const flow = useImportFlow(props);
  const { t } = useMessages(importMessages);
  const { step, analysis, preview } = flow;
  return (
    <div className="dialog-content imp-content">
      <ol className="imp-steps" aria-label={t('steps')}>
        <li className={step === 'input' ? 'current' : ''}>{t('stepFile')}</li>
        <li className={step === 'assign' ? 'current' : ''}>{t('stepAssign')}</li>
        <li className={step === 'preview' ? 'current' : ''}>{t('stepPreviewFour')}</li>
        <li className={step === 'result' ? 'current' : ''}>{t('stepResultFour')}</li>
      </ol>
      {step === 'input' && <ImportInputStep flow={flow} />}
      {step === 'assign' && analysis && <ImportAssignmentStep flow={flow} />}
      {step === 'preview' && preview && <ImportPreviewStep flow={flow} />}
      {step === 'result' && preview && <ImportResultStep flow={flow} />}
    </div>
  );
}
