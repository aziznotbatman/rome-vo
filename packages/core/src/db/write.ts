import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { KvCache } from '../adapters/types.ts';
import type { SourceConfig } from '../config.ts';
import type { NormalizedSession } from '../pipeline/normalize.ts';

const SNAPSHOT_MAX_BYTES = 2_000_000;
const SNAPSHOT_RETENTION_DAYS = 14;

/** Mirror config/cinemas.yaml into the cinemas table. Returns slug → id. */
export async function syncCinemas(db: pg.Pool, sources: readonly SourceConfig[]): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const source of sources) {
    for (const c of source.cinemas) {
      const { rows } = await db.query<{ id: number }>(
        `insert into cinemas (slug, name, area, address, lat, lon, source_id)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (slug) do update set name = excluded.name, area = excluded.area, address = excluded.address,
           lat = excluded.lat, lon = excluded.lon, source_id = excluded.source_id, updated_at = now()
         returning id`,
        [c.slug, c.name, c.area, c.address, c.lat ?? null, c.lon ?? null, source.id],
      );
      ids.set(c.slug, rows[0]!.id);
    }
  }
  return ids;
}

/** Find-or-create films by grouping key; fills metadata gaps without overwriting known values. */
async function upsertFilms(db: pg.PoolClient, sessions: readonly NormalizedSession[]): Promise<Map<string, number>> {
  const byKey = new Map<string, NormalizedSession>();
  for (const s of sessions) {
    const prev = byKey.get(s.filmKey);
    // Prefer the plain (non-VO) title variant for display: it is the cinema's canonical name.
    if (!prev || (prev.languageClass === 'vo' && s.languageClass !== 'vo')) byKey.set(s.filmKey, s);
  }
  const ids = new Map<string, number>();
  // Lock film rows in a fixed order so parallel sources can't deadlock on shared films.
  for (const [key, s] of [...byKey].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const { rows } = await db.query<{ id: number }>(
      `insert into films (film_key, title, original_title, year, director, runtime_min, poster_url, imdb_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (film_key) do update set
         original_title = coalesce(films.original_title, excluded.original_title),
         year = coalesce(films.year, excluded.year),
         director = coalesce(films.director, excluded.director),
         runtime_min = coalesce(films.runtime_min, excluded.runtime_min),
         poster_url = coalesce(films.poster_url, excluded.poster_url),
         imdb_id = coalesce(films.imdb_id, excluded.imdb_id)
       returning id`,
      [key, s.displayTitle, s.originalTitle ?? null, s.year ?? null, s.director ?? null, s.runtimeMin ?? null, s.posterUrl ?? null, s.hints?.imdbId ?? null],
    );
    ids.set(key, rows[0]!.id);
  }
  return ids;
}

export interface UpsertResult {
  readonly upserted: number;
  readonly deactivated: number;
}

/**
 * Upsert one cinema's sessions in a transaction. When `complete` is true (the fetch had no errors),
 * future sessions that were not seen this run are marked inactive (cancelled/removed), but only on
 * cinema days that returned at least one session: an empty day is more often a glitch than a cancellation.
 */
