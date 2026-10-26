import { useMessages } from '../i18n';
import { workflows } from '../locales/workflows';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './dialog-workflow.css';

export function Modal({
  title,
  onClose,
  onEscape,
  children,
  className = '',
  closeDisabled = false,
}: {
  title: string;
  onClose: () => void;
  onEscape?: () => void;
  children: ReactNode;
  className?: string;
  closeDisabled?: boolean;
}) {
  const { t } = useMessages(workflows);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const closeRef = useRef(onClose);
  const escapeRef = useRef(onEscape);
  closeRef.current = onClose;
  escapeRef.current = onEscape;
  useEffect(() => {
    // A replacement dialog may render while focus still belongs to the old one.
    const previous = previousFocus.current?.isConnected ? previousFocus.current : document.activeElement as HTMLElement | null;
    const node = dialog.current;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]';
    const available = (element: HTMLElement) => !element.matches(':disabled') &&
      !element.closest('[hidden], [inert]') && element.getClientRects().length > 0;
    const focusables = () => [...(node?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
      .filter((element) => element.tabIndex >= 0 && available(element));
    const initial = [...(node?.querySelectorAll<HTMLElement>('[data-dialog-autofocus]') ?? [])].find(available);
    (initial ?? focusables()[0] ?? node)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        (escapeRef.current ?? closeRef.current)();
      }
      if (event.key !== 'Tab' || !node) return;
      const controls = focusables();
      // A pending form can disable every control. Keep Tab inside the dialog anyway.
      if (controls.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!controls.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal ${className}`} ref={dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label={t('closeDialog')} disabled={closeDisabled}>
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
