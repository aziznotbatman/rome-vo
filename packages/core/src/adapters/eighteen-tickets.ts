import * as cheerio from 'cheerio';
import { fetchText } from '../http.ts';
import { errorMessage } from '../log.ts';
import { decodeEntities } from '../normalize.ts';
import { epochMsToIso } from '../time.ts';
import type { CinemaResult, RawSession, Signal } from '../types.ts';
import { inRange, type SourceAdapter } from './types.ts';

/** Undo the JS string escaping in `$("#sel").html('...')` (Rails UJS responses). */
function unescapeJs(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) => {
    if (c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
    return c === 'n' ? '\n' : c === 't' ? '\t' : c;
  });
}

/** Extract HTML fragments by selector from a fetch_films JS response. */
export function extractFragments(js: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\$\("([^"]+)"\)\.html\('((?:\\.|[^\\'])*)'\)/g;
  for (const m of js.matchAll(re)) out.set(m[1] ?? '', unescapeJs(m[2] ?? ''));
  return out;
}

export interface EighteenTicketsDay {
  readonly advertisedDates: string[];
  readonly entries: FilmEntry[];
}

interface FilmEntry {
  readonly filmId: string | null;
  readonly title: string;
  readonly labels: string[];
  readonly lingua: string | null;
  readonly director: string | null;
  readonly posterUrl: string | null;
  readonly shows: { cinemaName: string; address: string | null; epochMs: number; bookingUrl: string; room: string | null }[];
}

function clean(s: string): string {
  return decodeEntities(s.replace(/\s+/g, ' ').trim());
}

/** Parse one fetch_films response into film entries (one per language version). */
export function parseFetchFilms(js: string): EighteenTicketsDay {
  const fragments = extractFragments(js);
  const dates = cheerio.load(fragments.get('#date-baloons') ?? '');
  const advertisedDates = dates('[data-target]')
    .map((_, el) => dates(el).attr('data-target') ?? '')
    .get()
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

  const $ = cheerio.load(fragments.get('#movie-list') ?? '');
  const entries: FilmEntry[] = $('.movie.movie--preview')
    .map((_, el) => {
      const movie = $(el);
      const titleLink = movie.find('a.movie__title').first();
      const option = (label: string): string | null => {
        const p = movie.find('p.movie__option').filter((_, o) => $(o).find('strong').text().trim().startsWith(label));
        if (!p.length) return null;
        return clean(p.first().text()).replace(new RegExp(`^${label}:\\s*`), '') || null;
      };
      const shows = movie
        .find('.time-select__place')
        .map((_, place) => {
          const $place = $(place);
          const address = $place.find('a[title]').attr('title') ?? null;
          const cinemaName = decodeEntities($place.contents().last().text().trim());
          return $place
            .parent()
            .next()
            .find('a[data-time]')
            .map((_, a) => {
              const li = $(a).find('li');
              const parts = li.html()?.split(/<br\s*\/?>/i) ?? [];
              const room = parts[1] ? decodeEntities(cheerio.load(parts[1]).text().trim()) : null;
              return { cinemaName, address, epochMs: Number($(a).attr('data-time')), bookingUrl: $(a).attr('href') ?? '', room };
            })
            .get();
        })
        .get();
      return {
        filmId: /\/film\/(\d+)/.exec(titleLink.attr('href') ?? '')?.[1] ?? null,
        title: clean(titleLink.text()),
        labels: movie.find('.film-label').map((_, l) => clean($(l).text())).get(),
        lingua: option('Lingua'),
        director: option('Regia'),
        posterUrl: movie.find('.movie__images img').attr('src') ?? null,
        shows,
      };
    })
    .get();
  return { advertisedDates, entries };
}

const UUID = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Turn parsed entries into sessions for the cinemas we track (matched by displayed name). */
export function toSessions(day: EighteenTicketsDay, cinemaByName: ReadonlyMap<string, string>): RawSession[] {
  return day.entries.flatMap((e) => {
    const signals: Signal[] = [
      { kind: 'title', value: e.title },
      ...e.labels.map((l): Signal => ({ kind: 'label', value: l })),
      ...(e.lingua ? [{ kind: 'lingua_field', value: e.lingua } as const] : []),
    ];
    return e.shows.flatMap((s) => {
      const cinemaSlug = cinemaByName.get(s.cinemaName.toLowerCase());
      if (!cinemaSlug || !Number.isFinite(s.epochMs)) return [];
      return [
        {
          cinemaSlug,
          sourceSessionId: UUID.exec(s.bookingUrl)?.[1] ?? `${e.filmId}:${s.epochMs}`,
          startsAt: epochMsToIso(s.epochMs),
          title: e.title,
          director: e.director,
          posterUrl: e.posterUrl,
          bookingUrl: s.bookingUrl || null,
          room: s.room,
          signals,
        },
      ];
    });
  });
}

const fetchDay = (host: string, date: string): Promise<string> =>
  fetchText(`https://${host}/film/fetch_films?date=${date}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/javascript, application/javascript' },
  });

export const eighteenTicketsAdapter: SourceAdapter = async (source, ctx) => {
  if (!source.host) throw new Error(`source ${source.id} needs a host`);
  const host = source.host;
  const cinemaByName = new Map(source.cinemas.map((c) => [c.match.toLowerCase(), c.slug]));
  const sessions: RawSession[] = [];
  const errors: { cinemaSlug: string | null; message: string }[] = [];

  const first = parseFetchFilms(await fetchDay(host, ctx.range.from));
  const advertised = first.advertisedDates.filter((d) => inRange(d, ctx.range));
  sessions.push(...toSessions(first, cinemaByName));
  for (const date of advertised.filter((d) => d !== ctx.range.from)) {
    try {
      sessions.push(...toSessions(parseFetchFilms(await fetchDay(host, date)), cinemaByName));
    } catch (error: unknown) {
      errors.push({ cinemaSlug: null, message: `${host} ${date}: ${errorMessage(error)}` });
    }
  }
  // Advertised dates are per host; in a multi-cinema circuit they say nothing about one cinema.
  const perCinemaDates = source.cinemas.length === 1 ? advertised : null;
  const cinemas: CinemaResult[] = source.cinemas.map((c) => ({
    cinemaSlug: c.slug,
    sessions: sessions.filter((s) => s.cinemaSlug === c.slug),
    advertisedDates: perCinemaDates,
  }));
  return { cinemas, errors };
};
