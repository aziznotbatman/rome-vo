/** Usage: pnpm scrape [--days 14] [--only uci,circuito] [--no-enrich] */
import { parseArgs } from 'node:util';
import { closePool, getPool, migrate } from '../packages/core/src/db/pool.ts';
import { log } from '../packages/core/src/log.ts';
import { runPipeline } from '../packages/core/src/pipeline/run.ts';

const { values } = parseArgs({
  options: { days: { type: 'string', default: '14' }, only: { type: 'string' }, 'no-enrich': { type: 'boolean', default: false } },
});
const days = Number(values.days);
if (!Number.isInteger(days) || days < 1 || days > 21) throw new Error('--days must be 1..21');

const db = getPool();
await migrate(db);
const started = Date.now();
const summary = await runPipeline(db, { days, only: values.only?.split(',').filter(Boolean), enrich: !values['no-enrich'] });
log.info('scrape finished', {
  seconds: Math.round((Date.now() - started) / 1000),
  sessions: summary.cinemas.reduce((n, c) => n + c.sessions, 0),
  vo: summary.cinemas.reduce((n, c) => n + c.vo, 0),
  degraded: summary.cinemas.filter((c) => c.status !== 'ok').map((c) => c.slug),
  enriched: summary.enriched,
});
await closePool();
