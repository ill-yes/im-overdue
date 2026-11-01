import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './popover.css';

export function Popover({ label, children, trigger, className = 'button secondary', menu = false, disabled = false, title }: {
  label: string; children: ReactNode; trigger: ReactNode; className?: string; menu?: boolean; disabled?: boolean; title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs after every render; setOpen(false) is guarded by open.
  useLayoutEffect(() => {
    if (open && !button.current?.getClientRects().length) setOpen(false);
  });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = button.current?.getBoundingClientRect();
      const content = panel.current;
      if (!anchor || !content) return;
      if (!button.current?.getClientRects().length) { setOpen(false); return; }
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) { setOpen(false); return; }
      const width = content.offsetWidth;
      const height = content.offsetHeight;
      setPosition({ left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)), top: Math.max(8, anchor.bottom + height + 8 <= window.innerHeight ? anchor.bottom + 6 : anchor.top - height - 6) });
    };
    place();
    panel.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]')?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !button.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus({ preventScroll: true });
      } else if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && panel.current?.contains(event.target as Node)) {
        event.preventDefault();
        const items = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')];
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', key, true); };
  }, [open, menu]);
  return <>
    <button ref={button} type="button" className={className} aria-label={label} title={title} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup={menu ? 'menu' : undefined} disabled={disabled} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>{trigger}</button>
    {open && createPortal(<div id={id} ref={panel} className={`workspace-popover${menu ? ' is-menu' : ''}`} role={menu ? 'menu' : 'group'} aria-label={label} style={position}
      onClick={event => { if (menu && (event.target as HTMLElement).closest('button:not(:disabled), a[href]')) { setOpen(false); button.current?.focus({ preventScroll: true }); } }}
      onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !button.current?.contains(event.relatedTarget)) setOpen(false); }}>
      {children}
    </div>, document.body)}
  </>;
}
