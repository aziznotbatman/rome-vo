import type pg from 'pg';
import { matchFilm } from '../enrich/wikidata.ts';
import { errorMessage, log } from '../log.ts';

const MAX_PER_RUN = 60;
const REVIEW_BELOW = 0.6;

/**
 * Look up original language for films that matter: those with upcoming VO or unknown sessions.
 * Dubbed-only films never need it. Failed lookups are retried after a week.
 */
export async function enrichPendingFilms(db: pg.Pool): Promise<number> {
  const { rows } = await db.query<{ id: number; title: string; original_title: string | null; director: string | null; year: number | null }>(
    `select f.id, f.title, f.original_title, f.director, f.year from films f
     where (f.enriched_at is null or (f.wikidata_id is null and f.enriched_at < now() - interval '7 days'))
       and exists (select 1 from sessions s where s.film_id = f.id and s.is_active and s.starts_at > now()
                   and s.language_class in ('vo', 'unknown'))
     order by f.created_at desc limit $1`,
    [MAX_PER_RUN],
  );
  let done = 0;
  for (const f of rows) {
    try {
      const m = await matchFilm({ title: f.title, originalTitle: f.original_title, director: f.director, year: f.year });
      await db.query(
        `update films set enriched_at = now(), wikidata_id = $2, original_language = coalesce($3, original_language),
           original_title = coalesce(original_title, $4), year = coalesce(year, $5), imdb_id = coalesce(imdb_id, $6),
           tmdb_id = coalesce(tmdb_id, $7), match_confidence = $8, needs_review = $9
         where id = $1`,
        [f.id, m?.wikidataId ?? null, m?.originalLanguage ?? null, m?.originalTitle ?? null, m?.year ?? null, m?.imdbId ?? null,
          m?.tmdbId ?? null, m?.confidence ?? null, !m || m.confidence < REVIEW_BELOW],
      );
      done++;
      log.debug('enriched', { film: f.title, match: m?.wikidataId ?? null, lang: m?.originalLanguage ?? null });
    } catch (error: unknown) {
      log.warn('enrich failed', { film: f.title, error: errorMessage(error) });
    }
  }
  return done;
}
