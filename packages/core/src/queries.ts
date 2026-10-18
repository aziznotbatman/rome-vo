import type pg from 'pg';
import { z } from 'zod';

/** User filters. Stored as JSON in subscribers.prefs; every field optional with safe defaults. */
export const prefsSchema = z.object({
  cinemas: z.array(z.string()).optional(), // slugs; empty/undefined = all
  afterHour: z.number().int().min(0).max(23).nullable().optional(),
  weekendOnly: z.boolean().optional(),
  includeItalian: z.boolean().optional(),
  includeUnknown: z.boolean().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});
export type Prefs = z.infer<typeof prefsSchema>;

export function parsePrefs(raw: unknown): Prefs {
  const r = prefsSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}

export interface SessionRow {
  readonly sessionId: number;
  readonly startsAt: Date;
  readonly cinemaDay: string;
  readonly bookingUrl: string | null;
  readonly room: string | null;
  readonly languageClass: 'vo' | 'dubbed' | 'unknown';
  readonly confidence: number;
  readonly audioLanguage: string | null;
  readonly filmId: number;
  readonly filmGroup: string;
  readonly filmTitle: string;
  readonly originalTitle: string | null;
  readonly originalLanguage: string | null;
  readonly year: number | null;
  readonly posterUrl: string | null;
  readonly cinemaId: number;
  readonly cinemaSlug: string;
  readonly cinemaName: string;
  readonly area: string;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly cinemaStatus: 'ok' | 'degraded';
}

export interface SessionQuery {
  readonly from: string;
  readonly to: string;
  readonly prefs: Prefs;
  readonly filmGroup?: string;
  readonly cinemaSlug?: string;
}

/** The film identity used for grouping: Wikidata id when known, else the title key. */
export const FILM_GROUP_SQL = `coalesce(f.wikidata_id, 'k:' || f.film_key)`;

/** Minimum Wikidata match score before "original language is Italian" may hide a cinema-confirmed VO session. */
export const ITALIAN_MATCH_MIN = 0.6;
const IS_ITALIAN = `(f.original_language = 'it' and coalesce(f.match_confidence, 0) >= ${ITALIAN_MATCH_MIN})`;

/** The VO filter shared by listings and alerts. $1 = includeUnknown, $2 = includeItalian. */
export const VO_FILTER_SQL = `(
  (s.language_class = 'vo' and not ${IS_ITALIAN})
  or ($1::boolean and s.language_class = 'unknown' and not ${IS_ITALIAN})
  or ($2::boolean and ${IS_ITALIAN})
)`;

/** Upcoming VO sessions matching the query, ordered by start time. */
export async function listVoSessions(db: pg.Pool, q: SessionQuery): Promise<SessionRow[]> {
  const p = q.prefs;
  const { rows } = await db.query(
    `select s.id as "sessionId", s.starts_at as "startsAt", to_char(s.cinema_day, 'YYYY-MM-DD') as "cinemaDay",
            s.booking_url as "bookingUrl", s.room, s.language_class as "languageClass", s.confidence,
            s.audio_language as "audioLanguage", f.id as "filmId", ${FILM_GROUP_SQL} as "filmGroup", f.title as "filmTitle",
            f.original_title as "originalTitle", f.original_language as "originalLanguage", f.year, f.poster_url as "posterUrl",
            c.id as "cinemaId", c.slug as "cinemaSlug", c.name as "cinemaName", c.area, c.lat, c.lon, c.status as "cinemaStatus"
     from sessions s join films f on f.id = s.film_id join cinemas c on c.id = s.cinema_id
     where s.is_active and s.cinema_day between $3 and $4 and s.starts_at > now() - interval '10 minutes'
       and ${VO_FILTER_SQL}
       and ($5::text[] is null or c.slug = any($5))
       and ($6::int is null or extract(hour from s.starts_at at time zone 'Europe/Rome') >= $6 or extract(hour from s.starts_at at time zone 'Europe/Rome') < 5)
       and (not $7::boolean or extract(isodow from s.cinema_day) in (5, 6, 7))
       and ($8::text is null or ${FILM_GROUP_SQL} = $8)
       and ($9::text is null or c.slug = $9)
     order by s.starts_at, f.title`,
    [
      p.includeUnknown ?? true,
      p.includeItalian ?? false,
      q.from,
      q.to,
      p.cinemas?.length ? p.cinemas : null,
      p.afterHour ?? null,
      p.weekendOnly ?? false,
      q.filmGroup ?? null,
      q.cinemaSlug ?? null,
    ],
  );
  return rows as SessionRow[];
}

export interface FilmHit {
  readonly filmGroup: string;
  readonly filmId: number;
  readonly title: string;
  readonly year: number | null;
  readonly sessions: number;
}

/** Films with upcoming VO-ish sessions whose title contains the query (accent/case-insensitive). */
export async function searchFilms(db: pg.Pool, text: string, prefs: Prefs): Promise<FilmHit[]> {
  const needle = `%${text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}%`;
  const { rows } = await db.query(
    `select ${FILM_GROUP_SQL} as "filmGroup", min(f.id) as "filmId", min(f.title) as title, max(f.year) as year, count(s.id)::int as sessions
     from films f join sessions s on s.film_id = f.id
     where s.is_active and s.starts_at > now() and ${VO_FILTER_SQL}
       and (f.film_key like $3 or lower(coalesce(f.original_title, '')) like $3)
     group by 1 order by sessions desc limit 8`,
    [prefs.includeUnknown ?? true, prefs.includeItalian ?? false, needle],
  );
  return rows as FilmHit[];
}

export async function filmGroupOf(db: pg.Pool, filmId: number): Promise<{ group: string; title: string } | null> {
  const { rows } = await db.query<{ group: string; title: string }>(
    `select ${FILM_GROUP_SQL} as "group", f.title from films f where f.id = $1`,
    [filmId],
  );
  return rows[0] ?? null;
}

export interface CinemaRow {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly area: string;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly status: 'ok' | 'degraded';
  readonly statusReason: string | null;
  readonly lastSuccessAt: Date | null;
}

export async function listCinemas(db: pg.Pool): Promise<CinemaRow[]> {
  const { rows } = await db.query(
    `select id, slug, name, area, lat, lon, status, status_reason as "statusReason", last_success_at as "lastSuccessAt"
     from cinemas order by name`,
  );
  return rows as CinemaRow[];
}

export async function findCinemas(db: pg.Pool, text: string): Promise<CinemaRow[]> {
  const all = await listCinemas(db);
  const t = text.toLowerCase().trim();
  return all.filter((c) => c.slug.includes(t.replace(/\s+/g, '-')) || c.name.toLowerCase().includes(t) || c.area.toLowerCase().includes(t));
}

/** Films first seen in VO within the last `days` days that still have upcoming VO sessions. */
export async function newVoFilms(db: pg.Pool, days: number, prefs: Prefs): Promise<FilmHit[]> {
  const { rows } = await db.query(
    `select ${FILM_GROUP_SQL} as "filmGroup", min(f.id) as "filmId", min(f.title) as title, max(f.year) as year, count(s.id)::int as sessions
     from films f join sessions s on s.film_id = f.id
     where f.first_vo_seen_at > now() - make_interval(days => $3) and s.is_active and s.starts_at > now() and ${VO_FILTER_SQL}
     group by 1 order by min(f.first_vo_seen_at) desc`,
    [prefs.includeUnknown ?? false, prefs.includeItalian ?? false, days],
  );
  return rows as FilmHit[];
}

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
