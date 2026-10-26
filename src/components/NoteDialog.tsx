import { useMessages, errorText, type TextValue } from '../i18n';
import { workflows } from '../locales/workflows';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { NOTE_MAX_LENGTH } from '../../shared/notes.js';
import type { NoteScope } from '../../shared/types.js';
import { longDate, weekLabel } from '../format';
import { Modal } from './Modal';
import './note-dialog.css';

const canonicalText = (text: string) => (text.trim() ? text : '');

export function NoteDialog({
  scope,
  date,
  initialText,
  hasUndo,
  busy,
  requestError,
  onSave,
  onClose,
}: {
  scope: NoteScope;
  date: string;
  initialText: string;
  hasUndo: boolean;
  busy: boolean;
  requestError: string;
  onSave: (text: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t, m, text: renderText } = useMessages(workflows);
  // The parent keys each editing session. A state refresh must not replace this draft.
  const [originalText] = useState(() => canonicalText(initialText));
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<TextValue>('');
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const noteId = useId();
  const helpId = useId();
  const countId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const normalizedText = canonicalText(text);
  const changed = normalizedText !== originalText;
  const title = scope === 'day' ? t('dayNote') : t('weekNote');
  const period = scope === 'day' ? longDate(date) : weekLabel(date);

  const close = () => {
    if (pendingRef.current) return;
    if (!changed || window.confirm(t('confirmDiscardChanges'))) {
      onClose();
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current || busy || !changed || text.length > NOTE_MAX_LENGTH) return;
    pendingRef.current = true;
    setPending(true);
    setLocalError('');
    try {
      // The parent owns success feedback and closes only the session that submitted.
      await onSave(normalizedText);
    } catch (issue) {
      if (mounted.current) {
        setLocalError(errorText(issue, m('saveNoteFailed')));
      }
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  };

  return (
    <Modal title={title} onClose={close} className="note-dialog" closeDisabled={pending}>
      <form className="dialog-content note-dialog-content" onSubmit={submit}>
        <p className="note-period">{period}</p>
        <p className="muted small note-explanation" id={helpId}>{t('noteHelp')}</p>
        <label className="field note-field" htmlFor={noteId}>{t('note')}</label>
        <textarea
          id={noteId}
          className="note-textarea"
          rows={8}
          maxLength={NOTE_MAX_LENGTH}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('notePlaceholder')}
          aria-describedby={`${helpId} ${countId}`}
          disabled={pending}
        />
        <div className="note-meta">
          <span className="muted small">{t('noteClear')}</span>
          <span className="muted small note-counter" id={countId}>
            {text.length} / {NOTE_MAX_LENGTH}
          </span>
        </div>
        {hasUndo && changed && (
          <p className="note-warning small">{t('noteUndo')}</p>
        )}
        {pending && (
          <p className="muted small" role="status">{t('notePending')}</p>
        )}
        {localError && (
          <p className="form-error" role="alert">
            {renderText(localError)}
          </p>
        )}
        {requestError && (
          <p className="form-error" role="alert">
            {requestError}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={close} disabled={pending}>{t('cancel')}</button>
          <button type="submit" className="button primary" disabled={busy || pending || !changed}>{t('saveNote')}</button>
        </div>
      </form>
    </Modal>
  );
}
