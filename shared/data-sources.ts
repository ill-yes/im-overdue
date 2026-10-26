import type { Activity, DataSource, Source } from './types.js';

export const SOURCE_LABELS: Record<Source, string> = {
  google_calendar: 'Google Kalender', slack: 'Slack', github: 'GitHub', other: 'Sonstige',
};
export const legacyDataSourceId = (source: Source) => `legacy:${source}`;
export const activityDataSourceId = (activity: Pick<Activity, 'source' | 'dataSourceId'>) =>
  activity.dataSourceId ?? legacyDataSourceId(activity.source);
export const activityKey = (activity: Pick<Activity, 'source' | 'id' | 'dataSourceId'>) =>
  JSON.stringify([activityDataSourceId(activity), activity.id]);
export function activitySourceName(activity: Pick<Activity, 'source' | 'dataSourceId'>, sources: readonly DataSource[] = []): string {
  return sources.find(source => source.id === activityDataSourceId(activity))?.name ?? SOURCE_LABELS[activity.source];
}
/** Type-only filters remain valid for legacy, unscoped in-memory inputs. */
export function activityIsVisible(activity: Pick<Activity, 'source' | 'dataSourceId'>, enabled: readonly string[]): boolean {
  return enabled.includes(activityDataSourceId(activity)) || (!activity.dataSourceId && enabled.includes(activity.source));
}
