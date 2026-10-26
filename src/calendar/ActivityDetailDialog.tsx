import { useMessages } from '../i18n.js';
import { calendarMessages } from '../locales/calendar.js';
import type { Ref } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { localTimeWithOffset as timeLabel } from '../../shared/time.js';
import type { Activity, DataSource } from '../../shared/types.js';
import { activityKey, activitySourceName } from '../../shared/data-sources.js';
import { safeExternalUrl } from '../links.js';

interface ActivityDetailDialogProps {
  activities: Activity[];
  sources?: DataSource[];
  zone: string;
  dialogRef: Ref<HTMLDialogElement>;
  onClose: () => void;
}

/** The calendar owns modal timing and focus restoration; this component renders its content. */
export function ActivityDetailDialog({ activities: detail, sources = [], zone, dialogRef, onClose }: ActivityDetailDialogProps) {
  const { t } = useMessages(calendarMessages);
  return (
    <dialog
      className="ov-detail"
      ref={dialogRef}
      aria-label={t('activityDetails')}
      onCancel={onClose}
    >
      <header>
        <div>
          <span>{t('activities')}</span>
          <h2>{detail.length === 1 ? activitySourceName(detail[0], sources) : t('entryCount', { count: detail.length })}</h2>
        </div>
        <button type="button" aria-label={t('close')} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="ov-detail-list">
        {detail.map((activity) => (
          <article key={activityKey(activity)} data-detail-activity={activityKey(activity)}>
            <div className="ov-detail-meta">
              <span>{activitySourceName(activity, sources)}</span>
              <span>
                {timeLabel(activity.start, zone)}
                {activity.end ? ` – ${timeLabel(activity.end, zone)}` : ''}
              </span>
            </div>
            <h3>{activity.title}</h3>
            {safeExternalUrl(activity.url) && (
              <a
                href={safeExternalUrl(activity.url)!}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                {t('openSource')} <ExternalLink size={14} />
              </a>
            )}
          </article>
        ))}
      </div>
      <footer>
        <button type="button" onClick={onClose}>
          {t('close')}
        </button>
      </footer>
    </dialog>
  );
}
