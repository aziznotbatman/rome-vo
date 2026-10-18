export const TZ = 'Europe/Rome';
/** Screenings starting before this hour belong to the previous cinema day. */
export const CINEMA_DAY_CUTOFF_HOUR = 5;

const offsetFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' });
const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

/** Rome UTC offset in minutes at a given instant, e.g. 120 in summer. */
function romeOffsetMinutes(instant: Date): number {
  const name = offsetFormatter.formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function pad(n: number, w = 2): string {
  return String(Math.abs(n)).padStart(w, '0');
}

function formatOffset(min: number): string {
  return `${min < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;
}

/** "2026-10-18 15:20[:00]" or "2026-10-18T15:20" interpreted as Rome wall time → ISO with offset. */
export function romeLocalToIso(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(local.trim());
  if (!m) throw new Error(`Unparseable local time: ${local}`);
  const [, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  // Two passes handle instants near a DST switch.
  let offset = romeOffsetMinutes(new Date(asUtc));
  offset = romeOffsetMinutes(new Date(asUtc - offset * 60_000));
  return `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}${formatOffset(offset)}`;
}

export interface RomeParts {
  readonly date: string; // YYYY-MM-DD
  readonly hour: number;
  readonly minute: number;
  readonly hhmm: string;
  readonly weekday: string; // Mon..Sun
}

export function romeParts(instant: Date | string): RomeParts {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = Object.fromEntries(partsFormatter.formatToParts(d).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute,
    hhmm: `${pad(hour)}:${pad(minute)}`,
    weekday: String(parts.weekday),
  };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** The cinema day a screening belongs to (after-midnight shows count for the previous day). */
export function cinemaDayOf(startsAt: string): string {
  const p = romeParts(startsAt);
  return p.hour < CINEMA_DAY_CUTOFF_HOUR ? addDays(p.date, -1) : p.date;
}

/** Today's cinema day in Rome. */
export function todayRome(now: Date = new Date()): string {
  return cinemaDayOf(now.toISOString());
}

export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isWeekend(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6 || dow === 5; // Fri evening counts as weekend for cinema-going
}

export function epochMsToIso(ms: number): string {
  const p = romeParts(new Date(ms));
  return romeLocalToIso(`${p.date} ${p.hhmm}`);
}

const IT_MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

/** Month number (1-12) from an Italian month name, or null. */
export function italianMonth(name: string): number | null {
  const i = IT_MONTHS.indexOf(name.trim().toLowerCase());
  return i === -1 ? null : i + 1;
}

/** Resolve "27/10" (no year) to the nearest date not more than 30 days in the past. */
export function resolveDayMonth(day: number, month: number, today: string): string {
  const year = Number(today.slice(0, 4));
  const candidate = `${year}-${pad(month)}-${pad(day)}`;
  return candidate < addDays(today, -30) ? `${year + 1}-${pad(month)}-${pad(day)}` : candidate;
}
