import { z } from 'zod';
import { fetchText } from '../http.ts';
import { cinemaDayOf } from '../time.ts';
import type { RawSession, Signal } from '../types.ts';
import { inRange, type SourceAdapter } from './types.ts';

const HOME = 'https://www.cinemadeipiccoli.com/';

const languageSchema = z.union([z.string(), z.object({ name: z.string().optional(), alternateName: z.string().optional() })]);
const nodeSchema = z.object({ '@id': z.string().optional(), '@type': z.string() }).passthrough();
const eventSchema = z.object({
  '@id': z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  startDate: z.string(),
  url: z.string().optional(),
  inLanguage: z.union([languageSchema, z.array(languageSchema)]).optional(),
  workPresented: z.object({ '@id': z.string() }).optional(),
  offers: z.union([z.object({ url: z.string().optional() }), z.array(z.object({ url: z.string().optional() }))]).optional(),
});
const movieSchema = z.object({
  name: z.string(),
  duration: z.string().optional(),
  image: z.string().optional(),
  director: z.union([z.object({ name: z.string() }), z.array(z.object({ name: z.string() }))]).optional(),
});

function languageNames(v: z.infer<typeof eventSchema>['inLanguage']): string[] {
  const list = v === undefined ? [] : Array.isArray(v) ? v : [v];
  return list.map((l) => (typeof l === 'string' ? l : (l.alternateName ?? l.name ?? ''))).filter(Boolean);
}

/** Parse schema.org Events (with linked Movies) from the homepage JSON-LD. */
export function parsePiccoliHome(cinemaSlug: string, html: string): RawSession[] {
  const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!json) throw new Error('No JSON-LD on Piccoli homepage');
  const graph = z.object({ '@graph': z.array(nodeSchema) }).parse(JSON.parse(json))['@graph'];
  const movies = new Map(graph.filter((n) => n['@type'] === 'Movie' && n['@id']).map((n) => [n['@id'] as string, movieSchema.parse(n)]));

  return graph
    .filter((n) => n['@type'] === 'Event')
    .map((n) => {
      const e = eventSchema.parse(n);
      const movie = e.workPresented ? movies.get(e.workPresented['@id']) : undefined;
      const offer = Array.isArray(e.offers) ? e.offers[0] : e.offers;
      const director = Array.isArray(movie?.director) ? movie?.director[0]?.name : movie?.director?.name;
      const signals: Signal[] = [{ kind: 'title', value: e.name }];
      if (e.description) signals.push({ kind: 'description', value: e.description });
      for (const lang of languageNames(e.inLanguage)) signals.push({ kind: 'note', value: `inLanguage ${lang}` });
      return {
        cinemaSlug,
        sourceSessionId: /#screening-(\d+)/.exec(e['@id'] ?? e.url ?? '')?.[1] ?? null,
        startsAt: e.startDate,
        title: movie?.name ?? e.name.replace(/\s+-\s+\p{L}+\s+\d{1,2}\s+\p{L}+\s+\d{4}\s+\d{2}:\d{2}$/u, ''),
        director: director ?? null,
        runtimeMin: Number(/PT(\d+)M/.exec(movie?.duration ?? '')?.[1]) || null,
        posterUrl: movie?.image ?? null,
        bookingUrl: offer?.url ?? e.url ?? null,
        signals,
      };
    });
}

export const piccoliAdapter: SourceAdapter = async (source, ctx) => {
  const cinema = source.cinemas[0];
  if (!cinema) throw new Error('piccoli source needs one cinema');
  const sessions = parsePiccoliHome(cinema.slug, await fetchText(HOME)).filter((s) => inRange(cinemaDayOf(s.startsAt), ctx.range));
  return { cinemas: [{ cinemaSlug: cinema.slug, sessions, advertisedDates: null }], errors: [] };
};
