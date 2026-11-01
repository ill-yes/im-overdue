import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Messages, MessageParams, TextValue } from '../shared/i18n.js';
import { activityDataSourceId, activityIsVisible, activityKey } from '../shared/data-sources.js';
import { dayReviewData, reviewRowTime } from '../shared/day-review.js';
import { monthOverview } from '../shared/month.js';
import type { Activity, AppState, DataSource } from '../shared/types.js';
import { Calendar, type CalendarProps } from '../src/calendar/Calendar.js';
import { MonthCalendar } from '../src/calendar/MonthCalendar.js';
import { ActivityDetailDialog } from '../src/calendar/ActivityDetailDialog.js';
import { calendarWeekDays } from '../src/calendar/week-view-model.js';
import { DayReview } from '../src/components/DayReview.js';

// Static rendering has no browser preference; select the catalog language
// explicitly so both accessible-label contracts are exercised.
const renderLanguage = vi.hoisted(() => ({ value: 'en' as 'en' | 'de' }));
vi.mock('../src/i18n.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/i18n.js')>();
  return { ...actual, useMessages: (catalog: Messages) => ({
    ...actual.useMessages(catalog), language: renderLanguage.value,
    locale: actual.languageLocale(renderLanguage.value),
    t: (key: string, params?: MessageParams) => actual.translate(catalog, key, params, renderLanguage.value),
    text: (value: TextValue) => actual.text(value, renderLanguage.value),
  }) };
});

const sources: DataSource[] = ['team', 'personal'].map((id, index) => ({
  id, type: 'github', name: index ? 'Mein GitHub' : 'Team GitHub', activityCount: 1,
  packageCount: 1, lastImportedAt: null, firstActivityStart: null, legacyCount: 0,
}));
const activities: Activity[] = sources.map((source, index) => ({
  source: 'github', dataSourceId: source.id, id: 'same-external-id',
  title: index ? 'Privater Commit' : 'Team Commit',
  start: index ? '2026-10-25T01:30:00Z' : '2026-10-25T00:30:00Z', end: null, url: null,
}));
function state(): AppState {
  return {
    revision: 0, undo: null, settings: { timezone: 'Europe/Berlin' }, dataSources: sources,
    profiles: [{ id: 'initial', effectiveFrom: null, weeklyMinutes: 2400, workdays: [1, 2, 3, 4, 5] }],
    activities, blocks: [{ id: 'work', start: '2026-10-25T08:00:00Z', end: '2026-10-25T09:00:00Z', title: '', note: '', createdAt: null }],
    templates: [], recentEntries: [], weeks: [{ weekStart: '2026-10-19', status: 'open' }],
    notes: [], vacations: [], vacationAllowances: [],
  };
}
const noop = () => {};
const decode = (value: string) => value.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
const attributeValues = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`\\b${name}="([^"]*)"`, 'g'))].map(match => decode(match[1]));