export async function upsertCinemaSessions(
  db: pg.Pool,
  cinemaId: number,
  sessions: readonly NormalizedSession[],
  window: { from: string; to: string; complete: boolean; runStartedAt: Date },
): Promise<UpsertResult> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const filmIds = await upsertFilms(client, sessions);
    for (const s of sessions) {
      await client.query(
        `insert into sessions (cinema_id, film_id, source_session_id, starts_at, cinema_day, raw_title, booking_url, room,
                               language_class, confidence, reasons, audio_language, overridden)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict (cinema_id, source_session_id) do update set
           film_id = excluded.film_id, starts_at = excluded.starts_at, cinema_day = excluded.cinema_day,
           raw_title = excluded.raw_title, booking_url = excluded.booking_url, room = excluded.room,
           language_class = excluded.language_class, confidence = excluded.confidence, reasons = excluded.reasons,
           audio_language = excluded.audio_language, overridden = excluded.overridden,
           is_active = true, last_seen_at = now()`,
        [
          cinemaId, filmIds.get(s.filmKey), s.sourceSessionId, s.startsAt, s.cinemaDay, s.title, s.bookingUrl, s.room ?? null,
          s.languageClass, s.confidence, JSON.stringify(s.reasons), s.audioLanguage, s.overridden,
        ],
      );
    }
    let deactivated = 0;
    if (window.complete) {
      const days = [...new Set(sessions.map((s) => s.cinemaDay))];
      const res = await client.query(
        `update sessions set is_active = false
         where cinema_id = $1 and is_active and cinema_day between $2 and $3 and cinema_day = any($5::date[])
           and starts_at > now() and last_seen_at < $4`,
        [cinemaId, window.from, window.to, window.runStartedAt, days],
      );
      deactivated = res.rowCount ?? 0;
    }
    await client.query(
      `update films f set first_vo_seen_at = now()
       where f.id = any($1::int[]) and f.first_vo_seen_at is null and exists (
         select 1 from sessions s where s.film_id = f.id and s.is_active and s.language_class = 'vo')`,
      [[...filmIds.values()]],
    );
    await client.query('commit');
    return { upserted: sessions.length, deactivated };
  } catch (error: unknown) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export interface RunRecord {
  readonly sourceId: string;
  readonly cinemaId: number;
  readonly startedAt: Date;
  readonly status: 'ok' | 'degraded' | 'failed';
  readonly sessionsFound: number;
  readonly voFound: number;
  readonly error: string | null;
}

export async function recordRun(db: pg.Pool, r: RunRecord): Promise<void> {
  await db.query(
    `insert into source_runs (source_id, cinema_id, started_at, status, sessions_found, vo_found, error)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [r.sourceId, r.cinemaId, r.startedAt, r.status, r.sessionsFound, r.voFound, r.error],
  );
}

/** Set a cinema's health. Returns the previous status so callers can alert on transitions. */
export async function setCinemaStatus(db: pg.Pool, cinemaId: number, ok: boolean, reason: string | null): Promise<string> {
  const { rows } = await db.query<{ prev: string }>(
    `update cinemas c set status = $2, status_reason = $3,
       last_success_at = case when $2 = 'ok' then now() else c.last_success_at end,
       first_success_at = case when $2 = 'ok' then coalesce(c.first_success_at, now()) else c.first_success_at end
     from (select status as prev from cinemas where id = $1) p
     where c.id = $1 returning p.prev`,
    [cinemaId, ok ? 'ok' : 'degraded', reason],
  );
  return rows[0]?.prev ?? 'ok';
}

export async function activeFutureCount(db: pg.Pool, cinemaId: number, from: string, to: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from sessions where cinema_id = $1 and is_active and starts_at > now() and cinema_day between $2 and $3`,
    [cinemaId, from, to],
  );
  return Number(rows[0]?.n ?? 0);
}

export function dbCache(db: pg.Pool): KvCache {
  return {
    async get(key) {
      const { rows } = await db.query<{ value: string }>('select value from kv_cache where key = $1 and expires_at > now()', [key]);
      return rows[0]?.value ?? null;
    },
    async set(key, value, ttlSeconds) {
      await db.query(
        `insert into kv_cache (key, value, expires_at) values ($1, $2, now() + make_interval(secs => $3))
         on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at`,
        [key, value, ttlSeconds],
      );
    },
  };
}

/** Store a raw response unless an identical body for the same URL is already kept. */
export async function saveSnapshot(db: pg.Pool, url: string, status: number, body: string): Promise<void> {
  const stored = body.slice(0, SNAPSHOT_MAX_BYTES);
  const md5 = createHash('md5').update(stored).digest('hex');
  await db.query(
    `insert into raw_snapshots (url, status, body, body_md5)
     select $1, $2, $3, $4 where not exists (select 1 from raw_snapshots where url = $1 and body_md5 = $4)`,
    [url, status, stored, md5],
  );
}

export async function pruneOldData(db: pg.Pool): Promise<void> {
  await db.query(`delete from raw_snapshots where fetched_at < now() - make_interval(days => $1)`, [SNAPSHOT_RETENTION_DAYS]);
  await db.query('delete from kv_cache where expires_at < now()');
  await db.query(`delete from source_runs where started_at < now() - interval '60 days'`);
  // Films whose every listing was regrouped under another key; keep any a user follows.
  await db.query(
    `delete from films f where not exists (select 1 from sessions s where s.film_id = f.id)
       and not exists (select 1 from subscriptions sub where sub.kind = 'film' and sub.target_id = f.id)`,
  );
}
