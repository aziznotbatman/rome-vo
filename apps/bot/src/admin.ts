import type pg from 'pg';
import { escapeHtml } from '@romevo/core/telegram';

/** Latest run per cinema plus classifier mix, for /admin and `pnpm admin`. */
export async function adminStatus(db: pg.Pool): Promise<string> {
  const { rows } = await db.query<{ name: string; status: string; reason: string | null; at: Date | null; sessions: number; vo: number }>(
    `select c.name, c.status, c.status_reason as reason, r.started_at as at, r.sessions_found as sessions, r.vo_found as vo
     from cinemas c left join lateral (
       select * from source_runs r where r.cinema_id = c.id order by r.started_at desc limit 1) r on true
     order by c.status desc, c.name`,
  );
  const mix = await db.query<{ cls: string; n: string; low: string }>(
    `select language_class as cls, count(*) as n, count(*) filter (where confidence < 0.6) as low
     from sessions where is_active and starts_at > now() group by 1 order by 1`,
  );
  const reports = await db.query<{ n: string }>(`select count(*) as n from reports where created_at > now() - interval '7 days'`);
  const review = await db.query<{ n: string }>(
    `select count(distinct f.id) as n from films f join sessions s on s.film_id = f.id
     where f.needs_review and s.is_active and s.starts_at > now() and s.language_class = 'vo'`,
  );
  const fmt = (d: Date | null): string => (d ? d.toISOString().slice(5, 16).replace('T', ' ') : 'never');
  const lines = rows.map(
    (r) => `${r.status === 'ok' ? '✅' : '⚠️'} ${escapeHtml(r.name)} — ${r.sessions ?? 0} (${r.vo ?? 0} VO) · ${fmt(r.at)}${r.reason ? `\n   <i>${escapeHtml(r.reason.slice(0, 120))}</i>` : ''}`,
  );
  const classes = mix.rows.map((m) => `${m.cls}: ${m.n} (${m.low} low-confidence)`).join(' · ');
  return [
    '<b>Sources</b> (last run, UTC)',
    ...lines,
    '',
    `<b>Upcoming sessions</b> ${classes}`,
    `<b>VO films without a confident Wikidata match</b> ${review.rows[0]?.n ?? 0}`,
    `<b>Reports (7d)</b> ${reports.rows[0]?.n ?? 0}`,
  ].join('\n');
}
