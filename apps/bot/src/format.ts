import { LOW_CONFIDENCE } from '@romevo/core/classifier';
import { distanceKm, type Prefs, type SessionRow } from '@romevo/core/queries';
import { escapeHtml, safeUrl } from '@romevo/core/telegram';
import { romeParts } from '@romevo/core/time';
import type { Strings } from './i18n.ts';

const PAGE_CHARS = 3600; // Telegram limit is 4096; leave room for the header
const FILMS_PER_PAGE = 7;

const DAY_NAMES: Record<string, string> = { Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat', Sun: 'Sun' };

export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = DAY_NAMES[romeParts(d).weekday] ?? '';
  return `${weekday} ${Number(date.slice(8, 10))} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
}

function timeLink(s: SessionRow): string {
  const hhmm = romeParts(s.startsAt).hhmm;
  const url = safeUrl(s.bookingUrl);
  const shown = url ? `<a href="${escapeHtml(url)}">${hhmm}</a>` : hhmm;
  return s.languageClass === 'vo' && s.confidence >= LOW_CONFIDENCE ? shown : `${shown}⚠️`;
}

function cinemaLabel(s: SessionRow, prefs: Prefs, str: Strings): string {
  const parts = [`${escapeHtml(s.cinemaName)}`];
  if (prefs.lat !== undefined && prefs.lon !== undefined && s.lat !== null && s.lon !== null) {
    parts.push(`${distanceKm(prefs.lat, prefs.lon, s.lat, s.lon).toFixed(1)} km`);
  } else {
    parts.push(escapeHtml(s.area));
  }
  const label = parts.join(' · ');
  return s.cinemaStatus === 'degraded' ? `${label} <i>(${str.stale})</i>` : label;
}

function filmHeader(rows: readonly SessionRow[]): string {
  const f = rows[0]!;
  const lang = (rows.find((r) => r.audioLanguage)?.audioLanguage ?? f.originalLanguage ?? '').toUpperCase();
  const meta = [lang, f.year].filter(Boolean).join(' · ');
  return `<b>${escapeHtml(f.filmTitle)}</b>${meta ? ` <i>${meta}</i>` : ''}`;
}

function groupBy<T, K>(items: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i]);
  return m;
}

/** One film's block: a header and one line per cinema with its times (prefixed by day when multi-day). */
export function filmBlock(rows: readonly SessionRow[], prefs: Prefs, str: Strings, multiDay: boolean): string {
  const byCinema = [...groupBy(rows, (r) => r.cinemaId).values()];
  if (prefs.lat !== undefined && prefs.lon !== undefined) {
    const d = (r: SessionRow): number => (r.lat !== null && r.lon !== null ? distanceKm(prefs.lat!, prefs.lon!, r.lat, r.lon) : 999);
    byCinema.sort((a, b) => d(a[0]!) - d(b[0]!));
  }
  const lines = byCinema.map((cs) => {
    const times = multiDay
      ? [...groupBy(cs, (r) => r.cinemaDay)].map(([day, rs]) => `${dayLabel(day).split(' ')[0]} ${dayLabel(day).split(' ')[1]}: ${rs.map(timeLink).join(' ')}`).join(' · ')
      : cs.map(timeLink).join(' ');
    return `  ${cinemaLabel(cs[0]!, prefs, str)} — ${times}`;
  });
  return [filmHeader(rows), ...lines].join('\n');
}

export interface RenderedListing {
  readonly pages: string[];
  readonly filmCount: number;
}

/** Render sessions grouped by film then cinema, split into mobile-sized pages. Unconfirmed films go last. */
export function renderListing(title: string, rows: readonly SessionRow[], prefs: Prefs, str: Strings, multiDay: boolean): RenderedListing {
  if (rows.length === 0) return { pages: [`🎬 <b>${title}</b>\n\n${str.noSessions}\n${str.noSessionsHint}`], filmCount: 0 };
  const films = [...groupBy(rows, (r) => r.filmGroup).values()];
  const confirmed = films.filter((f) => f.some((r) => r.languageClass === 'vo'));
  const unconfirmed = films.filter((f) => !f.some((r) => r.languageClass === 'vo'));
  const blocks = [
    ...confirmed.map((f) => filmBlock(f.filter((r) => r.languageClass === 'vo'), prefs, str, multiDay)),
    ...unconfirmed.map((f, i) => (i === 0 ? `<i>${str.unconfirmed}</i>\n` : '') + filmBlock(f, prefs, str, multiDay)),
  ];
  const header = `🎬 <b>${title}</b> — ${str.vofilms(confirmed.length)}`;
  const pages: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const b of blocks) {
    if (current.length > 0 && (size + b.length > PAGE_CHARS || current.length >= FILMS_PER_PAGE)) {
      pages.push(current.join('\n\n'));
      current = [];
      size = 0;
    }
    current.push(b);
    size += b.length + 2;
  }
  if (current.length) pages.push(current.join('\n\n'));
  return { pages: pages.map((p) => `${header}\n\n${p}`), filmCount: confirmed.length };
}
