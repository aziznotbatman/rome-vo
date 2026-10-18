import { z } from 'zod';
import { fetchJson } from '../http.ts';
import { errorMessage } from '../log.ts';
import { datesInRange, romeLocalToIso } from '../time.ts';
import type { CinemaResult, RawSession, Signal } from '../types.ts';
import type { SourceAdapter } from './types.ts';

const BASE = 'https://myuci---uci-backend-production-nfluwp7wga-oc.a.run.app/api';
const BOOKING_BASE = 'https://ucicinemas.it';

const performanceSchema = z.object({
  id: z.number(),
  room: z.string().nullable(),
  day: z.string(),
  starts_at: z.string(),
  cart_link: z.string().nullable(),
});

const variantSchema = z.object({
  slug: z.string(),
  language: z.object({ slug: z.string(), name: z.string() }).nullable(),
  subtitles: z.object({ name: z.string() }).nullable(),
  duration: z.string().nullable().optional(),
  release_date: z.union([z.string(), z.number()]).nullable().optional(), // usually ISO, sometimes a Unix timestamp
  performances: z.array(performanceSchema),
});

const programmingSchema = z.object({
  data: z.array(
    z.object({
      title: z.string(),
      slug: z.string(),
      poster: z.string().nullable().optional(),
      screens: z.array(z.record(z.string(), z.array(variantSchema))),
    }),
  ),
});

function releaseYear(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Date(v > 1e11 ? v : v * 1000).getUTCFullYear();
  const y = Number(v.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function durationMinutes(hhmm: string | null | undefined): number | null {
  const m = hhmm ? /^(\d{1,2}):(\d{2})$/.exec(hhmm) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Parse one /theatres/{slug}/programming/{date} response. */
export function parseUciProgramming(cinemaSlug: string, payload: unknown): RawSession[] {
  const { data } = programmingSchema.parse(payload);
  return data.flatMap((movie) =>
    movie.screens.flatMap((screen) =>
      Object.entries(screen).flatMap(([screenName, variants]) =>
        variants.flatMap((v) => {
          const signals: Signal[] = [];
          if (v.language) signals.push({ kind: 'structured_language', value: v.language.slug });
          if (v.language?.slug === 'DSA') signals.push({ kind: 'note', value: v.language.name });
          if (/^ov-/.test(v.slug)) signals.push({ kind: 'title', value: `${movie.title} - OV` });
          return v.performances.map(
            (p): RawSession => ({
              cinemaSlug,
              sourceSessionId: String(p.id),
              startsAt: romeLocalToIso(p.starts_at),
              cinemaDay: p.day,
              title: movie.title,
              year: releaseYear(v.release_date),
              runtimeMin: durationMinutes(v.duration),
              posterUrl: movie.poster ?? null,
              bookingUrl: p.cart_link ? BOOKING_BASE + p.cart_link : null,
              room: [p.room, screenName].filter(Boolean).join(' · '),
              signals,
            }),
          );
        }),
      ),
    ),
  );
}

export const uciAdapter: SourceAdapter = async (source, ctx) => {
  const errors: { cinemaSlug: string; message: string }[] = [];
  const cinemas: CinemaResult[] = [];
  for (const cinema of source.cinemas) {
    const sessions: RawSession[] = [];
    let failed = false;
    for (const date of datesInRange(ctx.range.from, ctx.range.to)) {
      try {
        const payload = await fetchJson(`${BASE}/theatres/${cinema.match}/programming/${date}`);
        sessions.push(...parseUciProgramming(cinema.slug, payload));
      } catch (error: unknown) {
        failed = true;
        errors.push({ cinemaSlug: cinema.slug, message: `${date}: ${errorMessage(error)}` });
      }
    }
    if (!failed || sessions.length > 0) cinemas.push({ cinemaSlug: cinema.slug, sessions, advertisedDates: null });
  }
  return { cinemas, errors };
};
