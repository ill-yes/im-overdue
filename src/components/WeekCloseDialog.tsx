import { useMessages, errorText, type TextValue } from '../i18n';
import { workflows } from '../locales/workflows';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { WeekReview } from '../../shared/types.js';
import { weekReviewKey } from '../../shared/week-review.js';
import { longDate, weekLabel } from '../format';
import { Modal } from './Modal';
import './week-close-dialog.css';

export function WeekCloseDialog({ weekStart, revision, onLoad, busy, requestError, onConfirm, onReviewDay, onClose }: {
  weekStart: string;
  revision: number;
  onLoad: (week: string) => Promise<WeekReview>;
  busy: boolean;
  requestError: string;
  onConfirm: (expectedRevision: number, reviewKey: string) => Promise<boolean>;
  onReviewDay: (date: string) => void;
  onClose: () => void;
}) {
  const { t, m, text: renderText, locale } = useMessages(workflows);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    week: string;
    sourceRevision: number;
    attempt: number;
    review?: WeekReview;
    error?: TextValue;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<TextValue>('');
  const [updated, setUpdated] = useState(false);
  const pendingRef = useRef(false);
  const reviewKeyRef = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const generation = ++loadGeneration.current;
    setLoaded(null);
    void (async () => {
      try {
        const review = await onLoadRef.current(weekStart);
        if (!mounted.current || generation !== loadGeneration.current) return;
        if (review.weekStart !== weekStart) {
          setLoaded({ week: weekStart, sourceRevision: revision, attempt: loadAttempt, error: m('weekWrong') });
          return;
        }
        const key = weekReviewKey(review);
        if (reviewKeyRef.current !== null && reviewKeyRef.current !== key) {
          setAcknowledged(null);
          setUpdated(true);
        }
        reviewKeyRef.current = key;
        setLoaded({ week: weekStart, sourceRevision: revision, attempt: loadAttempt, review });
      } catch (issue) {
        if (!mounted.current || generation !== loadGeneration.current) return;
        setLoaded({ week: weekStart, sourceRevision: revision, attempt: loadAttempt, error: errorText(issue, m('weekLoadFailed')) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bumping the live generation invalidates the pending load.
    return () => { loadGeneration.current++; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a language switch must not reload the review.
  }, [weekStart, revision, loadAttempt]);
  const currentLoad = loaded?.week === weekStart && loaded.sourceRevision === revision && loaded.attempt === loadAttempt ? loaded : null;
  const review = currentLoad?.review;
  const reviewKey = review ? weekReviewKey(review) : null;
  const loading = !review && !currentLoad?.error;
  const needsAcknowledgment = !!review && (review.warnings.length > 0 || review.requiresCurrentConfirmation);
  const checked = reviewKey !== null && acknowledged === reviewKey;
  const dates = review ? [...new Set(review.warnings.map(warning => warning.date))].sort() : [];
  const close = () => { if (!pendingRef.current) onClose(); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current || busy || !review || !reviewKey || (needsAcknowledgment && !checked)) return;
    const expectedRevision = review.revision;
    pendingRef.current = true;
    setPending(true);
    setLocalError('');
    try {
      const ok = await onConfirm(expectedRevision, reviewKey);
      if (!ok && mounted.current) {
        setAcknowledged(null);
        setUpdated(false);
        setLoaded(null);
        setLoadAttempt(value => value + 1);
      }
    }
    catch (issue) { if (mounted.current) setLocalError(errorText(issue, m('weekCloseFailed'))); }
    finally { pendingRef.current = false; if (mounted.current) setPending(false); }
  };
  return <Modal title={t('closeWeek')} onClose={close} closeDisabled={pending} className="week-close-dialog">
    <form className="dialog-content" aria-label={t('weekReview')} aria-busy={loading} onSubmit={submit}>
      <p className="week-close-period">{weekLabel(weekStart)}</p>
      <p className="muted small">{t('weekReviewHelp')}</p>
      {loading && <p className="week-close-loading small" role="status">{t('weekReviewLoading')}</p>}
      {currentLoad?.error && <div className="week-close-load-error"><p className="form-error" role="alert">{renderText(currentLoad.error)}</p><button type="button" className="button secondary" disabled={pending} onClick={() => setLoadAttempt(value => value + 1)}>{t('weekReload')}</button></div>}
      {review && <>
      {review.requiresCurrentConfirmation && <p className="week-close-notice small"><strong>{t('weekCurrent')}</strong> {t('currentWeekDetail')}</p>}
      {updated && <p className="week-close-updated small" role="status">{t('weekUpdated')}</p>}
      {dates.length > 0 ? <div className="week-close-days">{dates.map(date => <section className="week-close-day" key={date} aria-label={longDate(date)}><div><h3>{longDate(date)}</h3><button type="button" className="button secondary" disabled={pending} onClick={() => { if (!pendingRef.current) onReviewDay(date); }}>{t('reviewDay')}</button></div><ul>{review.warnings.filter(warning => warning.date === date).map((warning, index) => <li key={`${warning.kind}-${index}`}><span>{t(warning.kind === 'missing' ? 'warningMissing' : warning.kind === 'long' ? 'warningLong' : warning.count === 1 ? 'warningEvidenceOne' : 'warningEvidenceMany', { count: number(warning.count ?? 0) })}</span>{warning.count !== undefined && <small>{t(warning.count === 1 ? 'warningsOne' : 'warningsMany', { count: number(warning.count) })}</small>}</li>)}</ul></section>)}</div> : <p className="week-close-clear small">{t('weekClear')}</p>}
      {needsAcknowledgment && <label className="week-close-ack"><input type="checkbox" checked={checked} disabled={pending} onChange={event => setAcknowledged(event.target.checked ? reviewKey : null)} /><span>{t('warningsReviewed')}{review.requiresCurrentConfirmation && <small>{t('confirmFullTarget')}</small>}</span></label>}
      </>}
      {pending && <p className="muted small" role="status">{t('weekPending')}</p>}
      {(localError || requestError) && <p className="form-error" role="alert">{renderText(localError) || requestError}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={pending} onClick={close}>{t('cancel')}</button>{review && <button type="submit" className="button primary" disabled={busy || pending || (needsAcknowledgment && !checked)}>{t('closeWeek')}</button>}</div>
    </form>
  </Modal>;
}
