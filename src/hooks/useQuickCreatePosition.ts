import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { dayBounds, minuteInDay } from '../../shared/time.js';
import { HOUR_PX } from '../calendar-model';
import type { QuickCreateDraft } from '../quick-create';

export interface QuickRect { left: number; right: number; top: number; bottom: number }
export interface QuickPosition { left: number; top: number; width: number; maxHeight: number; listLeft: number; listTop: number; inline: boolean }
export interface QuickVisibleAnchor { block: QuickRect; releaseY: number }

export function shouldDismissInvisibleQuickCreate(hadVisiblePosition: boolean, intentionalViewportChange: boolean): boolean {
  return !hadVisiblePosition || intentionalViewportChange;
}

export function resolveQuickVisibleAnchor(current: QuickVisibleAnchor | null, previous: QuickVisibleAnchor | null, intentionalViewportChange: boolean): QuickVisibleAnchor | null {
  return current ?? (shouldDismissInvisibleQuickCreate(previous !== null, intentionalViewportChange) ? null : previous);
}

export function intersectQuickRect(a: QuickRect, b: QuickRect): QuickRect | null {
  const rect = { left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) };
  return rect.left < rect.right && rect.top < rect.bottom ? rect : null;
}

export function calculateQuickPosition(block: QuickRect, releaseY: number, viewport: { width: number; height: number }, menu: { width: number; height: number }, list: { width: number; height: number }): QuickPosition {
  const gap = 8;
  const width = Math.min(menu.width, Math.max(0, viewport.width - gap * 2));
  const clampX = (value: number) => Math.max(gap, Math.min(value, viewport.width - width - gap));
  const left = clampX(block.right + gap + width <= viewport.width - gap
    ? block.right + gap : block.left - width - gap);
  const maxHeight = Math.max(0, viewport.height - gap * 2);
  const top = Math.max(gap, Math.min(Math.max(block.top, Math.min(releaseY, block.bottom)), viewport.height - Math.min(menu.height, maxHeight) - gap));
  const rightList = left + width + gap;
  const leftList = left - list.width - gap;
  const inline = viewport.width <= 760 || (rightList + list.width > viewport.width - gap && leftList < gap);
  const listLeft = rightList + list.width <= viewport.width - gap ? width + gap : -list.width - gap;
  const listTop = Math.max(gap, Math.min(top, viewport.height - Math.min(list.height, maxHeight) - gap)) - top;
  return { left, top, width, maxHeight, listLeft, listTop, inline };
}

export function useQuickCreatePosition(draft: QuickCreateDraft, rootRef: RefObject<HTMLDivElement | null>, mainRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLElement | null>, listOpen: boolean, onClose: (restoreFocus: boolean) => void, layoutZone = draft.zone): QuickPosition | null {
  const [position, setPosition] = useState<QuickPosition | null>(null);
  const lastVisibleAnchor = useRef<QuickVisibleAnchor | null>(null);
  useLayoutEffect(() => {
    const lane = draft.anchor.lane;
    const scroller = lane.closest<HTMLElement>('.ov-calendar-scroll');
    const heading = lane.closest('.ov-calendar-day')?.querySelector<HTMLElement>('.ov-calendar-dayhead');
    let closed = false;
    let frame = 0;
    let intentionalViewportChange = false;
    const update = (intentional = false) => {
      if (closed) return;
      const laneRect = lane.getBoundingClientRect();
      const scrollRect = scroller?.getBoundingClientRect();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const visible = {
        left: Math.max(0, scrollRect ? scrollRect.left + (scroller?.clientLeft ?? 0) : 0),
        right: Math.min(viewport.width, scrollRect ? scrollRect.left + (scroller?.clientLeft ?? 0) + (scroller?.clientWidth ?? 0) : viewport.width),
        top: Math.max(0, scrollRect ? scrollRect.top + (scroller?.clientTop ?? 0) : 0, heading?.getBoundingClientRect().bottom ?? 0),
        bottom: Math.min(viewport.height, scrollRect ? scrollRect.top + (scroller?.clientTop ?? 0) + (scroller?.clientHeight ?? 0) : viewport.height),
      };
      const maxMinute = dayBounds(draft.anchor.date, draft.zone).minutes;
      const start = Math.max(0, minuteInDay(draft.input.start, draft.anchor.date, draft.zone));
      const end = Math.min(maxMinute, minuteInDay(draft.input.end, draft.anchor.date, draft.zone));
      // Calendar previews reflect the currently rendered zone, which can change
      // independently of the immutable input zone of this creation session.
      const previews = [...document.querySelectorAll<HTMLElement>(`[data-quick-preview="${draft.id}"]`)];
      const visiblePreviews = previews.flatMap((preview) => {
        const rect = preview.getBoundingClientRect();
        const clipped = intersectQuickRect(rect, visible);
        return clipped ? [{ preview, rect, clipped }] : [];
      });
      const preview = visiblePreviews.find((item) => lane.contains(item.preview)) ?? visiblePreviews[0];
      const block = previews.length || layoutZone !== draft.zone ? preview?.clipped ?? null : intersectQuickRect({ left: laneRect.left, right: laneRect.right, top: laneRect.top + start * HOUR_PX / 60, bottom: Math.min(laneRect.bottom, laneRect.top + end * HOUR_PX / 60) }, visible);
      const releaseRatio = end > start ? Math.max(0, Math.min(1, (draft.anchor.minute - start) / (end - start))) : 1;
      const releaseY = preview ? preview.rect.top + (preview.rect.bottom - preview.rect.top) * releaseRatio : laneRect.top + draft.anchor.minute * HOUR_PX / 60;
      const currentAnchor = lane.isConnected && block ? { block, releaseY } : null;
      const anchor = resolveQuickVisibleAnchor(currentAnchor, lastVisibleAnchor.current, intentional);
      if (!anchor) { closed = true; onClose(false); return; }
      if (currentAnchor) lastVisibleAnchor.current = currentAnchor;
      // A state refresh can hide the calendar preview while errors enlarge the
      // menu. Keep its last anchor but always remeasure and clamp the panels.
      const mainRect = mainRef.current?.getBoundingClientRect();
      const listRect = listRef.current?.getBoundingClientRect();
      const next = calculateQuickPosition(anchor.block, anchor.releaseY, viewport,
        { width: Math.min(300, viewport.width - 16), height: mainRect?.height ?? listRect?.height ?? 280 },
        { width: Math.min(320, viewport.width - 16), height: listRect?.height ?? 420 });
      setPosition((current) => current && Object.keys(next).every((key) => current[key as keyof QuickPosition] === next[key as keyof QuickPosition]) ? current : next);
    };
    const schedule = (event?: Event) => {
      if (event?.target instanceof Node && rootRef.current?.contains(event.target)) return;
      intentionalViewportChange ||= event?.type === 'scroll' || event?.type === 'resize';
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { const intentional = intentionalViewportChange; intentionalViewportChange = false; update(intentional); });
    };
    update();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(() => schedule());
    [lane, scroller, heading, mainRef.current, listRef.current, ...document.querySelectorAll<HTMLElement>(`[data-quick-preview="${draft.id}"]`)].forEach((element) => { if (element) observer.observe(element); });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [draft, rootRef, mainRef, listRef, listOpen, onClose, layoutZone]);
  return position;
}
