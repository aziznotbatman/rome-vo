import { Bot, GrammyError, InlineKeyboard, Keyboard, type Context } from 'grammy';
import { requireEnv } from '@romevo/core/config';
import { getPool } from '@romevo/core/db/pool';
import { errorMessage, log } from '@romevo/core/log';
import { findCinemas, listCinemas, searchFilms } from '@romevo/core/queries';
import {
  deleteSubscriber, ensureSubscriber, isSubscribed, listSubscriptions, setDigestHours, subscribe, unsubscribe, updatePrefs,
} from '@romevo/core/subscribers';
import { escapeHtml } from '@romevo/core/telegram';
import { adminStatus } from './admin.ts';
import { sendDueDigests } from './digest.ts';
import { t } from './i18n.ts';
import { cinemaPicker, nextDigest, settingsMenu, togglePatch } from './settings.ts';
import { renderView, type Rendered, type ViewId } from './views.ts';

const DIGEST_INTERVAL_MS = 10 * 60_000;
const MAX_REPORT_CHARS = 1000;

const db = getPool();
const bot = new Bot(requireEnv('TELEGRAM_BOT_TOKEN'));
const adminChatId = Number(process.env.ADMIN_CHAT_ID || NaN);

const chatIdOf = (ctx: Context): number => {
  const id = ctx.chat?.id;
  if (id === undefined) throw new Error('update without chat');
  return id;
};

const html = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

async function reply(ctx: Context, r: Rendered): Promise<void> {
  await ctx.reply(r.text, { ...html, reply_markup: r.keyboard });
}

/** Edit the message a button belongs to; ignore Telegram's "message is not modified". */
async function edit(ctx: Context, r: Rendered): Promise<void> {
  try {
    await ctx.editMessageText(r.text, { ...html, reply_markup: r.keyboard });
  } catch (error: unknown) {
    if (!(error instanceof GrammyError && error.description.includes('not modified'))) throw error;
  }
}

async function showView(ctx: Context, view: ViewId, page = 0, mode: 'reply' | 'edit' = 'reply'): Promise<void> {
  const sub = await ensureSubscriber(db, chatIdOf(ctx));
  const str = t(sub.locale);
  const r = await renderView(db, sub.chatId, sub.prefs, view, page, str);
  if (!r) return void (await ctx.reply(str.noSessions));
  await (mode === 'edit' ? edit(ctx, r) : reply(ctx, r));
}

async function subscribeMenu(chatId: number): Promise<Rendered> {
  const str = t((await ensureSubscriber(db, chatId)).locale);
  const subs = await listSubscriptions(db, chatId);
  const kb = new InlineKeyboard().text(subs.some((s) => s.kind === 'new_films') ? str.newFilmsOn : str.newFilmsOff, 'sub:new').row();
  for (const s of subs.filter((x) => x.kind !== 'new_films')) {
    kb.text(`🔕 ${s.kind === 'film' ? '🎬' : '🏛'} ${s.label ?? '?'}`, `unf:${s.kind[0]}${s.targetId}:sub`).row();
  }
  const following = subs.filter((x) => x.kind !== 'new_films').length ? `\n\n${str.following}` : '';
  return { text: str.subscribeTitle + following, keyboard: kb };
}

// ---------- commands ----------

bot.command(['start', 'help'], async (ctx) => {
  const sub = await ensureSubscriber(db, chatIdOf(ctx), ctx.from?.language_code === 'it' ? 'en' : 'en');
  await ctx.reply(t(sub.locale).help, html);
});
bot.command('today', (ctx) => showView(ctx, 't'));
bot.command('tomorrow', (ctx) => showView(ctx, 'm'));
bot.command('week', (ctx) => showView(ctx, 'w'));
bot.hears(/^\/f(\d{1,9})(@\w+)?$/, (ctx) => showView(ctx, `f${ctx.match[1]}`));

