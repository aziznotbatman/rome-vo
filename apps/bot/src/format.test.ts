import type { SessionRow } from '@romevo/core/queries';
import { describe, expect, it } from 'vitest';
import { renderListing } from './format.ts';
import { t } from './i18n.ts';

function row(over: Partial<SessionRow>): SessionRow {
  return {
    sessionId: 1, startsAt: new Date('2026-10-19T19:15:00Z'), cinemaDay: '2026-10-19', bookingUrl: 'https://x.test/b?a=1&b=2',
    room: 'Sala 1', languageClass: 'vo', confidence: 0.95, audioLanguage: null, filmId: 1, filmGroup: 'Q1', filmTitle: 'Fatherland',
    originalTitle: null, originalLanguage: 'de', year: 2026, posterUrl: null, cinemaId: 1, cinemaSlug: 'qf', cinemaName: 'Quattro Fontane',
    area: 'Centro', lat: 41.9, lon: 12.49, cinemaStatus: 'ok', ...over,
  };
}

describe('renderListing', () => {
  const str = t('en');

  it('groups by film then cinema with Rome times as booking links', () => {
    const { pages, filmCount } = renderListing('Today', [row({}), row({ sessionId: 2, startsAt: new Date('2026-10-19T17:00:00Z') })], {}, str, false);
    expect(filmCount).toBe(1);
    expect(pages[0]).toContain('<b>Fatherland</b> <i>DE · 2026</i>');
    expect(pages[0]).toContain('Quattro Fontane · Centro — <a href="https://x.test/b?a=1&amp;b=2">21:15</a> <a href="https://x.test/b?a=1&amp;b=2">19:00</a>');
  });

  it('marks low-confidence times and puts unconfirmed films last', () => {
    const rows = [
      row({ filmGroup: 'U', filmTitle: 'BTS', languageClass: 'unknown', confidence: 0, originalLanguage: null }),
      row({ confidence: 0.4 }),
    ];
    const page = renderListing('Today', rows, {}, str, false).pages[0]!;
    expect(page.indexOf('Fatherland')).toBeLessThan(page.indexOf('BTS'));
    expect(page).toContain('21:15</a>⚠️');
    expect(page).toContain(str.unconfirmed);
  });

  it('shows distance when the user shared a location and flags stale cinemas', () => {
    const page = renderListing('Today', [row({ cinemaStatus: 'degraded' })], { lat: 41.9, lon: 12.5 }, str, false).pages[0]!;
    expect(page).toMatch(/Quattro Fontane · 0\.\d km <i>\(data may be stale\)<\/i>/);
  });

  it('paginates long listings', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ filmGroup: `Q${i}`, filmTitle: `Film ${i}`, sessionId: i }));
    expect(renderListing('Week', rows, {}, str, true).pages.length).toBe(3);
  });

  it('says so when nothing matches', () => {
    expect(renderListing('Today', [], {}, str, false).pages[0]).toContain(str.noSessions);
  });
});
