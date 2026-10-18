import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { requireEnv } from '../config.ts';
import { log } from '../log.ts';

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: requireEnv('DATABASE_URL'), max: 5 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Apply pending SQL migrations in filename order, each in its own transaction. */
export async function migrate(db: pg.Pool = getPool()): Promise<string[]> {
  await db.query('create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ version: string }>('select version from schema_migrations')).rows.map((r) => r.version));
  const applied: string[] = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(readFileSync(MIGRATIONS_DIR + file, 'utf8'));
      await client.query('insert into schema_migrations (version) values ($1)', [file]);
      await client.query('commit');
      applied.push(file);
      log.info('migration applied', { file });
    } catch (error: unknown) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  return applied;
}
