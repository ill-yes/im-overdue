import { useMessages } from '../i18n';
import { workflows } from '../locales/workflows';
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import type { AppState, ReusableInput } from '../../shared/types.js';
import { longDate } from '../format';
import { ReusePicker, type ReuseEditorView, type ReusePickerHandle } from './ReusePicker';
import './templates-page.css';

export function TemplatesPage({
  state, date, busy, requestError, onSelect, onSaveTemplate, onDeleteTemplate, onBack,
  onLeaveGuardChange, active = true,
}: {
  state: AppState;
  date: string;
  busy: boolean;
  requestError: string;
  onSelect: (input: ReusableInput) => void;
  onSaveTemplate: (input: ReusableInput, id?: string) => Promise<boolean>;
  onDeleteTemplate: (id: string) => Promise<boolean>;
  onBack: () => void;
  onLeaveGuardChange?: (guard: (() => boolean) | null) => void;
  active?: boolean;
}) {
  const { t } = useMessages(workflows);
  const pickerRef = useRef<ReusePickerHandle>(null);
  const [pending, setPending] = useState(false);
  const [editorView, setEditorView] = useState<ReuseEditorView>(null);
  const prepareLeave = useCallback(() => pickerRef.current?.prepareLeave() ?? true, []);
  useLayoutEffect(() => {
    if (!active) return;
    onLeaveGuardChange?.(prepareLeave);
    return () => onLeaveGuardChange?.(null);
  }, [active, onLeaveGuardChange, prepareLeave]);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (active && event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      pickerRef.current?.back();
    }
  };

  return <section className="templates-page" hidden={!active} aria-labelledby="templates-page-title" onKeyDown={handleKeyDown}>
    <header className="templates-page-heading">
      <div>
        <h1 id="templates-page-title">{t('templates')}</h1>
        <p>{t('templatesSubtitle')}</p>
      </div>
      <button type="button" className="button secondary" onClick={onBack} disabled={pending}><ArrowLeft size={15} />{t('backCalendar')}</button>
    </header>
    <div className="templates-workspace">
      <div className="templates-target"><CalendarDays size={18} aria-hidden="true" /><p>{t('workDate')} <strong>{longDate(date)}</strong></p></div>
      {editorView && <h2 className="templates-editor-title">{editorView === 'new' ? t('newTemplate') : t('editTemplate')}</h2>}
      <ReusePicker
        ref={pickerRef}
        presentation="page"
        active={active}
        templates={state.templates}
        recentEntries={state.recentEntries}
        blocks={state.blocks}
        zone={state.settings.timezone}
        hasUndo={Boolean(state.undo)}
        busy={busy}
        requestError={requestError}
        onSelect={onSelect}
        onSaveTemplate={onSaveTemplate}
        onDeleteTemplate={onDeleteTemplate}
        onBack={onBack}
        onPendingChange={setPending}
        onEditorChange={setEditorView}
      />
    </div>
  </section>;
}
