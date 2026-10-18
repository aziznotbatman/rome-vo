import type pg from 'pg';
import { GrammyError, type Api } from 'grammy';
import { isDigestDue, markSent, pendingDigest, subscribersWithAlerts, type DigestItem } from '@romevo/core/alerts';
import { errorMessage, log } from '@romevo/core/log';
import { deleteSubscriber, ensureSubscriber } from '@romevo/core/subscribers';
import { escapeHtml } from '@romevo/core/telegram';
import { romeParts } from '@romevo/core/time';
import { dayLabel } from './format.ts';
import { t, type Strings } from './i18n.ts';

const MAX_ITEMS = 15;

export function renderDigest(items: readonly DigestItem[], str: Strings): string {
  const lines = items.slice(0, MAX_ITEMS).map((i) => {
    const when = `${dayLabel(romeParts(i.firstStartsAt).date)} ${romeParts(i.firstStartsAt).hhmm}`;
    const what = i.kind === 'new_film' ? str.digestNewFilm : str.digestNewSessions(i.sessions);
    const where = i.cinemaName ? ` · ${escapeHtml(i.cinemaName)}` : '';
    return `• <b>${escapeHtml(i.filmTitle)}</b> — ${what}${where} (from ${when}) /f${i.filmId}`;
  });
  return `${str.digestTitle}\n\n${lines.join('\n')}`;
}

/** Send due digests. Each item is marked sent only after Telegram accepted the message. */
export async function sendDueDigests(db: pg.Pool, api: Api): Promise<number> {
  let sent = 0;
  for (const chatId of await subscribersWithAlerts(db)) {
    try {
      const sub = await ensureSubscriber(db, chatId);
      if (!isDigestDue(sub)) continue;
      // Only what is shown gets marked sent; anything beyond MAX_ITEMS goes in the next digest.
      const items = (await pendingDigest(db, sub)).slice(0, MAX_ITEMS);
      if (items.length === 0) continue;
      await api.sendMessage(chatId, renderDigest(items, t(sub.locale)), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
      await markSent(db, chatId, items);
      sent++;
    } catch (error: unknown) {
      if (error instanceof GrammyError && error.error_code === 403) {
        // The user blocked the bot or deleted the chat: forget them, as /stop would.
        await deleteSubscriber(db, chatId);
        log.info('subscriber removed (bot blocked)', { chatId });
        continue;
      }
      log.warn('digest failed', { chatId, error: errorMessage(error) });
    }
  }
  return sent;
}
