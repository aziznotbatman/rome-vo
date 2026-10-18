import type pg from 'pg';
import { InlineKeyboard } from 'grammy';
import { listCinemas, type Prefs } from '@romevo/core/queries';
import { DIGEST_CHOICES, type Subscriber } from '@romevo/core/subscribers';
import type { Strings } from './i18n.ts';
import type { Rendered } from './views.ts';

const check = (on: boolean | undefined): string => (on ? '✅ ' : '☐ ');

export function settingsMenu(sub: Subscriber, str: Strings): Rendered {
  const p = sub.prefs;
  const located = p.lat !== undefined && p.lon !== undefined;
  const cinemaCount = p.cinemas?.length ?? 0;
  const kb = new InlineKeyboard()
    .text(check(Boolean(p.afterHour)) + str.after18, 'set:after').row()
    .text(check(p.weekendOnly) + str.weekend, 'set:weekend').row()
    .text(check(p.includeItalian) + str.includeItalian, 'set:ita').row()
    .text(check(p.includeUnknown ?? true) + str.includeUnknown, 'set:unk').row()
    .text(`${str.cinemas}: ${cinemaCount ? cinemaCount : str.allCinemas}`, 'set:cin').row()
    .text(located ? str.clearLocation : str.nearMe, located ? 'set:locclear' : 'set:loc').row()
    .text(str.digest(sub.digestHours), 'set:digest');
  return { text: str.settingsTitle, keyboard: kb };
}

export async function cinemaPicker(db: pg.Pool, prefs: Prefs, str: Strings): Promise<Rendered> {
  const selected = new Set(prefs.cinemas ?? []);
  const kb = new InlineKeyboard();
  (await listCinemas(db)).forEach((c, i) => {
    kb.text(`${selected.has(c.slug) ? '✅' : '☐'} ${c.name}`, `cin:${c.id}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(str.allCinemas, 'cin:all').text(str.back, 'set:menu');
  return { text: str.cinemaPickTitle, keyboard: kb };
}

/** Apply one settings toggle; returns the prefs patch (or null if the action is not a prefs toggle). */
export function togglePatch(action: string, prefs: Prefs): Partial<Prefs> | null {
  switch (action) {
    case 'after':
      return { afterHour: prefs.afterHour ? null : 18 };
    case 'weekend':
      return { weekendOnly: !prefs.weekendOnly };
    case 'ita':
      return { includeItalian: !prefs.includeItalian };
    case 'unk':
      return { includeUnknown: !(prefs.includeUnknown ?? true) };
    case 'locclear':
      return { lat: undefined, lon: undefined };
    default:
      return null;
  }
}

export function nextDigest(hours: number): number {
  const i = DIGEST_CHOICES.indexOf(hours as (typeof DIGEST_CHOICES)[number]);
  return DIGEST_CHOICES[(i + 1) % DIGEST_CHOICES.length] ?? 24;
}
