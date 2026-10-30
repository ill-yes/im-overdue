import { useMessages, errorText, type TextValue } from './i18n.js';
import { calendarMessages } from './locales/calendar.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import { noteText } from '../shared/notes.js';
import { activityKey, activitySourceName } from '../shared/data-sources.js';
import {
  addDays,
  clipToDay,
  dayBounds,
  instantAtMinute,
  localTime,
  localTimeWithOffset as timeLabel,
  minuteInDay,
  minutesBetween,
  Temporal,
} from '../shared/time.js';
import type { Activity, AppState, BlockInput, Source, WorkBlock } from '../shared/types.js';
import {
  calendarDraftOutcome,
  HOUR_PX,
  roundSnap,
  SNAP,
  updateCalendarDraft,
  workGaps,
  type CalendarDraft,
  type WorkGap,
} from './calendar-model.js';
import { duration, shortDate as noteDateLabel } from './format.js';
import { ActivityDetailDialog } from './calendar/ActivityDetailDialog.js';
import { CalendarDayHeading } from './calendar/CalendarDayHeading.js';
import { dateObj, durationLabel, fullDate, shortDate, weekday } from './calendar/format.js';
import { calendarWeekDays } from './calendar/week-view-model.js';
import type { QuickCreateAnchor, QuickCreateDraft } from './quick-create';
import './calendar.css';

type Draft = CalendarDraft;

export interface CalendarProps {
  active?: boolean;
  state: AppState;
  weekStart: string;
  focusDate?: string;
  preserveFocus?: boolean;
  activityFocus?: { date: string; source: Source; dataSourceId?: string; id: string; requestId: number };
  enabledSources: string[];
  onCreate: (input: BlockInput, anchor: QuickCreateAnchor) => void;
  quickDraft?: QuickCreateDraft | null;
  onUpdate: (id: string, input: BlockInput) => Promise<void>;
  onEdit: (block: WorkBlock) => void;
  onNew: (date: string) => void;
  onReviewDay?: (date: string) => void;
  onNote: (date: string) => void;
  onVacation?: (date: string) => void;
  onGestureChange?: (active: boolean) => void;
  busy: boolean;
}

