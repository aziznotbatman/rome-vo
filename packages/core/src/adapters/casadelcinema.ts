import { mentionsOriginalLanguage } from '../classifier.ts';
import { fetchText } from '../http.ts';
import { decodeEntities } from '../normalize.ts';
import { cinemaDayOf, romeLocalToIso } from '../time.ts';
import type { RawSession, Signal } from '../types.ts';
import { inRange, type SourceAdapter } from './types.ts';

const CALENDAR = 'https://www.casadelcinema.it/it/calendar/';

/** One entry of the FullCalendar `events: [...]` literal embedded in the calendar page. */
export interface CalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly start: string; // local "YYYY-MM-DDTHH:MM"
}

/** The page inlines a JS object literal (not JSON), so entries are matched field by field. */
export function parseCalendar(html: string): CalendarEvent[] {
  const re = /\{\s*id:\s*(\d+),\s*title:\s*"((?:\\.|[^"\\])*)",\s*url:\s*"([^"]+)",\s*start:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/g;
  return [...html.matchAll(re)].map((m) => ({
    id: m[1]!,
    title: decodeEntities(m[2]!.replace(/\\(.)/g, '$1')),
    url: m[3]!.replace(/\\\//g, '/'),
    start: m[4]!,
  }));
}

/** "SHAME di Steve McQueen (v.o.s.)" → title "SHAME (v.o.s.)", director "Steve McQueen". */
export function splitDirector(title: string): { title: string; director: string | null } {
  const m = /^(.*?)\s+di\s+([^()]+?)(\s*\(.*\))?\s*$/.exec(title);
  if (!m || m[2]!.split(/\s+/).length > 5) return { title, director: null };
  return { title: `${m[1]}${m[3] ?? ''}`.trim(), director: m[2]!.trim() };
}

export function toCasaSession(cinemaSlug: string, e: CalendarEvent): RawSession {
  const { title, director } = splitDirector(e.title);
  // Casa del Cinema marks every foreign-language screening "(v.o.s.)"; untagged ones are Italian films.
  const signals: Signal[] = [{ kind: 'title', value: e.title }];
  if (!mentionsOriginalLanguage(e.title)) signals.push({ kind: 'untagged', value: 'casadelcinema' });
  return {
    cinemaSlug,
    sourceSessionId: `${e.id}:${e.start}`,
    startsAt: romeLocalToIso(e.start),
    title,
    director,
    bookingUrl: e.url,
    signals,
  };
}

export const casaDelCinemaAdapter: SourceAdapter = async (source, ctx) => {
  const cinema = source.cinemas[0];
  if (!cinema) throw new Error('casadelcinema source needs one cinema');
  const events = parseCalendar(await fetchText(CALENDAR));
  if (events.length === 0) {
    return { cinemas: [], errors: [{ cinemaSlug: cinema.slug, message: 'calendar has no events (layout change?)' }] };
  }
  const sessions = events.map((e) => toCasaSession(cinema.slug, e)).filter((s) => inRange(cinemaDayOf(s.startsAt), ctx.range));
  return { cinemas: [{ cinemaSlug: cinema.slug, sessions, advertisedDates: null }], errors: [] };
};