describe('named activity source identity', () => {
  it('distinguishes instances and preserves only unscoped legacy type filters', () => {
    expect(activityKey(activities[0])).not.toBe(activityKey(activities[1]));
    expect(activityIsVisible(activities[0], ['team'])).toBe(true);
    expect(activityIsVisible(activities[1], ['team'])).toBe(false);
    expect(activityIsVisible(activities[0], ['github'])).toBe(false);
    const legacy = { ...activities[0], dataSourceId: undefined };
    expect(activityDataSourceId(legacy)).toBe('legacy:github');
    expect(activityIsVisible(legacy, ['github'])).toBe(true);
    expect(activityIsVisible(legacy, ['legacy:github'])).toBe(true);
    expect(activityKey({ ...activities[0], dataSourceId: 'a:b', id: 'c' }))
      .not.toBe(activityKey({ ...activities[0], dataSourceId: 'a', id: 'b:c' }));
  });

  it('filters both repeated autumn clock hours independently without changing work totals', () => {
    const full = dayReviewData(state(), '2026-10-25', ['team', 'personal']);
    const personal = dayReviewData(state(), '2026-10-25', ['personal']);
    expect(full.rows.map(row => reviewRowTime(row, full.date, full.timezone)))
      .toEqual(['02:30 +02:00', '02:30 +01:00']);
    expect(personal.rows.map(row => activityKey(row.activity))).toEqual([activityKey(activities[1])]);
    expect(personal.totalActivityCount).toBe(2);
    expect(personal.totals).toEqual(full.totals);
    expect(personal.totals.actualMinutes).toBe(60);
    const [day] = calendarWeekDays(['2026-10-25'], state(), ['team', 'personal']);
    expect(day.bounds.minutes).toBe(1500);
    expect(day.evidence.map(group => group.top)).toEqual([140, 196]);
    expect(calendarWeekDays(['2026-10-25'], state(), ['personal'])[0].evidence
      .flatMap(group => group.activities)).toEqual([activities[1]]);
    const fullMonth = monthOverview(state(), '2026-10-01');
    const filteredMonth = monthOverview(state(), '2026-10-01', ['personal']);
    expect(fullMonth.activityCount).toBe(2);
    expect(filteredMonth.activityCount).toBe(1);
    expect(filteredMonth.summary).toEqual(fullMonth.summary);
    expect(fullMonth.days.find(day => day.date === '2026-10-25')).toMatchObject({
      activitySources: ['github'], activitySourceNames: ['Team GitHub', 'Mein GitHub'],
    });
  });

  it('targets just the requested instance and renders unique marker and review identities', () => {
    const props: CalendarProps = {
      state: state(), weekStart: '2026-10-19', enabledSources: ['team', 'personal'], busy: false,
      activityFocus: { date: '2026-10-25', source: 'github', dataSourceId: 'personal', id: 'same-external-id', requestId: 1 },
      onCreate: noop, onUpdate: async () => {}, onEdit: noop, onNew: noop, onNote: noop,
    };
    const html = renderToStaticMarkup(createElement(Calendar, props));
    expect(attributeValues(html, 'data-activity-key')).toEqual(activities.map(activityKey));
    const focused = html.match(/<button\b[^>]*data-focused-activity="true"[^>]*>/g) ?? [];
    expect(focused).toHaveLength(1);
    expect(attributeValues(focused[0]!, 'data-activity-key')).toEqual([activityKey(activities[1])]);
    expect(html).toContain('Team GitHub');
    expect(html).toContain('Mein GitHub');
    const review = renderToStaticMarkup(createElement(DayReview, {
      state: state(), date: '2026-10-25', enabledSources: ['team', 'personal'], busy: false,
      onSelectDay: noop, onShowActivity: noop, onNew: noop, onNote: noop, onClose: noop,
    }));
    expect(attributeValues(review, 'data-review-activity')).toEqual(activities.map(activityKey));
    expect(review).toContain('Team GitHub');
    expect(review).toContain('Mein GitHub');
  });

  it.each(['en', 'de'] as const)('renders configured source names in %s details and month accessible labels', language => {
    renderLanguage.value = language;
    const detail = renderToStaticMarkup(createElement(ActivityDetailDialog, {
      activities, sources, zone: 'Europe/Berlin', dialogRef: null, onClose: noop,
    }));
    expect(attributeValues(detail, 'data-detail-activity')).toEqual(activities.map(activityKey));
    expect(detail).toContain('Team GitHub');
    expect(detail).toContain('Mein GitHub');
    const month = renderToStaticMarkup(createElement(MonthCalendar, {
      overview: monthOverview(state(), '2026-10-01'), notes: [], today: '2026-10-25', onSelectDay: noop,
    }));
    expect(attributeValues(month, 'aria-label').some(label => label.includes(language === 'de' ? 'aus Team GitHub, Mein GitHub' : 'from Team GitHub, Mein GitHub'))).toBe(true);
    renderLanguage.value = 'en';
  });
});