function minuteLabel(date: string, minute: number, zone: string) {
  return minute === dayBounds(date, zone).minutes
    ? '24:00'
    : localTime(instantAtMinute(date, minute, zone), zone).slice(0, 5);
}
function eventToMinute(event: { clientY: number }, lane: HTMLElement, date: string, zone: string) {
  return roundSnap(eventToRawMinute(event, lane, date, zone), dayBounds(date, zone).minutes);
}
function eventToRawMinute(event: { clientY: number }, lane: HTMLElement, date: string, zone: string) {
  const rect = lane.getBoundingClientRect();
  const max = dayBounds(date, zone).minutes;
  return Math.max(0, Math.min(max, ((event.clientY - rect.top) * 60) / HOUR_PX));
}
export function Calendar({
  active = true,
  state,
  weekStart,
  focusDate,
  preserveFocus,
  activityFocus,
  enabledSources,
  onCreate,
  quickDraft,
  onUpdate,
  onEdit,
  onNew,
  onReviewDay,
  onNote,
  onVacation,
  onGestureChange,
  busy,
}: CalendarProps) {
  const { t, m, text, locale } = useMessages(calendarMessages);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const zone = state.settings.timezone;
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const enabledKey = JSON.stringify(enabledSources);
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleScroll = useRef({ week: '', top: 7 * HOUR_PX, left: 0 });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const pointerPosition = useRef<{ x: number; y: number } | null>(null);
  const lastPointerType = useRef('');
  const scrollFrame = useRef<number | null>(null);
  const focusButtonRef = useRef<HTMLButtonElement | null>(null);
  const smallGapsToggleRef = useRef<HTMLButtonElement | null>(null);
  const gestureActive = useRef(false);
  const gestureCallback = useRef(onGestureChange);
  gestureCallback.current = onGestureChange;
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const createClick = useRef<{ gap: WorkGap | undefined; minute: number } | null>(null);
  const [detail, setDetail] = useState<Activity[] | null>(null);
  const [showSmallGaps, setShowSmallGaps] = useState(false);
  const [localError, setLocalError] = useState<TextValue>('');
  const weekDays = useMemo(() => calendarWeekDays(dates, state, enabledSources),
    [dates, zone, state.activities, state.blocks, state.profiles, state.vacations, state.absences, state.holidayProfiles, state.holidayOverrides, enabledKey]);
  // Measure the metadata itself, then reserve the same row in every sticky heading.
  // This keeps the timeline aligned even when holiday names wrap at narrow widths.
  useLayoutEffect(() => {
    if (!active) return;
    const week = scrollRef.current?.querySelector<HTMLElement>('.ov-calendar-week');
    if (!week) return;
    const rows = [...week.querySelectorAll<HTMLElement>('.day-absence-items')];
    const measure = () => week.style.setProperty('--ov-absence-height',
      `${Math.ceil(Math.max(0, ...rows.map(row => row.getBoundingClientRect().height)))}px`);
    measure();
    const observer = new ResizeObserver(measure);
    rows.forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [active, weekDays]);
  const smallGaps = weekDays.flatMap(({ date, gaps }) => gaps
    .filter((gap) => gap.height < 12)
    .map((gap) => ({ date, gap })));

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!active || !scroll) return;
    const saved = visibleScroll.current;
    scroll.scrollTop = saved.week === weekStart ? saved.top : 7 * HOUR_PX;
    scroll.scrollLeft = saved.week === weekStart ? saved.left : 0;
    visibleScroll.current = { week: weekStart, top: scroll.scrollTop, left: scroll.scrollLeft };
  }, [active, weekStart]);
  useEffect(() => { setShowSmallGaps(false); }, [weekStart]);
  useEffect(() => { if (smallGaps.length === 0) setShowSmallGaps(false); }, [smallGaps.length]);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!active || !scroll || !focusDate || !dates.includes(focusDate)) return;
    const day = scroll.querySelector<HTMLElement>(`[data-calendar-day="${focusDate}"]`);
    const heading = day?.querySelector<HTMLElement>('.ov-calendar-dayhead');
    if (!day || !heading) return;
    const box = day.getBoundingClientRect();
    const viewport = scroll.getBoundingClientRect();
    scroll.scrollLeft += box.left - viewport.left - (scroll.clientWidth - box.width) / 2;
    // Keep day-review navigation in its controls until a calendar jump is requested.
    if (!preserveFocus) {
      if (activityFocus?.date !== focusDate) heading.focus({ preventScroll: true });
      scroll.scrollIntoView({ block: 'nearest' });
    }
  }, [focusDate, dates, activityFocus?.date]);
  useEffect(() => {
    if (!active || !activityFocus || !dates.includes(activityFocus.date)) return;
    const scroll = scrollRef.current;
    const marker = focusButtonRef.current;
    if (!scroll || !marker) return;
    const day = marker.closest<HTMLElement>('[data-calendar-day]');
    if (day) {
      const box = day.getBoundingClientRect();
      const viewport = scroll.getBoundingClientRect();
      scroll.scrollLeft += box.left - viewport.left - (scroll.clientWidth - box.width) / 2;
    }
    const markerTop =
      marker.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    scroll.scrollTop = Math.max(0, markerTop - Math.min(170, scroll.clientHeight / 3));
    marker.focus({ preventScroll: true });
    scroll.scrollIntoView({ block: 'nearest' });
  }, [activityFocus?.date, activityFocus?.source, activityFocus?.dataSourceId, activityFocus?.id, activityFocus?.requestId, dates]);
  useEffect(() => {
    if (!detail) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      dialog.close();
      priorFocusRef.current?.focus();
      priorFocusRef.current = null;
    };
  }, [detail]);
  useEffect(
    () => () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      if (gestureActive.current) gestureCallback.current?.(false);
    },
    [],
  );
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (draftRef.current || dialogRef.current?.open) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        cancelDraft();
        setDetail(null);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);

  function beginDraft(next: Draft, element: HTMLElement, event: ReactPointerEvent) {
    if ((busy && next.kind !== 'create') || event.pointerType !== 'mouse' || event.button !== 0) return;
    setLocalError('');
    if (next.kind === 'create') {
      const minute = eventToRawMinute(event, element, next.date, zone);
      createClick.current = { minute, gap: workGaps(state.blocks, next.date, zone)
        .find((gap) => minute >= gap.startMinute && minute < gap.endMinute) };
    } else createClick.current = null;
    draftRef.current = next;
    setDraft(next);
    gestureActive.current = true;
    gestureCallback.current?.(true);
    element.setPointerCapture(event.pointerId);
    pointerPosition.current = { x: event.clientX, y: event.clientY };
    if (scrollFrame.current === null) scrollFrame.current = requestAnimationFrame(autoScroll);
    event.preventDefault();
  }
  function autoScroll() {
    const scroll = scrollRef.current;
    const pointer = pointerPosition.current;
    if (!draftRef.current || !scroll || !pointer) {
      scrollFrame.current = null;
      return;
    }
    const rect = scroll.getBoundingClientRect();
    const edge = 55;
    const delta =
      pointer.y < rect.top + edge
        ? -Math.min(18, (rect.top + edge - pointer.y) / 3)
        : pointer.y > rect.bottom - edge
          ? Math.min(18, (pointer.y - rect.bottom + edge) / 3)
          : 0;
    if (delta) {
      const before = scroll.scrollTop;
      scroll.scrollTop += delta;
      if (scroll.scrollTop !== before) updateDraftAt(pointer.x, pointer.y);
    }
    scrollFrame.current = requestAnimationFrame(autoScroll);
  }
  function stopAutoScroll() {
    pointerPosition.current = null;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
  }
  function endGesture() {
    if (!gestureActive.current) return;
    gestureActive.current = false;
    gestureCallback.current?.(false);
  }
  function laneAtPoint(x: number, y: number): HTMLElement | null {
    const hit = document.elementFromPoint(x, y);
    return hit instanceof Element ? hit.closest<HTMLElement>('[data-work-lane]') : null;
  }
  function updateDraft(event: ReactPointerEvent) {
    const current = draftRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    pointerPosition.current = { x: event.clientX, y: event.clientY };
    updateDraftAt(event.clientX, event.clientY);
  }
  function updateDraftAt(x: number, y: number) {
    const current = draftRef.current;
    if (!current) return;
    const hover = laneAtPoint(x, y);
    const requestedDate = hover?.dataset.date ?? current.date;
    const date = current.kind === 'move' ? requestedDate : current.sourceDate;
    const lane = document.querySelector<HTMLElement>(`[data-work-lane][data-date="${date}"]`);
    if (!lane) return;
    const minute = eventToMinute({ clientY: y }, lane, date, zone);
    const dayLength = dayBounds(date, zone).minutes;
    const next = updateCalendarDraft(current, date, minute, dayLength);
    if (next === current) return;
    draftRef.current = next;
    setDraft(next);
  }
  async function finishDraft(event: ReactPointerEvent) {
    const current = draftRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const clicked = createClick.current;
    createClick.current = null;
    draftRef.current = null;
    setDraft(null);
    stopAutoScroll();
    endGesture();
    if (busy && current.kind !== 'create') return;
    const outcome = calendarDraftOutcome(current, zone);
    if (outcome.kind === 'edit') {
      onEdit(outcome.block);
      return;
    }
    if (outcome.kind === 'new') {
      const lane = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-work-lane]');
      if (clicked?.gap && lane) openGap(clicked.gap, outcome.date, lane, clicked.minute);
      else onNew(outcome.date);
      return;
    }
    if (outcome.kind === 'none') return;
    try {
      if (outcome.block) await onUpdate(outcome.block.id, outcome.input);
      else {
        const lane = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-work-lane]')!;
        onCreate(outcome.input, { date: current.date, lane, minute: eventToMinute(event, lane, current.date, zone) });
      }
    } catch (error) {
      setLocalError(
        errorText(error, m('saveFailed')),
      );
    }
  }
  function cancelDraft() {
    createClick.current = null;
    draftRef.current = null;
    setDraft(null);
    stopAutoScroll();
    endGesture();
  }
  function openDetail(activities: Activity[]) {
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDetail(activities);
  }
  function openGap(gap: WorkGap, date: string, lane: HTMLElement, minute = gap.startMinute) {
    onCreate({ start: gap.start, end: gap.end, title: '', note: '' }, { date, lane, minute });
  }

  return (
    <section className="ov-calendar" aria-label={t('weekCalendar')} onKeyDown={(event) => {
      if (showSmallGaps && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setShowSmallGaps(false);
        smallGapsToggleRef.current?.focus();
      }
    }}>
      {smallGaps.length > 0 && <div className="ov-calendar-note">
          <button className="ov-small-gaps-toggle" ref={smallGapsToggleRef} type="button" aria-expanded={showSmallGaps}
            aria-controls="calendar-small-gaps" onClick={() => setShowSmallGaps(!showSmallGaps)}>
            {t('smallGaps', { count: number(smallGaps.length) })}
          </button>
      </div>}
      {showSmallGaps && smallGaps.length > 0 && (
        <div id="calendar-small-gaps" className="ov-small-gaps" role="group" aria-label={t('smallTimeGaps')}>
          <span>{t('chooseGap')}</span>
          {smallGaps.map(({ date, gap }) => (
            <button type="button" key={`${date}:${gap.start}`}
              data-small-work-gap="" data-date={date} data-start={gap.start} data-end={gap.end}
              aria-label={t('fillGapDate', { date: noteDateLabel(date), start: localTime(gap.start, zone).slice(0, 5), end: localTime(gap.end, zone).slice(0, 5) })}
              onClick={() => {
                setShowSmallGaps(false);
                // Wait for the disclosure's removal before measuring the QuickCreate anchor.
                requestAnimationFrame(() => {
                  const scroll = scrollRef.current;
                  const lane = scroll?.querySelector<HTMLElement>(`[data-work-lane][data-date="${date}"]`);
                  if (!scroll || !lane) return;
                  scroll.scrollIntoView({ block: 'nearest' });
                  const viewport = scroll.getBoundingClientRect();
                  const box = lane.getBoundingClientRect();
                  scroll.scrollLeft += box.left - viewport.left - (scroll.clientWidth - box.width) / 2;
                  scroll.scrollTop += box.top - viewport.top + (gap.startMinute * HOUR_PX) / 60 - Math.min(170, scroll.clientHeight / 3);
                  openGap(gap, date, lane);
                });
              }}>
              <strong>{weekday.format(dateObj(date))} {fullDate.format(dateObj(date))}</strong>{' '}
              {localTime(gap.start, zone)}–{localTime(gap.end, zone)}
              <small>{duration(gap.endMinute - gap.startMinute)}</small>
            </button>
          ))}
        </div>
      )}
      {localError && (
        <div className="ov-calendar-error" role="alert">
          {text(localError)}{' '}
          <button type="button" onClick={() => setLocalError('')} aria-label={t('dismissMessage')}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="ov-calendar-scroll" ref={scrollRef} onScroll={event => { if (active) visibleScroll.current = { week: weekStart, top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft }; }}>
        <div className="ov-calendar-week">
          {weekDays.map(({ date, bounds, total, evidence, blocks, hours, gaps, vacation }) => {
            const dayHeight = (bounds.minutes * HOUR_PX) / 60;
            const isDst = bounds.minutes !== 1440;
            const note = noteText(state.notes, 'day', date);
            const staged = quickDraft ? clipToDay(quickDraft.input.start, quickDraft.input.end, date, zone) : null;
            return (
              <div
                className="ov-calendar-day"
                key={date}
                data-calendar-day={date}
                data-selected-day={focusDate === date ? 'true' : undefined}
              >
                <CalendarDayHeading
                  day={{ date, bounds, total, vacation }}
                  state={state}
                  selected={focusDate === date}
                  note={note}
                  busy={busy}
                  onReviewDay={onReviewDay}
                  onNew={onNew}
                  onNote={onNote}
                  onVacation={onVacation}
                />
                <div className="ov-calendar-daylanes" style={{ height: `${dayHeight}px` }}>
                  <div className="ov-activity-lane" aria-label={t('activitiesFor', { date })}>
                    <span className="ov-lane-caption">{t('activities')}</span>
                    {evidence.map((group) => {
                      const activity = group.activities[0];
                      const focused = Boolean(
                        activityFocus?.date === date &&
                        group.activities.some(
                          (item) => activityKey(item) === activityKey(activityFocus),
                        ),
                      );
                      const height = group.bottom - group.top;
                      const mixedSources = group.activities.some((item) => item.source !== activity.source);
                      const countLabel =
                        group.points && group.intervals
                          ? `${t('evidenceCount', { count: number(group.activities.length) })} · ${t(group.intervals === 1 ? 'eventOne' : 'eventMany', { count: number(group.intervals) })} + ${t(group.points === 1 ? 'activityOne' : 'activityMany', { count: number(group.points) })}`
                          : group.points
                            ? t(group.points === 1 ? 'activityOne' : 'activityMany', { count: number(group.points) })
                            : t(group.intervals === 1 ? 'eventOne' : 'eventMany', { count: number(group.intervals) });
                      return (
                        <button
                          key={activityKey(activity)}
                          ref={
                            focused
                              ? (element) => {
                                  focusButtonRef.current = element;
                                }
                              : undefined
                          }
                          data-focused-activity={focused ? 'true' : undefined}
                          data-activity-key={activityKey(activity)}
                          data-activity-keys={JSON.stringify(group.activities.map(activityKey))}
                          className={`ov-activity ${group.intervals ? '' : 'ov-activity-point'} ${mixedSources ? 'ov-activity-mixed' : `ov-source-${activity.source}`}`}
                          type="button"
                          style={{ top: `${group.top}px`, height: `${height}px` }}
                          onClick={() => openDetail(group.activities)}
                          title={group.activities
                            .map((a) => `${a.title} · ${activitySourceName(a, state.dataSources)} · ${timeLabel(a.start, zone)}`)
                            .join('\n')}
                          aria-label={
                            group.activities.length === 1
                              ? `${activity.title}, ${activitySourceName(activity, state.dataSources)}, ${timeLabel(activity.start, zone)}`
                              : `${countLabel}, ${[...new Set(group.activities.map(item => activitySourceName(item, state.dataSources)))].join(', ')}`
                          }
                        >
                          <span className="ov-activity-title">
                            {group.activities.length === 1 ? activity.title : countLabel}
                          </span>
                          {height > 36 && group.intervals > 0 && (
                            <small>{timeLabel(activity.start, zone)}</small>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div
                    className="ov-work-lane"
                    data-work-lane=""
                    data-date={date}
                    role="button"
                    tabIndex={0}
                    aria-label={t('drawTimeFor', { date: shortDate.format(dateObj(date)) })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onNew(date);
                      }
                    }}
                    onPointerDown={(event) => {
                      if (
                        event.target !== event.currentTarget ||
                        event.pointerType !== 'mouse' ||
                        event.button !== 0
                      )
                        return;
                      const minute = eventToMinute(event, event.currentTarget, date, zone);
                      beginDraft(
                        {
                          kind: 'create',
                          pointerId: event.pointerId,
                          sourceDate: date,
                          date,
                          anchorMinute: minute,
                          startMinute: minute,
                          endMinute: Math.min(bounds.minutes, minute + SNAP),
                          moved: false,
                        },
                        event.currentTarget,
                        event,
                      );
                    }}
                    onPointerMove={updateDraft}
                    onPointerUp={finishDraft}
                    onPointerCancel={cancelDraft}
                    onLostPointerCapture={(event) => {
                      if (draftRef.current?.pointerId === event.pointerId) cancelDraft();
                    }}
                  >
                    <span className="ov-lane-caption">{t('workingTime')}</span>
                    {gaps.map((gap) => {
                      const { top, height } = gap;
                      return (
                        <button key={gap.start} className="ov-work-gap" type="button"
                          data-work-gap="" data-start={gap.start} data-end={gap.end}
                          aria-label={t('fillGapTime', { start: localTime(gap.start, zone).slice(0, 5), end: localTime(gap.end, zone).slice(0, 5) })}
                          title={t('fillGap', { duration: duration(gap.endMinute - gap.startMinute) })}
                          style={{ top: `${top}px`, height: `${height}px` }}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (event.detail === 0 || lastPointerType.current !== 'mouse')
                              openGap(gap, date, event.currentTarget.closest<HTMLElement>('[data-work-lane]')!);
                          }}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            lastPointerType.current = event.pointerType;
                            if (event.pointerType !== 'mouse' || event.button !== 0) return;
                            const lane = event.currentTarget.closest<HTMLElement>('[data-work-lane]')!;
                            const minute = eventToMinute(event, lane, date, zone);
                            beginDraft({ kind: 'create', pointerId: event.pointerId, sourceDate: date, date,
                              anchorMinute: minute, startMinute: minute,
                              endMinute: Math.min(bounds.minutes, minute + SNAP), moved: false }, lane, event);
                          }}>
                          {height >= 30 && <span>{t('fillGap', { duration: duration(gap.endMinute - gap.startMinute) })}</span>}
                        </button>
                      );
                    })}
                    {blocks.map(({ block, clip }) => {
                      const segment = clip!;
                      const top = (minuteInDay(segment.start, date, zone) * HOUR_PX) / 60;
                      const height = (segment.minutes * HOUR_PX) / 60;
                      const startHandle = Temporal.Instant.compare(block.start, bounds.start) >= 0;
                      const endHandle = Temporal.Instant.compare(block.end, bounds.end) <= 0;
                      return (
                        <div
                          className="ov-work-block"
                          key={block.id}
                          role="button"
                          tabIndex={busy ? -1 : 0}
                          aria-disabled={busy}
                          data-work-block={block.id}
                          data-start={block.start}
                          data-end={block.end}
                          aria-label={t('workBlock', { start: timeLabel(block.start, zone), end: timeLabel(block.end, zone), duration: durationLabel(minutesBetween(block.start, block.end)), description: block.title || block.note ? `, ${block.title || block.note}` : '' })}
                          title={`${timeLabel(block.start, zone)}–${timeLabel(block.end, zone)} · ${block.title || block.note || t('workingTime')}${block.title && block.note ? `\n${block.note}` : ''}`}
                          style={{ top: `${top}px`, height: `${Math.max(18, height)}px` }}
                          onKeyDown={(event) => {
                            if (!busy && (event.key === 'Enter' || event.key === ' ')) {
                              event.preventDefault();
                              event.stopPropagation();
                              onEdit(block);
                            }
                          }}
                          onClick={(event) => {
                            if (event.detail > 0 && lastPointerType.current === 'touch' && !busy)
                              onEdit(block);
                          }}
                          onPointerDown={(event) => {
                            lastPointerType.current = event.pointerType;
                            if (busy) return;
                            if (event.pointerType !== 'mouse' || event.button !== 0) return;
                            if (
                              Temporal.Instant.compare(block.start, bounds.start) < 0 ||
                              Temporal.Instant.compare(block.end, bounds.end) > 0
                            ) {
                              onEdit(block);
                              return;
                            }
                            event.stopPropagation();
                            const kind = (event.target as HTMLElement).closest('[data-resize-start]')
                              ? 'resize-start'
                              : (event.target as HTMLElement).closest('[data-resize-end]')
                                ? 'resize-end'
                                : 'move';
                            const segmentStart = minuteInDay(segment.start, date, zone);
                            const segmentEnd = minuteInDay(segment.end, date, zone);
                            const pointerMinute = eventToMinute(
                              event,
                              event.currentTarget.parentElement!,
                              date,
                              zone,
                            );
                            beginDraft(
                              {
                                kind,
                                pointerId: event.pointerId,
                                sourceDate: date,
                                date,
                                anchorMinute: kind === 'move' ? pointerMinute - segmentStart : pointerMinute,
                                pointerInitialMinute: pointerMinute,
                                startMinute: segmentStart,
                                endMinute: segmentEnd,
                                block,
                                moved: false,
                              },
                              event.currentTarget,
                              event,
                            );
                          }}
                          onPointerMove={updateDraft}
                          onPointerUp={finishDraft}
                          onPointerCancel={cancelDraft}
                          onLostPointerCapture={(event) => {
                            if (draftRef.current?.pointerId === event.pointerId) cancelDraft();
                          }}
                        >
                          {startHandle && (
                            <span
                              className="ov-work-handle ov-work-handle-top"
                              data-resize-start=""
                              aria-hidden="true"
                            />
                          )}
                          <span className="ov-work-block-copy">
                            <strong>
                              {minuteLabel(date, minuteInDay(segment.start, date, zone), zone)}–
                              {minuteLabel(date, minuteInDay(segment.end, date, zone), zone)}
                            </strong>
                            {height > 24 && <small>{block.title || block.note || durationLabel(segment.minutes)}</small>}
                          </span>
                          {endHandle && (
                            <span
                              className="ov-work-handle ov-work-handle-bottom"
                              data-resize-end=""
                              aria-hidden="true"
                            />
                          )}
                        </div>
                      );
                    })}
                    {staged && quickDraft && !draft && (
                      <div
                        className="ov-work-preview is-new is-staged"
                        data-quick-preview={quickDraft.id}
                        style={{
                          top: `${(minuteInDay(staged.start, date, zone) * HOUR_PX) / 60}px`,
                          height: `${Math.max(16, (staged.minutes * HOUR_PX) / 60)}px`,
                        }}
                      >
                        <span>{localTime(staged.start, zone)}–{Temporal.Instant.compare(staged.end, bounds.end) === 0 ? '24:00' : localTime(staged.end, zone)}</span>
                        <strong>{durationLabel(staged.minutes)}</strong>
                        <small>{t('notSaved')}</small>
                      </div>
                    )}
                    {draft?.date === date && (
                      <div
                        className={`ov-work-preview ${draft.kind === 'create' ? 'is-new' : ''}`}
                        style={{
                          top: `${(draft.startMinute * HOUR_PX) / 60}px`,
                          height: `${Math.max(16, ((draft.endMinute - draft.startMinute) * HOUR_PX) / 60)}px`,
                        }}
                        aria-live="polite"
                      >
                        {minuteLabel(date, draft.startMinute, zone)}–
                        {minuteLabel(date, draft.endMinute, zone)}{' '}
                        <strong>{durationLabel(draft.endMinute - draft.startMinute)}</strong>
                      </div>
                    )}
                  </div>
                  <div className="ov-time-labels" aria-hidden="true">
                    {hours.map(({ hour, label, offset }) => {
                      const repeated = hours.some((other) => other.hour < hour && other.label === label);
                      return (
                        <span key={hour} style={{ top: `${hour * HOUR_PX}px` }}>
                          {label}
                          {repeated || (isDst && label === '02:00') ? <small>{offset}</small> : null}
                        </span>
                      );
                    })}
                    <span className="ov-time-end" style={{ top: `${dayHeight}px` }}>
                      24:00
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {detail && (
        <ActivityDetailDialog activities={detail} sources={state.dataSources} zone={zone} dialogRef={dialogRef} onClose={() => setDetail(null)} />
      )}
    </section>
  );
}
