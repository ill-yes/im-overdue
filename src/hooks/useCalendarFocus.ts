import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

type FocusOrigin = { week: string; top: number; left: number; movedTop: boolean; movedLeft: boolean };
type FocusRestore = { week: string; top: number; left: number };
type CalendarFocusOptions = {
  week: string;
  dialogOpen: boolean;
  gestureInFlight: RefObject<boolean>;
  reviewOpen: boolean;
  messageVisible: boolean;
  failureVisible: boolean;
  weekNoteVisible: boolean;
};

export function useCalendarFocus({
  week,
  dialogOpen,
  gestureInFlight,
  reviewOpen,
  messageVisible,
  failureVisible,
  weekNoteVisible,
}: CalendarFocusOptions) {
  const [focused, setFocused] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const focusToggle = useRef<HTMLButtonElement>(null);
  const priorPageScroll = useRef(0);
  const focusOrigin = useRef<FocusOrigin | null>(null);
  const focusRestore = useRef<FocusRestore | null>(null);

  const invalidateFocusOrigin = useCallback(() => {
    focusOrigin.current = null;
  }, []);
  const enterFocus = useCallback(() => {
    const calendar = mainRef.current?.querySelector<HTMLElement>('.ov-calendar-scroll');
    focusOrigin.current = calendar ? { week, top: calendar.scrollTop, left: calendar.scrollLeft, movedTop: false, movedLeft: false } : null;
    setFocused(true);
  }, [week]);
  const leaveFocus = useCallback(() => {
    const calendar = mainRef.current?.querySelector<HTMLElement>('.ov-calendar-scroll');
    const origin = focusOrigin.current;
    if (calendar && origin?.week === week) {
      // Expanding can clamp an offset; only deliberate scrolling replaces its origin.
      focusRestore.current = {
        week,
        top: origin.movedTop ? calendar.scrollTop : origin.top,
        left: origin.movedLeft ? calendar.scrollLeft : origin.left,
      };
    }
    focusOrigin.current = null;
    setFocused(false);
  }, [week]);
  useLayoutEffect(() => {
    if (focusOrigin.current?.week !== week) focusOrigin.current = null;
    if (focused) return;
    const restore = focusRestore.current;
    if (!restore) return;
    const calendar = mainRef.current?.querySelector<HTMLElement>('.ov-calendar-scroll');
    // A page change can hide the calendar in the same commit as leaving focus.
    // Keep the return point until it has a visible, measurable scroll area again.
    if (!calendar?.getClientRects().length) return;
    if (calendar && restore?.week === week) {
      calendar.scrollTop = restore.top;
      calendar.scrollLeft = restore.left;
    }
    focusRestore.current = null;
  });
  useEffect(() => {
    if (!focused) return;
    const calendar = mainRef.current?.querySelector<HTMLElement>('.ov-calendar-scroll');
    if (!calendar) return;
    const scrolled = () => {
      const origin = focusOrigin.current;
      if (!origin || origin.week !== week) return;
      const naturalTop = Math.min(origin.top, calendar.scrollHeight - calendar.clientHeight);
      const naturalLeft = Math.min(origin.left, calendar.scrollWidth - calendar.clientWidth);
      origin.movedTop ||= Math.abs(calendar.scrollTop - naturalTop) >= 1;
      origin.movedLeft ||= Math.abs(calendar.scrollLeft - naturalLeft) >= 1;
    };
    calendar.addEventListener('scroll', scrolled);
    return () => calendar.removeEventListener('scroll', scrolled);
  }, [focused, week]);
  useEffect(() => {
    if (!focused) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || gestureInFlight.current ||
        dialogOpen || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      leaveFocus();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [focused, dialogOpen, gestureInFlight, leaveFocus]);
  useEffect(() => {
    const main = mainRef.current;
    if (!focused || !main) return;
    priorPageScroll.current = window.scrollY;
    window.scrollTo({ top: 0 });
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = oldOverflow;
      window.scrollTo({ top: priorPageScroll.current });
      focusToggle.current?.focus({ preventScroll: true });
    };
  }, [focused]);
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!focused || !main) return;
    const sizeCalendar = () => {
      const calendar = main.querySelector<HTMLElement>('.ov-calendar-scroll');
      if (!calendar) return;
      const available = window.innerHeight - calendar.getBoundingClientRect().top - 14;
      main.style.setProperty('--focus-calendar-height', `${Math.max(300, available)}px`);
      // Restore untouched axes before scroll events see the intermediate resize clamp.
      const origin = focusOrigin.current;
      if (origin?.week === week) {
        if (!origin.movedTop) calendar.scrollTop = origin.top;
        if (!origin.movedLeft) calendar.scrollLeft = origin.left;
      }
    };
    const observer = new ResizeObserver(sizeCalendar);
    for (const selector of ['.workspace-toolbar', '.section-heading', '.source-filters', '.week-note-preview', '.day-review', '.app-alert', '.app-toast']) {
      const element = main.querySelector(selector);
      if (element) observer.observe(element);
    }
    window.addEventListener('resize', sizeCalendar);
    sizeCalendar();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sizeCalendar);
      main.style.removeProperty('--focus-calendar-height');
    };
  }, [focused, week, reviewOpen, messageVisible, failureVisible, weekNoteVisible]);

  return { focused, mainRef, focusToggle, enterFocus, leaveFocus, invalidateFocusOrigin };
}
