/** Evidence about the audio language of a session, as emitted by an adapter. */
export type SignalKind =
  | 'structured_language' // a dedicated language field (UCI language.slug, The Space Language attribute)
  | 'lingua_field' // free-text "Lingua: ..." field (18tickets)
  | 'title' // the displayed film title, which may carry "- V.O.S." etc.
  | 'label' // a badge next to the film (18tickets film-label)
  | 'time_tag' // a tag attached to one showtime (Farnese "vos ita")
  | 'page_title' // title of a linked booking page (Liveticket)
  | 'description' // free text that may say "Lingua: inglese" (Piccoli)
  | 'url_slug' // booking URL slug (weak)
  | 'untagged' // a source that tags VO consistently did not tag this one (weak Italian-audio evidence)
  | 'note'; // informational only, e.g. "autism friendly"

export interface Signal {
  readonly kind: SignalKind;
  readonly value: string;
}

/** What an adapter produces: one screening, before classification. */
export interface RawSession {
  readonly cinemaSlug: string;
  readonly sourceSessionId: string | null;
  /** ISO 8601 with offset. */
  readonly startsAt: string;
  /** Cinema day (YYYY-MM-DD) if the source states it. */
  readonly cinemaDay?: string;
  readonly title: string;
  readonly originalTitle?: string | null;
  readonly year?: number | null;
  readonly runtimeMin?: number | null;
  readonly director?: string | null;
  readonly posterUrl?: string | null;
  readonly bookingUrl: string | null;
  readonly room?: string | null;
  readonly signals: readonly Signal[];
  /** Hints for enrichment, e.g. { tmdbId: '627' } parsed from a poster filename. */
  readonly hints?: Readonly<Record<string, string>>;
}

export type LanguageClass = 'vo' | 'dubbed' | 'unknown';

export interface Classification {
  readonly languageClass: LanguageClass;
  readonly confidence: number;
  readonly reasons: readonly string[];
  /** ISO 639-1 audio language if a source states it explicitly. */
  readonly audioLanguage: string | null;
}

export interface Session extends RawSession, Classification {
  readonly filmKey: string;
  readonly displayTitle: string;
  readonly cinemaDay: string;
}

export interface DateRange {
  /** Inclusive, YYYY-MM-DD (Europe/Rome cinema days). */
  readonly from: string;
  readonly to: string;
}

export interface CinemaResult {
  readonly cinemaSlug: string;
  readonly sessions: readonly RawSession[];
  /** Dates the source itself says have shows (for health checks); null if unknown. */
  readonly advertisedDates: readonly string[] | null;
}

export interface AdapterResult {
  readonly cinemas: readonly CinemaResult[];
  /** Per-cinema failures; other cinemas of the same source still count. */
  readonly errors: readonly { cinemaSlug: string | null; message: string }[];
}