bot.command('film', async (ctx) => {
  const sub = await ensureSubscriber(db, chatIdOf(ctx));
  const str = t(sub.locale);
  const query = ctx.match.trim();
  if (!query) return void (await ctx.reply(str.filmUsage));
  const hits = await searchFilms(db, query, sub.prefs);
  if (hits.length === 0) return void (await ctx.reply(str.filmNotFound(escapeHtml(query)), html));
  if (hits.length === 1) return showView(ctx, `f${hits[0]!.filmId}`);
  const kb = new InlineKeyboard();
  for (const h of hits) kb.text(`${h.title}${h.year ? ` (${h.year})` : ''} · ${h.sessions}`, `v:f${h.filmId}`).row();
  await ctx.reply(str.filmPick, { reply_markup: kb });
});

bot.command('cinema', async (ctx) => {
  const str = t((await ensureSubscriber(db, chatIdOf(ctx))).locale);
  const query = ctx.match.trim();
  const matches = query ? await findCinemas(db, query) : await listCinemas(db);
  if (matches.length === 0) return void (await ctx.reply(str.cinemaNotFound(escapeHtml(query)), html));
  if (matches.length === 1) return showView(ctx, `c${matches[0]!.id}`);
  const kb = new InlineKeyboard();
  matches.forEach((c, i) => {
    kb.text(c.name, `v:c${c.id}`);
    if (i % 2 === 1) kb.row();
  });
  await ctx.reply(str.cinemaUsage, { reply_markup: kb });
});

bot.command('settings', async (ctx) => reply(ctx, settingsMenu(await ensureSubscriber(db, chatIdOf(ctx)), t(undefined))));
bot.command('subscribe', async (ctx) => reply(ctx, await subscribeMenu(chatIdOf(ctx))));

bot.command('stop', async (ctx) => {
  const str = t(undefined);
  if (ctx.chat.type !== 'private') return void (await ctx.reply(str.stopPrivateOnly));
  await ctx.reply(str.stopConfirm, { reply_markup: new InlineKeyboard().text(str.stopYes, 'stop:yes') });
});

bot.command('report', async (ctx) => {
  const str = t(undefined);
  const text = ctx.match.trim();
  if (!text) return void (await ctx.reply(str.reportUsage));
  await db.query('insert into reports (chat_id, message) values ($1, $2)', [chatIdOf(ctx), text.slice(0, MAX_REPORT_CHARS)]);
  await ctx.reply(str.reportThanks);
});

bot.command('whoami', (ctx) => ctx.reply(`Your chat id: <code>${chatIdOf(ctx)}</code>`, html));

bot.command('admin', async (ctx) => {
  if (chatIdOf(ctx) !== adminChatId) return;
  await ctx.reply(await adminStatus(db), html);
});

bot.on('message:location', async (ctx) => {
  const { latitude, longitude } = ctx.message.location;
  await updatePrefs(db, chatIdOf(ctx), { lat: latitude, lon: longitude });
  await ctx.reply(t(undefined).locationSaved, { reply_markup: { remove_keyboard: true } });
});

// ---------- buttons ----------

bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

bot.callbackQuery(/^v:([a-z]\d{0,9})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showView(ctx, ctx.match[1]!, 0, 'edit');
});

bot.callbackQuery(/^pg:([a-z]\d{0,9}):(\d{1,3})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showView(ctx, ctx.match[1]!, Number(ctx.match[2]), 'edit');
});

bot.callbackQuery(/^qf:(after|weekend):([a-z]\d{0,9})$/, async (ctx) => {
  const chatId = chatIdOf(ctx);
  const patch = togglePatch(ctx.match[1]!, (await ensureSubscriber(db, chatId)).prefs);
  if (patch) await updatePrefs(db, chatId, patch);
  await ctx.answerCallbackQuery();
  await showView(ctx, ctx.match[2]!, 0, 'edit');
});

bot.callbackQuery(/^set:(\w+)$/, async (ctx) => {
  const chatId = chatIdOf(ctx);
  const action = ctx.match[1]!;
  const str = t(undefined);
  let sub = await ensureSubscriber(db, chatId);
  await ctx.answerCallbackQuery();
  if (action === 'cin') return edit(ctx, await cinemaPicker(db, sub.prefs, str));
  if (action === 'loc') {
    const kb = new Keyboard().requestLocation(str.shareLocationButton).oneTime().resized();
    return void (await ctx.reply(str.shareLocation, { reply_markup: kb }));
  }
  if (action === 'digest') await setDigestHours(db, chatId, nextDigest(sub.digestHours));
  const patch = togglePatch(action, sub.prefs);
  if (patch) await updatePrefs(db, chatId, patch);
  sub = await ensureSubscriber(db, chatId);
  await edit(ctx, settingsMenu(sub, str));
});

