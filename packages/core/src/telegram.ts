import { errorMessage, log } from './log.ts';

/** Fire-and-log Telegram message via the Bot API (used outside the bot process, e.g. by the scraper). */
export async function sendTelegram(chatId: string | number, html: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) log.warn('telegram send failed', { status: res.status, body: (await res.text()).slice(0, 200) });
    return res.ok;
  } catch (error: unknown) {
    log.warn('telegram send failed', { error: errorMessage(error) });
    return false;
  }
}

export async function notifyAdmin(html: string): Promise<void> {
  const admin = process.env.ADMIN_CHAT_ID;
  if (admin) await sendTelegram(admin, html);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Scraped links are untrusted: only absolute http(s) URLs may become clickable. */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
