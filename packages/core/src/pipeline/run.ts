import type pg from 'pg';
import { adapterFor } from '../adapters/index.ts';
import type { AdapterContext } from '../adapters/types.ts';
import { loadOverrides, loadSources, type CinemaConfig, type SourceConfig } from '../config.ts';
import { activeFutureCount, dbCache, pruneOldData, recordRun, saveSnapshot, setCinemaStatus, syncCinemas, upsertCinemaSessions } from '../db/write.ts';
import { onSnapshot } from '../http.ts';
import { errorMessage, log } from '../log.ts';
import { escapeHtml, notifyAdmin } from '../telegram.ts';
import { addDays, todayRome } from '../time.ts';
import type { AdapterResult, DateRange } from '../types.ts';
import { enrichPendingFilms } from './enrich.ts';
import { assessHealth } from './health.ts';
import { dedupe, normalizeSession } from './normalize.ts';

const SOURCE_CONCURRENCY = 4;

export interface RunOptions {
  readonly days: number;
  readonly only?: readonly string[];
  readonly enrich?: boolean;
  readonly snapshots?: boolean;
}

export interface RunSummary {
  readonly cinemas: { slug: string; sessions: number; vo: number; status: string; reason: string | null }[];
  readonly enriched: number;
}

async function runSource(db: pg.Pool, source: SourceConfig, ids: Map<string, number>, ctx: AdapterContext): Promise<RunSummary['cinemas']> {
  const startedAt = new Date();
  let result: AdapterResult;
  try {
    result = await adapterFor(source)(source, ctx);
  } catch (error: unknown) {
    const message = errorMessage(error);
    result = { cinemas: [], errors: source.cinemas.map((c) => ({ cinemaSlug: c.slug, message })) };
  }
  const out: RunSummary['cinemas'] = [];
  for (const cinema of source.cinemas) {
    try {
      out.push(await storeCinema(db, source, cinema, result, ids.get(cinema.slug)!, ctx, startedAt));
    } catch (error: unknown) {
      // A DB failure for one cinema (e.g. a deadlock) must not abort the rest of the scrape.
      log.error('store failed', { cinema: cinema.slug, error: errorMessage(error) });
      out.push({ slug: cinema.slug, sessions: 0, vo: 0, status: 'degraded', reason: errorMessage(error) });
    }
  }
  return out;
}

async function storeCinema(
  db: pg.Pool,
  source: SourceConfig,
  cinema: CinemaConfig,
  result: AdapterResult,
  cinemaId: number,
  ctx: AdapterContext,
  startedAt: Date,
): Promise<RunSummary['cinemas'][number]> {
  const overrides = loadOverrides();
  const found = result.cinemas.find((c) => c.cinemaSlug === cinema.slug);
  const errors = result.errors.filter((e) => e.cinemaSlug === cinema.slug || e.cinemaSlug === null).map((e) => e.message);
  const sessions = dedupe((found?.sessions ?? []).map((s) => normalizeSession(s, overrides)));
  const previouslyActive = await activeFutureCount(db, cinemaId, ctx.range.from, ctx.range.to);
  const health = assessHealth({ sessionsFound: sessions.length, errors, advertisedDates: found?.advertisedDates ?? null, previouslyActive });

  // Never let a broken fetch wipe good data: only a clean, healthy run may deactivate missing sessions.
  const complete = found !== undefined && errors.length === 0 && health.ok;
  if (found) await upsertCinemaSessions(db, cinemaId, sessions, { ...ctx.range, complete, runStartedAt: startedAt });
  const vo = sessions.filter((s) => s.languageClass === 'vo').length;
  await recordRun(db, {
    sourceId: source.id,
    cinemaId,
    startedAt,
    status: health.ok ? 'ok' : found ? 'degraded' : 'failed',
    sessionsFound: sessions.length,
    voFound: vo,
    error: health.reason ?? (errors.length ? errors.join(' | ').slice(0, 2000) : null),
  });
  const prev = await setCinemaStatus(db, cinemaId, health.ok, health.reason);
  if (prev === 'ok' && !health.ok) await notifyAdmin(`⚠️ <b>${escapeHtml(cinema.name)}</b> degraded\n${escapeHtml(health.reason ?? '')}`);
  if (prev === 'degraded' && health.ok) await notifyAdmin(`✅ <b>${escapeHtml(cinema.name)}</b> recovered`);
  log.info('cinema done', { cinema: cinema.slug, sessions: sessions.length, vo, ok: health.ok, reason: health.reason, errors: errors.length });
  return { slug: cinema.slug, sessions: sessions.length, vo, status: health.ok ? 'ok' : 'degraded', reason: health.reason };
}

/** Fetch all (or selected) sources for the next `days` cinema days and store the results. */
export async function runPipeline(db: pg.Pool, opts: RunOptions): Promise<RunSummary> {
  const sources = loadSources().filter((s) => !opts.only?.length || opts.only.includes(s.id));
  const ids = await syncCinemas(db, sources);
  const today = todayRome();
  const range: DateRange = { from: today, to: addDays(today, opts.days - 1) };
  const ctx: AdapterContext = { range, today, cache: dbCache(db) };
  if (opts.snapshots !== false) onSnapshot((s) => void saveSnapshot(db, s.url, s.status, s.body).catch(() => undefined));

  const queue = [...sources];
  const results: RunSummary['cinemas'] = [];
  const workers = Array.from({ length: SOURCE_CONCURRENCY }, async () => {
    for (let source = queue.shift(); source; source = queue.shift()) results.push(...(await runSource(db, source, ids, ctx)));
  });
  await Promise.all(workers);
  onSnapshot(null);

  const enriched = opts.enrich === false ? 0 : await enrichPendingFilms(db);
  await pruneOldData(db);
  return { cinemas: results, enriched };
}