bot.callbackQuery(/^cin:(all|\d{1,9})$/, async (ctx) => {
  const chatId = chatIdOf(ctx);
  const prefs = (await ensureSubscriber(db, chatId)).prefs;
  let cinemas: string[] = [];
  if (ctx.match[1] !== 'all') {
    const slug = (await listCinemas(db)).find((c) => c.id === Number(ctx.match[1]))?.slug;
    const current = new Set(prefs.cinemas ?? []);
    if (slug) current.has(slug) ? current.delete(slug) : current.add(slug);
    cinemas = [...current];
  }
  const next = await updatePrefs(db, chatId, { cinemas });
  await ctx.answerCallbackQuery();
  await edit(ctx, await cinemaPicker(db, next, t(undefined)));
});

bot.callbackQuery(/^(fol|unf):([fc])(\d{1,9}):(\w{1,12})$/, async (ctx) => {
  const [, action, k, id, back] = ctx.match;
  const chatId = chatIdOf(ctx);
  const kind = k === 'f' ? 'film' : 'cinema';
  const str = t(undefined);
  if (action === 'fol') await subscribe(db, chatId, kind, Number(id));
  else await unsubscribe(db, chatId, kind, Number(id));
  await ctx.answerCallbackQuery(action === 'fol' ? str.followed : str.unfollowed);
  if (back === 'sub') await edit(ctx, await subscribeMenu(chatId));
  else await showView(ctx, back!, 0, 'edit');
});

bot.callbackQuery('sub:new', async (ctx) => {
  const chatId = chatIdOf(ctx);
  if (await isSubscribed(db, chatId, 'new_films', null)) await unsubscribe(db, chatId, 'new_films', null);
  else await subscribe(db, chatId, 'new_films', null);
  await ctx.answerCallbackQuery();
  await edit(ctx, await subscribeMenu(chatId));
});

bot.callbackQuery('stop:yes', async (ctx) => {
  if (ctx.chat?.type !== 'private') return void (await ctx.answerCallbackQuery());
  await deleteSubscriber(db, chatIdOf(ctx));
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t(undefined).stopped);
});

bot.catch(async (err) => {
  log.error('bot error', { error: errorMessage(err.error), update: err.ctx.update.update_id });
  if (err.ctx.callbackQuery) await err.ctx.answerCallbackQuery().catch(() => undefined);
});

// ---------- lifecycle ----------

await bot.api.setMyCommands([
  { command: 'today', description: 'VO screenings today' },
  { command: 'tomorrow', description: 'VO screenings tomorrow' },
  { command: 'week', description: 'Next 7 days' },
  { command: 'film', description: 'One film: /film title' },
  { command: 'cinema', description: 'One cinema: /cinema name' },
  { command: 'settings', description: 'Filters: time, cinemas, distance' },
  { command: 'subscribe', description: 'Alerts for new VO films' },
  { command: 'report', description: 'Report a wrong label' },
  { command: 'stop', description: 'Delete my data' },
  { command: 'help', description: 'How it works' },
]);

let digestRunning = false;
const timer = setInterval(() => {
  if (digestRunning) return; // a slow run must not overlap the next tick and double-send
  digestRunning = true;
  sendDueDigests(db, bot.api)
    .then((n) => n && log.info('digests sent', { n }))
    .catch((e: unknown) => log.error('digest loop failed', { error: errorMessage(e) }))
    .finally(() => {
      digestRunning = false;
    });
}, DIGEST_INTERVAL_MS);

const shutdown = (): void => {
  clearInterval(timer);
  void bot.stop().then(() => db.end());
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

log.info('bot starting', { admin: Number.isFinite(adminChatId) });
await bot.start({ drop_pending_updates: false, onStart: (me) => log.info('bot running', { username: me.username }) });
