import * as cheerio from 'cheerio';
import { fetchText } from '../http.ts';
import { mentionsOriginalLanguage } from '../classifier.ts';
import { decodeEntities } from '../normalize.ts';
import { resolveDayMonth, romeLocalToIso } from '../time.ts';
import type { CinemaResult, RawSession } from '../types.ts';
import { inRange, type SourceAdapter } from './types.ts';

/** NVR Cinema ("cvu" platform): one page per cinema, e.g. /adriano/ and /atlantic/. */
const SITE = 'https://www.nvrcinema.it';

/** Parse a cinema page: `.filmContainer` blocks with `.hours` items like "Martedì 27/10" + times. */
export function parseNvrPage(cinemaSlug: string, html: string, today: string): RawSession[] {
  const $ = cheerio.load(html);
  const webtic = $('.webtic').attr('id') ?? null;
  return $('.filmContainer')
    .map((_, el) => {
      const film = $(el);
      const title = decodeEntities(film.find('.titolo').clone().children('.newMovie').remove().end().text().replace(/\s+/g, ' ').trim());
      const director = film.find('.regia').text().replace(/^\s*Regia:\s*/, '').trim() || null;
      const runtime = Number(/(\d+)/.exec(film.find('.durata').text())?.[1]) || null;
      const idFilm = film.find('.scheda').attr('idfilm') ?? null;
      return film
        .find('.hours')
        .map((_, h) => {
          const day = /(\d{1,2})\/(\d{1,2})/.exec($(h).find('.dayName').text());
          if (!day) return [];
          const date = resolveDayMonth(Number(day[1]), Number(day[2]), today);
          return $(h)
            .find('span[idcalend]')
            .map((_, t): RawSession | null => {
              const time = /^(\d{1,2})[:.](\d{2})$/.exec($(t).text().trim());
              if (!time) return null;
              const idcalend = $(t).attr('idcalend') ?? '0';
              return {
                cinemaSlug,
                sourceSessionId: idcalend !== '0' ? idcalend : null,
                startsAt: romeLocalToIso(`${date} ${time[1]!.padStart(2, '0')}:${time[2]}`),
                title,
                director,
                runtimeMin: runtime,
                posterUrl: idFilm ? `${SITE}/cvu/modules/img_switcher.php?idfilm=${idFilm}&type=446&ext=jpg` : null,
                bookingUrl: webtic && idcalend !== '0' ? `${SITE}/generic/seatsframe.php?sc=${webtic}&sp=${idcalend}#seatsframe` : null,
                // NVR tags VO consistently ("| ORIGINAL VERSION"); anything untagged is the Italian version.
                signals: [{ kind: 'title', value: title }, ...(mentionsOriginalLanguage(title) ? [] : [{ kind: 'untagged' as const, value: 'nvr' }])],
              };
            })
            .get()
            .filter((s): s is RawSession => s !== null);
        })
        .get();
    })
    .get();
}

export const nvrAdapter: SourceAdapter = async (source, ctx) => {
  const cinemas: CinemaResult[] = [];
  const errors: { cinemaSlug: string; message: string }[] = [];
  for (const cinema of source.cinemas) {
    const html = await fetchText(`${SITE}/${cinema.match}/`);
    if (!html.includes('filmContainer')) {
      errors.push({ cinemaSlug: cinema.slug, message: 'no filmContainer blocks (layout change?)' });
      continue;
    }
    const sessions = parseNvrPage(cinema.slug, html, ctx.today).filter((s) => inRange(s.startsAt.slice(0, 10), ctx.range));
    cinemas.push({ cinemaSlug: cinema.slug, sessions, advertisedDates: null });
  }
  return { cinemas, errors };
};
