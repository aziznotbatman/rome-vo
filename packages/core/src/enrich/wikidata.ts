import { z } from 'zod';
import { fetchJson } from '../http.ts';
import { filmKey } from '../normalize.ts';

const API = 'https://www.wikidata.org/w/api.php';
/** film, animated film, documentary film, concert film, short film */
const FILM_CLASSES = ['Q11424', 'Q202866', 'Q93204', 'Q1641839', 'Q24862'];

/** Wikidata language item → ISO 639-1, for the languages we actually see. Others fall back to P218 lookup. */
const LANGUAGE_QIDS: Record<string, string> = {
  Q1860: 'en', Q150: 'fr', Q652: 'it', Q1321: 'es', Q188: 'de', Q5287: 'ja', Q9176: 'ko', Q7850: 'zh',
  Q727694: 'zh', Q9186: 'zh', Q5146: 'pt', Q7737: 'ru', Q809: 'pl', Q13955: 'ar', Q256: 'tr', Q9168: 'fa',
  Q1568: 'hi', Q9035: 'da', Q9027: 'sv', Q9043: 'no', Q25167: 'no', Q1412: 'fi', Q294: 'is', Q7411: 'nl',
  Q9129: 'el', Q9288: 'he', Q9067: 'hu', Q7913: 'ro', Q9056: 'cs', Q9299: 'sr', Q6654: 'hr', Q8798: 'uk',
  Q8108: 'ka', Q8785: 'hy', Q9217: 'th', Q9199: 'vi', Q9240: 'id', Q36510: 'ta', Q8097: 'te', Q1617: 'ro',
};

export interface FilmQuery {
  readonly title: string;
  readonly originalTitle?: string | null;
  readonly director?: string | null;
  readonly year?: number | null;
}

export interface FilmMatch {
  readonly wikidataId: string;
  readonly originalLanguage: string | null;
  readonly originalTitle: string | null;
  readonly year: number | null;
  readonly imdbId: string | null;
  readonly tmdbId: string | null;
  readonly confidence: number;
}

const claimValue = z.object({ mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).optional() }) });
const entitySchema = z.object({
  id: z.string(),
  labels: z.record(z.string(), z.object({ value: z.string() })).default({}),
  claims: z.record(z.string(), z.array(claimValue)).default({}),
});
const entitiesSchema = z.object({ entities: z.record(z.string(), entitySchema) });
type Entity = z.infer<typeof entitySchema>;

function claims(e: Entity, prop: string): unknown[] {
  return (e.claims[prop] ?? []).map((c) => c.mainsnak.datavalue?.value).filter((v) => v !== undefined);
}
const entityIds = (e: Entity, prop: string): string[] =>
  claims(e, prop).flatMap((v) => (typeof v === 'object' && v && 'id' in v ? [String((v as { id: string }).id)] : []));
const strings = (e: Entity, prop: string): string[] => claims(e, prop).filter((v): v is string => typeof v === 'string');
function earliestYear(e: Entity): number | null {
  const years = claims(e, 'P577').flatMap((v) => {
    const m = /^[+-](\d{4})/.exec((v as { time?: string }).time ?? '');
    return m ? [Number(m[1])] : [];
  });
  return years.length ? Math.min(...years) : null;
}

async function search(text: string): Promise<string[]> {
  const filter = FILM_CLASSES.map((q) => `P31=${q}`).join('|');
  const url = `${API}?action=query&list=search&format=json&srlimit=6&srsearch=${encodeURIComponent(`${text} haswbstatement:${filter}`)}`;
  const res = z.object({ query: z.object({ search: z.array(z.object({ title: z.string() })) }) }).parse(await fetchJson(url));
  return res.query.search.map((s) => s.title);
}

async function getEntities(ids: readonly string[], props: string): Promise<Entity[]> {
  if (ids.length === 0) return [];
  const url = `${API}?action=wbgetentities&format=json&props=${props}&languages=it|en&ids=${ids.join('|')}`;
  return Object.values(entitiesSchema.parse(await fetchJson(url)).entities);
}

async function isoForLanguage(qid: string): Promise<string | null> {
  const known = LANGUAGE_QIDS[qid];
  if (known) return known;
  const [lang] = await getEntities([qid], 'claims');
  return lang ? (strings(lang, 'P218')[0] ?? null) : null;
}

const surname = (name: string): string => filmKey(name).split(' ').pop() ?? '';

/** Score how well a candidate matches what the cinema told us (0–1). */
function score(q: FilmQuery, e: Entity, directorNames: readonly string[], thisYear: number): number {
  const keys = new Set([q.title, ...q.title.split(/\s+-\s+/), q.originalTitle].filter((t): t is string => Boolean(t)).map(filmKey));
  const labels = [...Object.values(e.labels).map((l) => l.value), ...strings(e, 'P1476').map(String)];
  const labelKeys = labels.map(filmKey);
  const exact = labelKeys.some((l) => keys.has(l));
  // "Il dottor Stranamore" vs the full label "Il dottor Stranamore - Ovvero: come ho imparato..."
  const prefix = labelKeys.some((l) => [...keys].some((k) => k.length >= 4 && l.startsWith(`${k} `)));
  const year = earliestYear(e);
  let s = exact ? 0.45 : prefix ? 0.4 : 0.1;
  if (q.director) s += directorNames.some((d) => surname(d) === surname(q.director ?? '')) ? 0.4 : -0.2;
  if (q.year && year) s += Math.abs(q.year - year) <= 1 ? 0.15 : -0.15;
  else if (!q.year && year && thisYear - year <= 2) s += 0.1; // unknown year: favour current releases
  return Math.max(0, Math.min(1, s));
}

/** Find the best Wikidata film for a cinema listing, or null if nothing is plausible. */
export async function matchFilm(q: FilmQuery, now: Date = new Date()): Promise<FilmMatch | null> {
  // "La Bambola - La Poupée" lists the Italian and original titles together: search each part too.
  const queries = [...new Set([q.title, ...q.title.split(/\s+-\s+/), q.originalTitle].filter((t): t is string => Boolean(t && t.length > 1)))];
  const found: string[] = [];
  for (const text of queries.slice(0, 3)) found.push(...(await search(text)));
  const ids = [...new Set(found)].slice(0, 8);
  const candidates = await getEntities(ids, 'labels|claims');
  const directorIds = [...new Set(candidates.flatMap((c) => entityIds(c, 'P57')))].slice(0, 50);
  const directors = new Map((await getEntities(directorIds, 'labels')).map((d) => [d.id, Object.values(d.labels).map((l) => l.value)]));

  const ranked = candidates
    .map((c) => ({ c, s: score(q, c, entityIds(c, 'P57').flatMap((id) => directors.get(id) ?? []), now.getFullYear()) }))
    .sort((a, b) => b.s - a.s);
  const best = ranked[0];
  if (!best || best.s < 0.45) return null;
  const langQid = entityIds(best.c, 'P364')[0];
  return {
    wikidataId: best.c.id,
    originalLanguage: langQid ? await isoForLanguage(langQid) : null,
    originalTitle: strings(best.c, 'P1476')[0] ?? best.c.labels.en?.value ?? null,
    year: earliestYear(best.c),
    imdbId: strings(best.c, 'P345')[0] ?? null,
    tmdbId: strings(best.c, 'P4947')[0] ?? null,
    confidence: Math.round(best.s * 100) / 100,
  };
}
