import { Fragment, type Dispatch, type SetStateAction } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Activity, DataSource, ImportPreview } from '../../../shared/types.js';
import { activityKey } from '../../../shared/data-sources.js';
import { formatActivityDateTime, sourceLabel } from '../../format';
import { useMessages } from '../../i18n';
import { importMessages } from '../../locales/import';

const PAGE_SIZE = 50;

function ActivityFields({ activity, zone }: { activity: Activity; zone: string }) {
  const { t } = useMessages(importMessages);
  return (
    <dl className="imp-fields">
      <div>
        <dt>{t('start')}</dt>
        <dd>{formatActivityDateTime(activity.start, zone)}</dd>
      </div>
      <div>
        <dt>{t('end')}</dt>
        <dd>{activity.end ? formatActivityDateTime(activity.end, zone) : t('pointInTime')}</dd>
      </div>
      <div>
        <dt>{t('activityTitle')}</dt>
        <dd>{activity.title}</dd>
      </div>
      <div>
        <dt>{t('url')}</dt>
        <dd className="imp-break">{activity.url || '—'}</dd>
      </div>
    </dl>
  );
}

export function ImportPreviewRows({
  rows,
  previewZone,
  page,
  expandedRow,
  setPage,
  setExpandedRow,
  dataSources,
}: {
  rows: ImportPreview['rows'];
  previewZone: string;
  page: number;
  expandedRow: string | undefined;
  setPage: Dispatch<SetStateAction<number>>;
  setExpandedRow: Dispatch<SetStateAction<string | undefined>>;
  dataSources: DataSource[];
}) {
  const { t, locale } = useMessages(importMessages);
  const number = (value: number) => value.toLocaleString(locale);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  return (
    <>
      {rows.length > 0 ? (
        <div className="imp-table-wrap">
          <table className="imp-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader">{t('status')}</th>
                <th role="columnheader">{t('sourceId')}</th>
                <th role="columnheader">{t('time')}</th>
                <th role="columnheader">{t('activity')}</th>
                <th role="columnheader">{t('details')}</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row, i) => {
                const key = activityKey(row.activity);
                const dataSource = dataSources.find((entry) => entry.id === row.activity.dataSourceId);
                const expanded = expandedRow === key;
                const detailsId = `import-change-${page * PAGE_SIZE + i}`;
                return (
                  <Fragment key={key}>
                    <tr role="row" data-import-row="">
                      <td role="cell">
                        <span className="imp-mobile-label" aria-hidden="true">
                          {t('status')}
                        </span>
                        <span className="imp-cell-value">
                          <span className={`imp-status imp-status-${row.status}`}>
                            {t(row.status)}
                          </span>
                        </span>
                      </td>
                      <td role="cell">
                        <span className="imp-mobile-label" aria-hidden="true">
                          {t('sourceId')}
                        </span>
                        <span className="imp-cell-value">
                          <strong>{dataSource?.name ?? sourceLabel(row.activity.source)}</strong>
                          <small>{sourceLabel(row.activity.source)}</small>
                          <small title={row.activity.id}>{row.activity.id}</small>
                        </span>
                      </td>
                      <td role="cell">
                        <span className="imp-mobile-label" aria-hidden="true">
                          {t('time')}
                        </span>
                        <span className="imp-cell-value">
                          {formatActivityDateTime(row.activity.start, previewZone)}
                          {row.activity.end && (
                            <small>{t('until', { time: formatActivityDateTime(row.activity.end, previewZone) })}</small>
                          )}
                        </span>
                      </td>
                      <td role="cell" className="imp-title" title={row.activity.title}>
                        <span className="imp-mobile-label" aria-hidden="true">
                          {t('activity')}
                        </span>
                        <span className="imp-cell-value">{row.activity.title}</span>
                      </td>
                      <td role="cell">
                        <span className="imp-mobile-label" aria-hidden="true">
                          {t('details')}
                        </span>
                        <span className="imp-cell-value">
                          {row.status === 'updated' && row.previous ? (
                            <button
                              type="button"
                              className="imp-diff-toggle"
                              aria-expanded={expanded}
                              aria-controls={detailsId}
                              onClick={() => setExpandedRow(expanded ? undefined : key)}
                            >
                              {t('showChange')} <ChevronDown size={13} />
                            </button>
                          ) : (
                            '—'
                          )}
                        </span>
                      </td>
                    </tr>
                    {expanded && row.status === 'updated' && row.previous && (
                      <tr role="row" className="imp-diff" id={detailsId}>
                        <td role="cell" colSpan={5}>
                          <div className="imp-diff-grid">
                            <div>
                              <strong>{t('previous')}</strong>
                              <ActivityFields activity={row.previous} zone={previewZone} />
                            </div>
                            <div>
                              <strong>{t('new')}</strong>
                              <ActivityFields activity={row.activity} zone={previewZone} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="imp-empty">{t('noValidPreview')}</p>
      )}
      {rows.length > PAGE_SIZE && (
        <div className="imp-pagination">
          <span>
            {t('range', { first: number(page * PAGE_SIZE + 1), last: number(Math.min((page + 1) * PAGE_SIZE, rows.length)), count: number(rows.length) })}
          </span>
          <div>
            <button
              type="button"
              className="button secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              {t('previousPage')}
            </button>
            <span>
              {t('page', { page: number(page + 1), pages: number(pages) })}
            </span>
            <button
              type="button"
              className="button secondary"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('nextPage')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
