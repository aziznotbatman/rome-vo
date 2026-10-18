import { closePool, migrate } from '../packages/core/src/db/pool.ts';
import { log } from '../packages/core/src/log.ts';

const applied = await migrate();
log.info('migrations complete', { applied: applied.length });
await closePool();
