/** UI strings. English is complete; add a locale by copying `en` and translating. */
const en = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  week: 'Next 7 days',
  noSessions: 'No original-language screenings match your filters.',
  noSessionsHint: 'Try /settings to widen filters, or /week.',
  vofilms: (n: number) => `${n} VO film${n === 1 ? '' : 's'}`,
  unconfirmed: '❓ Language not confirmed — check with the cinema',
  checkWithCinema: 'check with cinema',
  stale: 'data may be stale',
  page: (i: number, n: number) => `${i}/${n}`,
  filters: '⚙️ Filters',
  after18: '🕕 After 18:00',
  weekend: '🎉 Weekend only',
  includeItalian: '🇮🇹 Include Italian films',
  includeUnknown: '❓ Show unconfirmed language',
  cinemas: '🎬 Cinemas',
  allCinemas: 'All cinemas',
  nearMe: '📍 Sort by distance',
  clearLocation: '📍 Forget my location',
  digest: (h: number) => `🔔 Digest: every ${h}h`,
  back: '« Back',
  done: 'Done',
  settingsTitle: '<b>Filters</b>\nThese apply to /today, /tomorrow, /week, /film and /cinema.',
  cinemaPickTitle: '<b>Cinemas</b>\nTap to include/exclude. None selected = all.',
  shareLocation: 'Tap the button below to share your location. It is only used to sort cinemas by distance.',
  shareLocationButton: '📍 Share location',
  locationSaved: 'Got it — cinemas are now sorted by distance from you.',
  locationCleared: 'Location forgotten.',
  filmUsage: 'Usage: /film <title>, e.g. /film fatherland',
  filmNotFound: (q: string) => `No upcoming VO screenings found for “${q}”.`,
  filmPick: 'Which one?',
  cinemaUsage: 'Pick a cinema:',
  cinemaNotFound: (q: string) => `No cinema matches “${q}”.`,
  follow: '🔔 Follow',
  unfollow: '🔕 Unfollow',
  followed: 'Following. You will get a digest when new VO screenings appear.',
  unfollowed: 'Unfollowed.',
  subscribeTitle:
    '<b>Alerts</b>\nDigests are batched (see /settings for frequency) and never sent between 23:00 and 08:00.\nFollow a film from /film, or a cinema from /cinema.',
  newFilmsOn: '✅ Any new VO film in Rome',
  newFilmsOff: '☐ Any new VO film in Rome',
  following: 'Following:',
  digestTitle: '🎬 <b>New in original language</b>',
  digestNewFilm: 'New VO film',
  digestNewSessions: (n: number) => `${n} new screening${n === 1 ? '' : 's'}`,
  stopConfirm: 'This deletes your settings and alerts. Continue?',
  stopYes: 'Yes, delete everything',
  stopped: 'Deleted. Send /start any time to come back.',
  stopPrivateOnly: 'Use /stop in a private chat with the bot.',
  reportUsage: 'Usage: /report <what is wrong>, e.g. /report Digger at Lux 21:15 is dubbed, not VO',
  reportThanks: 'Thanks — the report was saved.',
  help:
    '<b>Rome original-language cinema</b>\n' +
    'Only screenings in the original language (VO/VOS) across Rome cinemas.\n\n' +
    '/today — VO screenings today\n/tomorrow — tomorrow\n/week — next 7 days\n' +
    '/film <i>title</i> — one film\n/cinema <i>name</i> — one cinema\n' +
    '/settings — filters (time, cinemas, distance, Italian films)\n/subscribe — alerts for new VO films\n' +
    '/report <i>text</i> — report a wrong label\n/stop — delete your data\n\n' +
    'Tap a time to book. ⚠️ = language not certain, check with the cinema. Film data from Wikidata.',
};

export type Strings = typeof en;

const LOCALES: Record<string, Strings> = { en };

export function t(locale: string | undefined): Strings {
  return LOCALES[locale ?? 'en'] ?? en;
}
