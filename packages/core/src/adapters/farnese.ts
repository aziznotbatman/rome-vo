import * as cheerio from 'cheerio';
import { fetchText } from '../http.ts';
import { decodeEntities } from '../normalize.ts';
import { romeLocalToIso } from '../time.ts';
import type { RawSession } from '../types.ts';
import { inRange, type SourceAdapter } from './types.ts';

const HOME = 'https://www.cinemafarnese.it/';

/** Parse the "Oggi in Sala" day blocks: each time carries its own "ita" / "vos ita" tag. */
export function parseFarneseHome(cinemaSlug: string, html: string): { sessions: RawSession[]; advertisedDates: string[] } {
  const $ = cheerio.load(html);
  const advertisedDates = $('#days_home span[rel]')
    .map((_, el) => $(el).attr('rel') ?? '')
    .get()
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

  const sessions = $('#movies_per_day .movie')
    .map((_, el) => {
      const block = $(el);
      const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(block.attr('class') ?? '')?.[1];
      if (!date) return [];
      const title = decodeEntities(block.find('.titolo_movie').text().trim());
      const bookingUrl = block.find('a.acquista').first().attr('href') ?? null;
      const posterUrl = block.find('img').first().attr('src') ?? null;
      return block
        .find('.movie_orari')
        .map((_, t): RawSession | null => {
          const m = /^(\d{1,2}):(\d{2})\s*(.*)$/.exec($(t).text().trim());
          if (!m) return null;
          const hhmm = `${m[1]!.padStart(2, '0')}:${m[2]}`;
          return {
            cinemaSlug,
            sourceSessionId: null,
            startsAt: romeLocalToIso(`${date} ${hhmm}`),
            title,
            posterUrl,
            bookingUrl,
            signals: [
              { kind: 'title', value: title },
              { kind: 'time_tag', value: m[3] ?? '' },
            ],
          };
        })
        .get()
        .filter((s): s is RawSession => s !== null);
    })
    .get();
  return { sessions, advertisedDates };
}

export const farneseAdapter: SourceAdapter = async (source, ctx) => {
  const cinema = source.cinemas[0];
  if (!cinema) throw new Error('farnese source needs one cinema');
  const { sessions, advertisedDates } = parseFarneseHome(cinema.slug, await fetchText(HOME));
  return {
    cinemas: [
      {
        cinemaSlug: cinema.slug,
        sessions: sessions.filter((s) => inRange(s.startsAt.slice(0, 10), ctx.range)),
        // The day picker always lists 7 days even when later days are empty, so it is not a health signal.
        advertisedDates: null,
      },
    ],
    errors: advertisedDates.length === 0 ? [{ cinemaSlug: cinema.slug, message: 'Farnese day picker missing (layout change?)' }] : [],
  };
};
