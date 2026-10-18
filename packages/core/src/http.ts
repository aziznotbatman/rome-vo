import { log } from './log.ts';

export const USER_AGENT = 'Mozilla/5.0 (compatible; RomeVOBot/0.1; +https://t.me/romacinemabot)';

const MIN_INTERVAL_MS = 1200;
const JITTER_MS = 600;
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
/** 429s are expected occasionally on shared platforms; be patient rather than fail the cinema. */
const MAX_429_RETRIES = 4;

/** Thrown when a site answers with a bot challenge; we never try to get past it. */
export class BlockedError extends Error {}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export interface FetchOptions {
  readonly headers?: Record<string, string>;
  readonly cookies?: CookieJar;
}

export interface Snapshot {
  readonly url: string;
  readonly status: number;
  readonly body: string;
}

/** Minimal per-host cookie jar (enough for anonymous session cookies). */
export class CookieJar {
  private readonly store = new Map<string, Map<string, string>>();

  absorb(url: string, res: Response): void {
    const host = new URL(url).host;
    const jar = this.store.get(host) ?? new Map<string, string>();
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const eq = pair?.indexOf('=') ?? -1;
      if (pair && eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    this.store.set(host, jar);
  }

  header(url: string): string | undefined {
    const jar = this.store.get(new URL(url).host);
    if (!jar || jar.size === 0) return undefined;
    return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  clear(): void {
    this.store.clear();
  }
}

const lastHit = new Map<string, number>();
const MAX_BACKOFF_MS = 30_000;

/** Sites that rate-limit harder than our default pace (ms between requests). */
const SITE_INTERVAL_MS: Record<string, number> = { '18tickets.it': 5000 };
/** Custom domains served by a shared platform (and its shared rate limit). */
const SITE_ALIASES: Record<string, string> = { 'multisalagreenwichroma.com': '18tickets.it' };

/**
 * Rate-limit per site, not per hostname: every *.18tickets.it circuit (and white-label domains on it)
 * shares one per-client limit, observed as HTTP 429 when circuits were fetched in parallel.
 */
function siteKey(host: string): string {
  const domain = host.split('.').slice(-2).join('.');
  return SITE_ALIASES[domain] ?? domain;
}

function backoffMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get('retry-after'));
  const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 10_000 * 2 ** attempt;
  return Math.min(ms, MAX_BACKOFF_MS);
}
type SnapshotSink = (s: Snapshot) => void;
let snapshotSink: SnapshotSink | null = null;

/** Register a callback that receives every fetched body (for debugging snapshots). */
export function onSnapshot(sink: SnapshotSink | null): void {
  snapshotSink = sink;
}

async function waitForSlot(host: string): Promise<void> {
  const now = Date.now();
  const next = (lastHit.get(host) ?? 0) + (SITE_INTERVAL_MS[host] ?? MIN_INTERVAL_MS) + Math.random() * JITTER_MS;
  lastHit.set(host, Math.max(now, next));
  if (next > now) await new Promise((r) => setTimeout(r, next - now));
}

function looksLikeChallenge(res: Response, body: string): boolean {
  if (res.headers.get('cf-mitigated') === 'challenge') return true;
  return /cf-chl-|challenge-platform|g-recaptcha|hcaptcha/i.test(body.slice(0, 5000)) && res.status >= 400;
}

/** Polite GET returning the body as text. Rate-limited per host, retries transient failures. */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const host = siteKey(new URL(url).host);
  for (let attempt = 0; ; attempt++) {
    await waitForSlot(host);
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.5', ...opts.headers };
    const cookie = opts.cookies?.header(url);
    if (cookie) headers.Cookie = cookie;
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
      opts.cookies?.absorb(url, res);
      const body = await res.text();
      snapshotSink?.({ url, status: res.status, body });
      if (looksLikeChallenge(res, body)) throw new BlockedError(`Bot challenge at ${url}`);
      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        const wait = backoffMs(res, attempt);
        log.warn('http 429, backing off', { url, waitMs: wait, attempt });
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        log.warn('http retry', { url, status: res.status, attempt });
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, url);
      return body;
    } catch (error: unknown) {
      const transient = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'TypeError');
      if (transient && attempt < MAX_RETRIES) {
        log.warn('http retry', { url, error: error.message, attempt });
        continue;
      }
      throw error;
    }
  }
}

export async function fetchJson(url: string, opts: FetchOptions = {}): Promise<unknown> {
  const body = await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  return JSON.parse(body) as unknown;
}
