import { z } from 'zod';
import { fetchText } from '../http.ts';
import { errorMessage } from '../log.ts';
import { decodeEntities } from '../normalize.ts';
import { cinemaDayOf, romeLocalToIso } from '../time.ts';
import type { RawSession, Signal } from '../types.ts';
import { inRange, type KvCache, type SourceAdapter } from './types.ts';

const HOME = 'https://cinematroisi.it/';
const OPERA_TTL_SECONDS = 7 * 24 * 3600;

const eventSchema = z.object({
  '@type': z.literal('Event'),
  name: z.string(),
  startDate: z.string(),
  image: z.string().optional(),
  offers: z.object({ url: z.string() }),
  workFeatured: z
    .object({
      name: z.string(),
      director: z.object({ name: z.string() }).optional(),
      duration: z.string().optional(),
    })
    .optional(),
});

export interface TroisiEvent {
  readonly eventId: string;
  readonly operaId: string | null;
  readonly name: string;
  readonly title: string;
  readonly startsAt: string;
  readonly director: string | null;
  readonly runtimeMin: number | null;
  readonly posterUrl: string | null;
  readonly bookingUrl: string;
}

/** Parse the JSON-LD @graph of Events on the Troisi homepage. */
export function parseTroisiHome(html: string): TroisiEvent[] {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');
  const nodes = blocks.flatMap((b) => {
    const d = JSON.parse(b) as { '@graph'?: unknown[] };
    return d['@graph'] ?? [d];
  });
  return nodes.flatMap((n) => {
    const parsed = eventSchema.safeParse(n);
    if (!parsed.success) return [];
    const e = parsed.data;
    const url = e.offers.url.replace(/^http:/, 'https:');
    const eventId = /evento\.aspx\?Id=(\d+)/i.exec(url)?.[1];
    if (!eventId) return [];
    return [
      {
        eventId,
        operaId: /opera\.aspx\?Id=(\d+)/i.exec(url)?.[1] ?? null,
        name: e.name,
        title: e.workFeatured?.name ?? e.name.replace(/\s+-\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}$/, ''),
        startsAt: romeLocalToIso(e.startDate),
        director: e.workFeatured?.director?.name ?? null,
        runtimeMin: Number(/PT(\d+)M/.exec(e.workFeatured?.duration ?? '')?.[1]) || null,
        posterUrl: e.image && !e.image.endsWith('null.png') ? e.image : null,
        bookingUrl: `https://www.liveticket.it/evento.aspx?Id=${eventId}`,
      },
    ];
  });
}

/** "<title>Biglietti Digger - VOS</title>" → "Digger - VOS". */
export function parseOperaTitle(html: string): string | null {
  const m = /<title>\s*(?:Biglietti\s+)?([\s\S]*?)\s*<\/title>/i.exec(html);
  return m?.[1] ? decodeEntities(m[1].replace(/\s+/g, ' ')) : null;
}

async function operaTitle(operaId: string, cache: KvCache): Promise<string | null> {
  const key = `liveticket:opera:${operaId}`;
  const hit = await cache.get(key);
  if (hit !== null) return hit;
  const title = parseOperaTitle(await fetchText(`https://www.liveticket.it/opera.aspx?Id=${operaId}`));
  if (title) await cache.set(key, title, OPERA_TTL_SECONDS);
  return title;
}

export function toTroisiSession(cinemaSlug: string, e: TroisiEvent, pageTitle: string | null): RawSession {
  const imdbId = /\/(tt\d{7,8})_/.exec(e.posterUrl ?? '')?.[1];
  const signals: Signal[] = [{ kind: 'title', value: e.name }];
  if (pageTitle) signals.push({ kind: 'page_title', value: pageTitle });
  return {
    cinemaSlug,
    sourceSessionId: e.eventId,
    startsAt: e.startsAt,
    title: e.title,
    director: e.director,
    runtimeMin: e.runtimeMin,
    posterUrl: e.posterUrl,
    bookingUrl: e.bookingUrl,
    signals,
    ...(imdbId ? { hints: { imdbId } } : {}),
  };
}

export const troisiAdapter: SourceAdapter = async (source, ctx) => {
  const cinema = source.cinemas[0];
  if (!cinema) throw new Error('troisi source needs one cinema');
  const events = parseTroisiHome(await fetchText(HOME)).filter((e) => inRange(cinemaDayOf(e.startsAt), ctx.range));
  const errors: { cinemaSlug: string; message: string }[] = [];
  const titles = new Map<string, string | null>();
  for (const operaId of new Set(events.map((e) => e.operaId).filter((x): x is string => x !== null))) {
    try {
      titles.set(operaId, await operaTitle(operaId, ctx.cache));
    } catch (error: unknown) {
      // Missing language evidence only lowers confidence; the session is still listed.
      errors.push({ cinemaSlug: cinema.slug, message: `opera ${operaId}: ${errorMessage(error)}` });
    }
  }
  const sessions = events.map((e) => toTroisiSession(cinema.slug, e, e.operaId ? (titles.get(e.operaId) ?? null) : null));
  return { cinemas: [{ cinemaSlug: cinema.slug, sessions, advertisedDates: null }], errors };
};
