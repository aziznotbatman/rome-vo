import type { SourceConfig } from '../config.ts';
import type { AdapterResult, DateRange } from '../types.ts';

/** Small key-value cache with expiry (DB-backed in production, in-memory in tests). */
export interface KvCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface AdapterContext {
  readonly range: DateRange;
  readonly today: string;
  readonly cache: KvCache;
}

export type SourceAdapter = (source: SourceConfig, ctx: AdapterContext) => Promise<AdapterResult>;

export function memoryCache(): KvCache {
  const store = new Map<string, { value: string; expires: number }>();
  return {
    async get(key) {
      const hit = store.get(key);
      return hit && hit.expires > Date.now() ? hit.value : null;
    },
    async set(key, value, ttlSeconds) {
      store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    },
  };
}

export function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}
