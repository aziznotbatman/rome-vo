import { z } from 'zod';
import { CookieJar, fetchJson, fetchText, HttpError } from '../http.ts';
import { errorMessage } from '../log.ts';
import type { CinemaResult, RawSession, Signal } from '../types.ts';
import { inRange, type SourceAdapter } from './types.ts';

const SITE = 'https://www.thespacecinema.it';
const API = `${SITE}/api/microservice/showings`;
/** Any public HTML page hands out the anonymous `microservicesToken` session cookie. */
const COOKIE_PAGE = `${SITE}/cinema/roma-moderno/al-cinema`;

const attributeSchema = z.object({ name: z.string(), attributeType: z.string() });

const filmsSchema = z.object({
  result: z.array(
    z.object({
      filmId: z.string(),
      filmTitle: z.string(),
      originalTitle: z.string().nullable().optional(),
      director: z.string().nullable().optional(),
      releaseDate: z.string().nullable().optional(),
      runningTime: z.number().nullable().optional(),
      posterImageSrc: z.string().nullable().optional(),
      showingGroups: z.array(
        z.object({
          sessions: z.array(
            z.object({
              sessionId: z.string(),
              bookingUrl: z.string().nullable(),
              showTimeWithTimeZone: z.string(),
              screenName: z.string().nullable().optional(),
              attributes: z.array(attributeSchema),
            }),
          ),
        }),
      ),
    }),
  ),
});

const datesSchema = z.object({ result: z.array(z.object({ showingDate: z.string(), hasShowings: z.boolean() })) });

/** Parse one /cinemas/{id}/films response. */
export function parseTheSpaceFilms(cinemaSlug: string, payload: unknown): RawSession[] {
  return filmsSchema.parse(payload).result.flatMap((film) =>
    film.showingGroups.flatMap((g) =>
      g.sessions.map((s): RawSession => {
        const signals: Signal[] = [
          { kind: 'title', value: film.filmTitle },
          ...s.attributes
            .filter((a) => a.attributeType === 'Language' && a.name)
            .map((a): Signal => ({ kind: 'structured_language', value: a.name })),
        ];
        return {
          cinemaSlug,
          sourceSessionId: s.sessionId,
          startsAt: s.showTimeWithTimeZone,
          title: film.filmTitle,
          originalTitle: film.originalTitle || null,
          director: film.director || null,
          year: film.releaseDate ? Number(film.releaseDate.slice(0, 4)) : null,
          runtimeMin: film.runningTime ?? null,
          posterUrl: film.posterImageSrc ?? null,
          bookingUrl: s.bookingUrl ? SITE + s.bookingUrl : null,
          room: s.screenName ?? null,
          signals,
        };
      }),
    ),
  );
}

export function parseShowingDates(payload: unknown): string[] {
  return datesSchema
    .parse(payload)
    .result.filter((d) => d.hasShowings)
    .map((d) => d.showingDate.slice(0, 10));
}

export const theSpaceAdapter: SourceAdapter = async (source, ctx) => {
  const cookies = new CookieJar();
  const getJson = async (url: string): Promise<unknown> => {
    try {
      return await fetchJson(url, { cookies });
    } catch (error: unknown) {
      if (!(error instanceof HttpError) || error.status !== 401) throw error;
      cookies.clear(); // token expired: get a fresh anonymous session once
      await fetchText(COOKIE_PAGE, { cookies });
      return fetchJson(url, { cookies });
    }
  };
  await fetchText(COOKIE_PAGE, { cookies });

  const cinemas: CinemaResult[] = [];
  const errors: { cinemaSlug: string; message: string }[] = [];
  for (const cinema of source.cinemas) {
    try {
      const id = cinema.match;
      const dates = parseShowingDates(await getJson(`${API}/showingDates?cinemaId=${id}&minEmbargoLevel=2&forNextWeek=true`)).filter((d) =>
        inRange(d, ctx.range),
      );
      const sessions: RawSession[] = [];
      for (const date of dates) {
        const url = `${API}/cinemas/${id}/films?showingDate=${date}T00:00:00&minEmbargoLevel=3&includesSession=true&includeSessionAttributes=true`;
        sessions.push(...parseTheSpaceFilms(cinema.slug, await getJson(url)));
      }
      cinemas.push({ cinemaSlug: cinema.slug, sessions, advertisedDates: dates });
    } catch (error: unknown) {
      errors.push({ cinemaSlug: cinema.slug, message: errorMessage(error) });
    }
  }
  return { cinemas, errors };
};
