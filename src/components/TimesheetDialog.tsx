import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer } from 'lucide-react';
import { accountCsv, filteredTimesheetDays, timesheetCsv } from '../../shared/timesheet.js';
import { Temporal, periodBounds, weekStartFor } from '../../shared/time.js';
import type { TimesheetOptions, TimesheetSnapshot } from '../../shared/types.js';
import { Modal } from './Modal';
import { TimesheetDocument } from './TimesheetDocument';
import { errorText, useMessages, type TextValue } from '../i18n';
import { exportMessages } from '../locales/exports';
import { accountingExportMessages } from '../locales/accounting-export';
import { downloadBlob } from '../download';
import './timesheet-dialog.css';

type Kind = 'month' | 'week' | 'custom';
export type TimesheetPreset = { kind: Kind; from: string; to: string };
type Range = { from: string; to: string; error?: never } | { error: keyof typeof exportMessages; from?: never; to?: never };
type Selection = { from: string | undefined; to: string | undefined; retry: number };

function selectedRange(kind: Kind, anchor: string, from: string, through: string): Range {
  try {
    if (kind === 'month') return periodBounds(anchor, 'month');
    if (kind === 'week') {
      const start = weekStartFor(anchor);
      return { from: start, to: Temporal.PlainDate.from(start).add({ days: 7 }).toString() };
    }
    if (!from || !through) return { error: 'rangeMissing' };
    const start = Temporal.PlainDate.from(from);
    const end = Temporal.PlainDate.from(through).add({ days: 1 });
    const days = start.until(end).days;
    if (start.toString() !== from || Temporal.PlainDate.from(through).toString() !== through || days < 1 || days > 366) {
      return { error: 'rangeLength' };
    }
    return { from, to: end.toString() };
  } catch {
    return { error: 'rangeInvalid' };
  }
}

function freezeSnapshot(value: TimesheetSnapshot): TimesheetSnapshot {
  const freeze = <T,>(entry: T): T => {
    if (entry && typeof entry === 'object') {
      Object.values(entry).forEach(freeze);
      Object.freeze(entry);
    }
    return entry;
  };
  return freeze(structuredClone(value));
}

