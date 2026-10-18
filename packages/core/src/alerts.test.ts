import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isDigestDue, isQuietHours, markSent, pendingDigest } from './alerts.ts';
import { migrate } from './db/pool.ts';
import { ensureSubscriber, subscribe } from './subscribers.ts';

const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/romevo_test', max: 2 });
const CHAT = 4242;

async function addSession(filmKey: string, title: string, cinemaId: number, sourceId: string, lang = 'vo'): Promise<void> {
  const { rows } = await db.query<{ id: number }>(
    `insert into films (film_key, title, original_language, first_vo_seen_at) values ($1, $2, 'en', now())
     on conflict (film_key) do update set title = excluded.title returning id`,
    [filmKey, title],
  );
  await db.query(
    `insert into sessions (cinema_id, film_id, source_session_id, starts_at, cinema_day, raw_title, language_class, confidence)
     values ($1, $2, $3, now() + interval '1 day', current_date + 1, $4, $5, 0.95)`,
    [cinemaId, rows[0]!.id, sourceId, title, lang],
  );
}

describe('alert digest', () => {
  let cinemaId = 0;

  beforeAll(async () => {
    await migrate(db);
  });

  beforeEach(async () => {
    await db.query('truncate subscribers, subscriptions, alerts_sent, sessions, films, cinemas restart identity cascade');
    // The cinema's first successful run happened an hour ago, so anything seen now is genuinely new.
    const { rows } = await db.query<{ id: number }>(
      `insert into cinemas (slug, name, area, source_id, first_success_at) values ('lux', 'Lux', 'Trieste', 'lux', now() - interval '1 hour') returning id`,
    );
    cinemaId = rows[0]!.id;
    await ensureSubscriber(db, CHAT);
    await db.query(`update subscribers set created_at = now() - interval '2 hours' where chat_id = $1`, [CHAT]);
    await subscribe(db, CHAT, 'new_films', null);
    await db.query(`update subscriptions set created_at = now() - interval '2 hours'`);
  });

  afterAll(async () => {
    await db.end();
  });

  it('announces a newly added VO film exactly once', async () => {
    await addSession('digger', 'Digger', cinemaId, 's1');
    const sub = await ensureSubscriber(db, CHAT);
    const first = await pendingDigest(db, sub);
    expect(first.map((i) => i.key)).toEqual(['film:digger']);

    await markSent(db, CHAT, first);
    expect(await pendingDigest(db, sub)).toEqual([]);

    await addSession('digger', 'Digger', cinemaId, 's2'); // more sessions of the same film: no new alert
    expect(await pendingDigest(db, sub)).toEqual([]);
  });

  it('ignores dubbed films and a new cinema’s back catalogue', async () => {
    await addSession('naza', 'Naza', cinemaId, 'd1', 'dubbed');
    const { rows } = await db.query<{ id: number }>(
      `insert into cinemas (slug, name, area, source_id, first_success_at) values ('new', 'New', 'X', 'new', now()) returning id`,
    );
    await addSession('fatherland', 'Fatherland', rows[0]!.id, 'f1');
    expect(await pendingDigest(db, await ensureSubscriber(db, CHAT))).toEqual([]);
  });

  it('tells followers of a cinema about its new VO sessions once', async () => {
    await subscribe(db, CHAT, 'cinema', cinemaId);
    await addSession('primetime', 'Primetime', cinemaId, 'p1');
    const sub = await ensureSubscriber(db, CHAT);
    const items = await pendingDigest(db, sub);
    // The same film via 'new films' and the followed cinema is shown once.
    expect(items.map((i) => i.kind)).toEqual(['new_film']);
    await markSent(db, CHAT, items);
    expect(await pendingDigest(db, sub)).toEqual([]);
  });
});

describe('digest timing', () => {
  it('respects quiet hours 23:00–08:00 Rome time', () => {
    expect(isQuietHours(new Date('2026-10-18T21:30:00Z'))).toBe(true); // 23:30 CEST
    expect(isQuietHours(new Date('2026-10-18T05:30:00Z'))).toBe(true); // 07:30 CEST
    expect(isQuietHours(new Date('2026-10-18T10:00:00Z'))).toBe(false); // 12:00 CEST
  });

  it('batches: at most one digest per chosen interval', () => {
    const now = new Date('2026-10-18T10:00:00Z');
    expect(isDigestDue({ lastDigestAt: null, digestHours: 24 }, now)).toBe(true);
    expect(isDigestDue({ lastDigestAt: new Date('2026-10-18T04:00:00Z'), digestHours: 12 }, now)).toBe(false);
    expect(isDigestDue({ lastDigestAt: new Date('2026-10-17T09:00:00Z'), digestHours: 24 }, now)).toBe(true);
  });
});

describe('alert keys survive Wikidata regrouping', () => {
  it('does not re-announce a film after it gains a wikidata id', async () => {
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/romevo_test', max: 1 });
    try {
      await pool.query('truncate subscribers, subscriptions, alerts_sent, sessions, films, cinemas restart identity cascade');
      const c = await pool.query<{ id: number }>(
        `insert into cinemas (slug, name, area, source_id, first_success_at) values ('x', 'X', 'X', 'x', now() - interval '1 hour') returning id`,
      );
      await ensureSubscriber(pool, CHAT);
      await subscribe(pool, CHAT, 'new_films', null);
      await pool.query(`update subscriptions set created_at = now() - interval '2 hours'`);
      const f = await pool.query<{ id: number }>(`insert into films (film_key, title, first_vo_seen_at) values ('digger', 'Digger', now()) returning id`);
      await pool.query(
        `insert into sessions (cinema_id, film_id, source_session_id, starts_at, cinema_day, raw_title, language_class, confidence)
         values ($1, $2, 'a', now() + interval '1 day', current_date + 1, 'Digger', 'vo', 0.9)`,
        [c.rows[0]!.id, f.rows[0]!.id],
      );
      const sub = await ensureSubscriber(pool, CHAT);
      await markSent(pool, CHAT, await pendingDigest(pool, sub));
      await pool.query(`update films set wikidata_id = 'Q129677718'`);
      expect(await pendingDigest(pool, sub)).toEqual([]);
    } finally {
      await pool.end();
    }
  });
});
