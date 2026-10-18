/** Usage: pnpm admin — print source health and classifier stats (same as /admin in the bot). */
import { adminStatus } from '../apps/bot/src/admin.ts';
import { closePool, getPool } from '../packages/core/src/db/pool.ts';

const text = await adminStatus(getPool());
process.stdout.write(text.replace(/<\/?(b|i|code)>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') + '\n');
await closePool();
