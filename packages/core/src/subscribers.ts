import type pg from 'pg';
import { parsePrefs, type Prefs } from './queries.ts';

export type SubscriptionKind = 'new_films' | 'film' | 'cinema';

export interface Subscriber {
  readonly chatId: number;
  readonly locale: string;
  readonly prefs: Prefs;
  readonly digestHours: number;
  readonly lastDigestAt: Date | null;
}

export interface Subscription {
  readonly id: number;
  readonly kind: SubscriptionKind;
  readonly targetId: number | null;
  readonly createdAt: Date;
  readonly label: string | null;
}

export const DIGEST_CHOICES = [6, 12, 24] as const;

export async function ensureSubscriber(db: pg.Pool, chatId: number, locale = 'en'): Promise<Subscriber> {
  const { rows } = await db.query(
    `insert into subscribers (chat_id, locale) values ($1, $2)
     on conflict (chat_id) do update set chat_id = excluded.chat_id
     returning chat_id as "chatId", locale, prefs, digest_hours as "digestHours", last_digest_at as "lastDigestAt"`,
    [chatId, locale],
  );
  const r = rows[0] as Subscriber & { prefs: unknown };
  return { ...r, chatId: Number(r.chatId), prefs: parsePrefs(r.prefs) };
}

export async function updatePrefs(db: pg.Pool, chatId: number, patch: Partial<Prefs>): Promise<Prefs> {
  const current = (await ensureSubscriber(db, chatId)).prefs;
  const next: Prefs = { ...current, ...patch };
  await db.query('update subscribers set prefs = $2 where chat_id = $1', [chatId, JSON.stringify(next)]);
  return next;
}

export async function setDigestHours(db: pg.Pool, chatId: number, hours: number): Promise<void> {
  await db.query('update subscribers set digest_hours = $2 where chat_id = $1', [chatId, hours]);
}

/** Full deletion: subscriptions and alert history cascade; reports are deleted explicitly. */
export async function deleteSubscriber(db: pg.Pool, chatId: number): Promise<void> {
  await db.query('delete from reports where chat_id = $1', [chatId]);
  await db.query('delete from subscribers where chat_id = $1', [chatId]);
}

export async function listSubscriptions(db: pg.Pool, chatId: number): Promise<Subscription[]> {
  const { rows } = await db.query(
    `select s.id, s.kind, s.target_id as "targetId", s.created_at as "createdAt",
            case s.kind when 'film' then f.title when 'cinema' then c.name end as label
     from subscriptions s
     left join films f on s.kind = 'film' and f.id = s.target_id
     left join cinemas c on s.kind = 'cinema' and c.id = s.target_id
     where s.chat_id = $1 order by s.kind, label`,
    [chatId],
  );
  return rows as Subscription[];
}

export async function subscribe(db: pg.Pool, chatId: number, kind: SubscriptionKind, targetId: number | null): Promise<void> {
  await ensureSubscriber(db, chatId);
  await db.query(
    `insert into subscriptions (chat_id, kind, target_id) values ($1, $2, $3)
     on conflict (chat_id, kind, coalesce(target_id, 0)) do nothing`,
    [chatId, kind, targetId],
  );
}

export async function unsubscribe(db: pg.Pool, chatId: number, kind: SubscriptionKind, targetId: number | null): Promise<void> {
  await db.query('delete from subscriptions where chat_id = $1 and kind = $2 and coalesce(target_id, 0) = coalesce($3::int, 0)', [
    chatId,
    kind,
    targetId,
  ]);
}

export async function isSubscribed(db: pg.Pool, chatId: number, kind: SubscriptionKind, targetId: number | null): Promise<boolean> {
  const { rows } = await db.query('select 1 from subscriptions where chat_id = $1 and kind = $2 and coalesce(target_id, 0) = coalesce($3::int, 0)', [
    chatId,
    kind,
    targetId,
  ]);
  return rows.length > 0;
}
