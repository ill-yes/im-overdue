import { useEffect } from 'react';

/** Global undo never competes with text editing, dialogs or a blocked workflow. */
export function useUndoShortcut(canUndo: () => boolean, onUndo: () => void | Promise<void>) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented || event.repeat || !(event.ctrlKey || event.metaKey) ||
        event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z'
      ) return;
      const target = event.target;
      if (
        !canUndo() ||
        document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')))
      ) return;
      event.preventDefault();
      void onUndo();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
}
