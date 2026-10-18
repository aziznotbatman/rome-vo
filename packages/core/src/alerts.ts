import type pg from 'pg';
import { FILM_GROUP_SQL, VO_FILTER_SQL } from './queries.ts';
import type { Subscriber } from './subscribers.ts';
import { romeParts } from './time.ts';

export const QUIET_START_HOUR = 23;
export const QUIET_END_HOUR = 8;
/** Sessions seen during a cinema's very first successful run are its back catalogue, not news. */
const FIRST_RUN_GRACE = `interval '5 minutes'`;

export interface DigestItem {
  /**
   * Comma-separated alerts_sent keys. New films use `film:<film_key>` for every title variant in the
   * group, so a film stays "announced" even after Wikidata merges it with another variant.
   */
  readonly key: string;
  readonly filmGroup: string;
  readonly kind: 'new_film' | 'film_sessions' | 'cinema_sessions';
  readonly filmId: number;
  readonly filmTitle: string;
  readonly cinemaName: string | null;
  readonly sessions: number;
  readonly firstStartsAt: Date;
}

export function isQuietHours(now: Date = new Date()): boolean {
  const h = romeParts(now).hour;
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

export function isDigestDue(sub: Pick<Subscriber, 'lastDigestAt' | 'digestHours'>, now: Date = new Date()): boolean {
  if (isQuietHours(now)) return false;
  if (!sub.lastDigestAt) return true;
  return now.getTime() - sub.lastDigestAt.getTime() >= sub.digestHours * 3600_000;
}

/** Everything a subscriber has not been told about yet. Pure read; mark with `markSent` after delivery. */
export async function pendingDigest(db: pg.Pool, sub: Subscriber): Promise<DigestItem[]> {
  const params = [sub.prefs.includeUnknown ?? false, sub.prefs.includeItalian ?? false, sub.chatId];
  const newFilms = await db.query(
    `select string_agg(distinct 'film:' || f.film_key, ',') as key, ${FILM_GROUP_SQL} as "filmGroup", 'new_film' as kind,
            min(f.id) as "filmId", min(f.title) as "filmTitle", null as "cinemaName", count(s.id)::int as sessions,
            min(s.starts_at) as "firstStartsAt"
     from subscriptions sub
     join films f on f.first_vo_seen_at > sub.created_at
     join sessions s on s.film_id = f.id and s.is_active and s.starts_at > now()
     join cinemas c on c.id = s.cinema_id and s.first_seen_at > c.first_success_at + ${FIRST_RUN_GRACE}
     left join alerts_sent a on a.chat_id = $3 and a.alert_key = 'film:' || f.film_key
     where sub.chat_id = $3 and sub.kind = 'new_films' and ${VO_FILTER_SQL}
     group by ${FILM_GROUP_SQL}
     having count(a.alert_key) = 0`,
    params,
  );
  const followed = await db.query(
    `select string_agg(distinct 'session:' || s.id, ',') as key, ${FILM_GROUP_SQL} as "filmGroup", case sub.kind when 'film' then 'film_sessions' else 'cinema_sessions' end as kind,
            min(f.id) as "filmId", min(f.title) as "filmTitle", min(c.name) as "cinemaName", count(s.id)::int as sessions,
            min(s.starts_at) as "firstStartsAt"
     from subscriptions sub
     join sessions s on s.is_active and s.starts_at > now() and s.first_seen_at > sub.created_at
     join films f on f.id = s.film_id
     join cinemas c on c.id = s.cinema_id and s.first_seen_at > c.first_success_at + ${FIRST_RUN_GRACE}
     left join films tf on sub.kind = 'film' and tf.id = sub.target_id
     where sub.chat_id = $3 and ${VO_FILTER_SQL}
       and ((sub.kind = 'film' and coalesce(tf.wikidata_id, 'k:' || tf.film_key) = ${FILM_GROUP_SQL})
            or (sub.kind = 'cinema' and c.id = sub.target_id))
       and not exists (select 1 from alerts_sent a where a.chat_id = $3 and a.alert_key = 'session:' || s.id)
     group by sub.kind, ${FILM_GROUP_SQL}, c.id`,
    params,
  );
  return mergeDigest([...newFilms.rows, ...followed.rows] as DigestItem[]);
}

/**
 * A film can qualify both as "new" and through a followed film/cinema. Show it once: fold the
 * session keys into the new-film item so they are marked sent together.
 */
export function mergeDigest(items: readonly DigestItem[]): DigestItem[] {
  const newByGroup = new Map(items.filter((i) => i.kind === 'new_film').map((i) => [i.filmGroup, { ...i }]));
  const out: DigestItem[] = [];
  const seenFollowed = new Map<string, DigestItem>();
  for (const i of items) {
    if (i.kind === 'new_film') continue;
    const fresh = newByGroup.get(i.filmGroup);
    if (fresh) {
      newByGroup.set(i.filmGroup, { ...fresh, key: `${fresh.key},${i.key}` });
      continue;
    }
    // Followed film *and* followed cinema can both match the same sessions.
    const k = `${i.filmGroup}|${i.cinemaName}`;
    const prev = seenFollowed.get(k);
    seenFollowed.set(k, prev ? { ...prev, key: `${prev.key},${i.key}` } : i);
  }
  out.push(...newByGroup.values(), ...seenFollowed.values());
  return out;
}

/** Record delivery so the same film/session is never announced twice to this chat. */
export async function markSent(db: pg.Pool, chatId: number, items: readonly DigestItem[]): Promise<void> {
  const keys = items.flatMap((i) => i.key.split(','));
  if (keys.length === 0) return;
  await db.query(
    `insert into alerts_sent (chat_id, alert_key) select $1, unnest($2::text[]) on conflict do nothing`,
    [chatId, keys],
  );
  await db.query('update subscribers set last_digest_at = now() where chat_id = $1', [chatId]);
}

export async function subscribersWithAlerts(db: pg.Pool): Promise<number[]> {
  const { rows } = await db.query<{ chat_id: string }>('select distinct chat_id from subscriptions');
  return rows.map((r) => Number(r.chat_id));
}
