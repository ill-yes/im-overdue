import { useMessages } from '../i18n';
import { workflows } from '../locales/workflows';
import { useRef, useState } from 'react';
import type { AppState, ReusableInput } from '../../shared/types.js';
import { Modal } from './Modal';
import { ReusePicker, type ReuseEditorView, type ReusePickerHandle } from './ReusePicker';

export function ReuseDialog({ state, date, busy, requestError, onSelect, onSaveTemplate, onDeleteTemplate, onClose }: {
  state: AppState;
  date: string;
  busy: boolean;
  requestError: string;
  onSelect: (input: ReusableInput) => void;
  onSaveTemplate: (input: ReusableInput, id?: string) => Promise<boolean>;
  onDeleteTemplate: (id: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useMessages(workflows);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const pickerRef = useRef<ReusePickerHandle>(null);
  const [editorView, setEditorView] = useState<ReuseEditorView>(null);
  const close = () => {
    if (pendingRef.current) return;
    if (pickerRef.current?.canClose() !== false) onClose();
  };
  return (
    <Modal title={editorView === 'new' ? t('newTemplate') : editorView === 'edit' ? t('editTemplate') : t('quickPick')} onClose={close} onEscape={() => pickerRef.current?.back()} closeDisabled={pending} className="reuse-dialog workflow-modal">
        <ReusePicker
          ref={pickerRef}
          targetDate={date}
          requestError={requestError}
          templates={state.templates}
          recentEntries={state.recentEntries}
          blocks={state.blocks}
          zone={state.settings.timezone}
          hasUndo={Boolean(state.undo)}
          busy={busy}
          onSelect={onSelect}
          onSaveTemplate={onSaveTemplate}
          onDeleteTemplate={onDeleteTemplate}
          onPendingChange={(value) => { pendingRef.current = value; setPending(value); }}
          onEditorChange={setEditorView}
          onBack={close}
        />
    </Modal>
  );
}