export function TimesheetDialog({ anchor, initialKind = 'month', preset, onLoad, onClose }: {
  anchor: string;
  initialKind?: 'month' | 'week';
  preset?: TimesheetPreset;
  onLoad: (from: string, toExclusive: string) => Promise<TimesheetSnapshot>;
  onClose: () => void;
}) {
  const { t, m, text, language } = useMessages(exportMessages);
  const { t: a } = useMessages(accountingExportMessages);
  const [kind, setKind] = useState<Kind>(preset?.kind ?? initialKind);
  const [date, setDate] = useState(preset?.from ?? anchor);
  const initial = preset ?? selectedRange(initialKind, anchor, '', '');
  const [from, setFrom] = useState(initial.from ?? anchor);
  const [through, setThrough] = useState(initial.to ? Temporal.PlainDate.from(initial.to).subtract({ days: 1 }).toString() : anchor);
  const [options, setOptions] = useState<TimesheetOptions>({ includeTitles: true, includeBlockNotes: false, includeDayNotes: false, includeWeekNotes: false, closedOnly: true, includeAccount: false, name: '' });
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ selection: Selection; snapshot?: TimesheetSnapshot; error?: TextValue } | null>(null);
  const [exportError, setExportError] = useState<TextValue>('');
  const load = useRef(onLoad);
  load.current = onLoad;
  const request = useRef<{ selection: Selection; promise: Promise<TimesheetSnapshot> } | null>(null);
  const generation = useRef(0);
  const range = selectedRange(kind, date, from, through);
  const rangeFrom = range.from;
  const rangeTo = range.to;
  const selection = useMemo(() => ({ from: rangeFrom, to: rangeTo, retry }), [rangeFrom, rangeTo, retry]);
  useEffect(() => {
    const id = ++generation.current;
    let active = true;
    setExportError('');
    const { from: requestedFrom, to: requestedTo } = selection;
    if (!requestedFrom || !requestedTo) return () => { active = false; };
    // Reuse only the current generation's request, including React's effect replay.
    if (request.current?.selection !== selection) {
      request.current = { selection, promise: Promise.resolve().then(() => load.current(requestedFrom, requestedTo)).then(freezeSnapshot) };
    }
    request.current.promise.then(snapshot => {
      if (active && generation.current === id) setResult({ selection, snapshot });
    }, error => {
      if (active && generation.current === id) setResult({ selection, error: errorText(error, m('loadError')) });
    });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a language switch must not reload the snapshot.
  }, [selection]);
  const snapshot = result?.selection === selection ? result.snapshot : undefined;
  const error = result?.selection === selection ? result.error : undefined;
  const loading = !!rangeFrom && !!rangeTo && !snapshot && !error;
  const canExport = !!snapshot && filteredTimesheetDays(snapshot, options).length > 0;
  const canPrint = canExport || (!!snapshot?.account?.opening && !!options.includeAccount);
  function chooseKind(next: Kind) {
    if (next === 'custom' && rangeFrom && rangeTo) {
      setFrom(rangeFrom);
      setThrough(Temporal.PlainDate.from(rangeTo).subtract({ days: 1 }).toString());
    }
    setKind(next);
  }
  function move(step: number) {
    setDate(Temporal.PlainDate.from(date).add(kind === 'week' ? { days: step * 7 } : { months: step }).toString());
  }
  function download() {
    if (!snapshot || !canExport) return;
    setExportError('');
    try {
      const blob = new Blob([timesheetCsv(snapshot, options, language)], { type: 'text/csv;charset=utf-8' });
      const filename = `${t('filename')}_${snapshot.from}_${Temporal.PlainDate.from(snapshot.to).subtract({ days: 1 }).toString()}.csv`;
      downloadBlob(blob, filename);
    } catch { setExportError(m('csvError')); }
  }
  function downloadAccount() {
    if (!snapshot?.account?.opening || !options.includeAccount) return;
    setExportError('');
    try {
      const blob = new Blob([accountCsv(snapshot, language)], { type: 'text/csv;charset=utf-8' });
      downloadBlob(blob, `${a('accountFilename')}_${snapshot.from}_${Temporal.PlainDate.from(snapshot.to).subtract({ days: 1 }).toString()}.csv`);
    } catch { setExportError(m('csvError')); }
  }
  return <>
    <Modal title={t('exportTitle')} onClose={onClose} className="workflow-modal timesheet-dialog">
      <div className="dialog-scroll timesheet-content">
        <div className="timesheet-controls">
          <div className="timesheet-period-controls">
            <div className="segmented" role="group" aria-label={t('periodType')}>{([['month', t('month')], ['week', t('week')], ['custom', t('custom')]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={kind === value} className={kind === value ? 'selected' : ''} onClick={() => chooseKind(value)}>{label}</button>)}</div>
            {kind === 'custom' ? <div className="timesheet-date-fields"><label className="field">{t('from')}<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label className="field">{t('through')}<input type="date" value={through} onChange={event => setThrough(event.target.value)} /></label></div>
              : <div className="timesheet-period-nav"><button type="button" className="icon-button" aria-label={t('previousPeriod')} onClick={() => move(-1)}>‹</button><label className="field">{t(kind === 'month' ? 'dateInMonth' : 'dateInWeek')}<input type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} /></label><button type="button" className="icon-button" aria-label={t('nextPeriod')} onClick={() => move(1)}>›</button></div>}
            {range.error && <p className="timesheet-validation" role="status">{t(range.error)}</p>}
          </div>
          <div className="timesheet-export-options"><label className="field">{t('name')} <span className="timesheet-optional">{t('optional')}</span><input type="text" maxLength={160} value={options.name} autoComplete="off" onChange={event => setOptions({ ...options, name: event.target.value })} /></label>
            <fieldset><legend>{t('content')}</legend>{([['includeTitles', t('includeTitles')], ['includeBlockNotes', t('includeBlockNotes')], ['includeDayNotes', t('includeDayNotes')], ['includeWeekNotes', t('includeWeekNotes')], ['closedOnly', t('closedOnly')]] as const).map(([field, label]) => <label className="timesheet-check" key={field}><input type="checkbox" checked={options[field]} onChange={event => setOptions({ ...options, [field]: event.target.checked })} />{label}</label>)}</fieldset>
            <label className="timesheet-check timesheet-account-option"><input type="checkbox" checked={!!options.includeAccount} onChange={event => setOptions({ ...options, includeAccount: event.target.checked })} />{a('includeAccount')}</label>
          </div>
        </div>
        <section className="timesheet-preview" aria-label={t('preview')} aria-busy={loading}>
          {loading && <p className="timesheet-loading" role="status">{t('loading')}</p>}
          {error && <div className="timesheet-load-error" role="alert"><p>{text(error)}</p><button type="button" className="button secondary" onClick={() => setRetry(value => value + 1)}>{t('retry')}</button></div>}
          {snapshot && <TimesheetDocument snapshot={snapshot} options={options} />}
        </section>
      </div>
      {exportError && <div className="workflow-feedback" role="alert">{text(exportError)}</div>}
      <footer className="dialog-actions workflow-actions timesheet-actions"><button type="button" className="button secondary" onClick={onClose}>{t('close')}</button><button type="button" className="button secondary" disabled={!canExport} onClick={download}><Download size={16} />CSV</button>{options.includeAccount && <button type="button" className="button secondary" disabled={!snapshot?.account?.opening} onClick={downloadAccount}><Download size={16} />{a('downloadAccount')}</button>}<button type="button" className="button primary" disabled={!canPrint} onClick={() => { if (!canPrint) return; setExportError(''); try { window.print(); } catch { setExportError(m('printError')); } }}><Printer size={16} />{t('print')}</button></footer>
    </Modal>
    {snapshot && canPrint && createPortal(<div className="timesheet-print" aria-hidden="true"><TimesheetDocument snapshot={snapshot} options={options} /></div>, document.body)}
  </>;
}
