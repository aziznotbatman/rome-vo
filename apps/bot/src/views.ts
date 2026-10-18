import type pg from 'pg';
import { InlineKeyboard } from 'grammy';
import { filmGroupOf, listCinemas, listVoSessions, type Prefs } from '@romevo/core/queries';
import { isSubscribed } from '@romevo/core/subscribers';
import { escapeHtml } from '@romevo/core/telegram';
import { addDays, todayRome } from '@romevo/core/time';
import { dayLabel, renderListing } from './format.ts';
import type { Strings } from './i18n.ts';

/**
 * A view is a compact, callback-safe id (Telegram allows 64 bytes of callback data):
 * "t" today, "m" tomorrow, "w" next 7 days, "f<filmId>" one film, "c<cinemaId>" one cinema.
 */
export type ViewId = string;

export interface Rendered {
  readonly text: string;
  readonly keyboard: InlineKeyboard;
}

interface ViewSpec {
  readonly title: string;
  readonly from: string;
  readonly to: string;
  readonly multiDay: boolean;
  readonly filmGroup?: string;
  readonly cinemaSlug?: string;
  readonly follow?: { kind: 'film' | 'cinema'; id: number };
}

async function resolveView(db: pg.Pool, view: ViewId, str: Strings): Promise<ViewSpec | null> {
  const today = todayRome();
  if (view === 't') return { title: `${str.today} · ${dayLabel(today)}`, from: today, to: today, multiDay: false };
  if (view === 'm') {
    const d = addDays(today, 1);
    return { title: `${str.tomorrow} · ${dayLabel(d)}`, from: d, to: d, multiDay: false };
  }
  if (view === 'w') return { title: str.week, from: today, to: addDays(today, 6), multiDay: true };
  const id = Number(view.slice(1));
  if (!Number.isInteger(id)) return null;
  if (view.startsWith('f')) {
    const film = await filmGroupOf(db, id);
    if (!film) return null;
    return { title: escapeHtml(film.title), from: today, to: addDays(today, 13), multiDay: true, filmGroup: film.group, follow: { kind: 'film', id } };
  }
  if (view.startsWith('c')) {
    const cinema = (await listCinemas(db)).find((c) => c.id === id);
    if (!cinema) return null;
    return { title: escapeHtml(cinema.name), from: today, to: addDays(today, 6), multiDay: true, cinemaSlug: cinema.slug, follow: { kind: 'cinema', id } };
  }
  return null;
}

export async function renderView(db: pg.Pool, chatId: number, prefs: Prefs, view: ViewId, page: number, str: Strings): Promise<Rendered | null> {
  const spec = await resolveView(db, view, str);
  if (!spec) return null;
  // A film or cinema page ignores the user's cinema filter: they asked for it explicitly.
  const effective: Prefs = spec.filmGroup || spec.cinemaSlug ? { ...prefs, cinemas: undefined } : prefs;
  const rows = await listVoSessions(db, { from: spec.from, to: spec.to, prefs: effective, filmGroup: spec.filmGroup, cinemaSlug: spec.cinemaSlug });
  const { pages } = renderListing(spec.title, rows, prefs, str, spec.multiDay);
  const current = Math.min(Math.max(page, 0), pages.length - 1);

  const kb = new InlineKeyboard();
  if (pages.length > 1) {
    kb.text(current > 0 ? '◀' : ' ', current > 0 ? `pg:${view}:${current - 1}` : 'noop')
      .text(str.page(current + 1, pages.length), 'noop')
      .text(current < pages.length - 1 ? '▶' : ' ', current < pages.length - 1 ? `pg:${view}:${current + 1}` : 'noop')
      .row();
  }
  kb.text(`${prefs.afterHour ? '✅ ' : ''}${str.after18}`, `qf:after:${view}`);
  if (spec.multiDay && !spec.filmGroup) kb.text(`${prefs.weekendOnly ? '✅ ' : ''}${str.weekend}`, `qf:weekend:${view}`);
  kb.row();
  if (spec.follow) {
    const on = await isSubscribed(db, chatId, spec.follow.kind, spec.follow.id);
    kb.text(on ? str.unfollow : str.follow, `${on ? 'unf' : 'fol'}:${spec.follow.kind[0]}${spec.follow.id}:${view}`);
  }
  kb.text(str.filters, 'set:menu');
  return { text: pages[current]!, keyboard: kb };
}
