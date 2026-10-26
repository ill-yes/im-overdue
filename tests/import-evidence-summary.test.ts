import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImportEvidenceSummary } from '../src/components/import/ImportEvidenceSummary';

describe('import evidence summary', () => {
  it.each(['Keine gültigen Aktivitäten', '—'])('keeps the stage-specific empty period text: %s', (emptyPeriodLabel) => {
    const html = renderToStaticMarkup(createElement(ImportEvidenceSummary, {
      period: null, timezone: 'Europe/Berlin', sources: [], emptyPeriodLabel, language: 'de',
    }));
    expect(html).toBe(`<div class="imp-evidence"><div><small>Belegzeitraum</small><strong>${emptyPeriodLabel}</strong></div><div><small>Quellen</small><strong>—</strong></div></div>`);
  });

  it('shows assigned source names and preserves source order and fallback labels', () => {
    const html = renderToStaticMarkup(createElement(ImportEvidenceSummary, {
      period: null,
      timezone: 'Europe/Berlin',
      sources: [['github', 2], ['slack', 1]],
      sourceNames: { github: 'Arbeit (GitHub)' },
      emptyPeriodLabel: '—',
      language: 'de',
    }));
    expect(html).toContain('<small>Quellen</small><strong>Arbeit (GitHub) 2 · Slack 1</strong>');
  });

  it('formats the same evidence in the supplied preview or current result zone', () => {
    const period = {
      first: '2026-10-25T00:30:00.000000001Z',
      last: '2026-10-25T01:45:00Z',
      openDate: '2026-10-25',
    };
    const render = (timezone: string) => renderToStaticMarkup(createElement(ImportEvidenceSummary, {
      period, timezone, sources: [], emptyPeriodLabel: '—', language: 'de',
    }));
    expect(render('Europe/Berlin')).toContain('25.10.2026 · 02:30:00.000000001 +02:00 – 25.10.2026 · 02:45 +01:00');
    expect(render('America/Los_Angeles')).toContain('24.10.2026 · 17:30:00.000000001 -07:00 – 24.10.2026 · 18:45 -07:00');
  });

  it('renders English labels and dates without translating assigned source names or changing instants', () => {
    const html = renderToStaticMarkup(createElement(ImportEvidenceSummary, {
      period: { first: '2026-10-25T00:30:00.000000001Z', last: '2026-10-25T01:45:00Z', openDate: '2026-10-25' },
      timezone: 'Europe/Berlin', sources: [['google_calendar', 1000]],
      sourceNames: { google_calendar: 'Kalender Verein / Club' }, emptyPeriodLabel: '—', language: 'en',
    }));
    expect(html).toContain('<small>Evidence period</small>');
    expect(html).toContain('<small>Sources</small><strong>Kalender Verein / Club 1,000</strong>');
    expect(html).toContain('02:30:00.000000001 +02:00');
    expect(html).toContain('02:45 +01:00');
    expect(html).not.toContain('25.10.2026');
  });
});
