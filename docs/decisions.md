# Decisions

Format: ID, date, decision, why. Newest at the bottom.

**D1 (2026-10-18) Stack.** Use the suggested stack: TypeScript, pnpm workspaces (via corepack; Node 20 LTS), Postgres on Supabase, Next.js (App Router) website, grammY bot, zod, vitest, cheerio for HTML parsing. No reason found to deviate.

**D2 (2026-10-18) One 18tickets adapter, configured per host.** 18tickets serves 4 circuits / 12 Rome venues (Circuito, Barberini/Alhambra, Cinema di Roma (Lux, Odeon, Intrastevere, Tibur), Greenwich/Mignon) with identical markup and the same `/film/fetch_films?date=` endpoint. Config entry = `{host, cinemaFilter?: name|id, cityFilter: "Roma"}`. Adding a new 18tickets cinema then becomes a config change.

**D3 (2026-10-18) Circuito comes from 18tickets, not circuitocinema.com.** circuitocinema.com booking slugs are inverted relative to the real language (verified against 18tickets pages; see sources.md §2). 18tickets exposes `Lingua:` per film entry, plus epoch-ms times.

**D4 (2026-10-18) Language model.** Each session stores:
- `language_class` ∈ {`vo_it_subs`, `vo_en_subs`, `vo_no_subs`, `dubbed_it`, `unknown`} (as specified)
- `audio_language` (ISO 639-1 or null; e.g. Lux "Inglese" → `en`, Piccoli "inglese, islandese" → `en,is`; else from TMDB `original_language` when VO)
- `subtitle_language` (ISO or null) + `subtitle_source` ∈ {`stated`, `assumed`}
- `confidence` 0–1, `reasons[]`.

When a source says only "original language" (The Space `LINGUA ORIGINALE`, Adriano `ORIGINAL VERSION`), we classify `vo_it_subs` with `subtitle_source=assumed` and confidence ≤ 0.75. The UI shows "Italian subtitles (likely)". We never infer English subtitles.

**D5 (2026-10-18) User-Agent.** `Mozilla/5.0 (compatible; RomeVOBot/<ver>; +<project url>)`. A bare `RomeVOBot/…` UA gets 403 from Casa del Cinema. The "compatible" form is the standard way bots identify themselves (Googlebot uses it) and still names us. No personal email goes in the UA.

**D6 (2026-10-18) The Space session cookie.** The adapter GETs one public HTML page to obtain the site's anonymous `microservicesToken` cookie, then calls the JSON API, and re-fetches the cookie on 401. This is the site's normal guest session, not a bot-detection bypass. If Cloudflare ever serves a challenge page (HTML instead of JSON, or a 403 with `cf-mitigated`), the adapter stops and marks the source degraded. It never tries to solve the challenge.

**D7 (2026-10-18) Troisi language from Liveticket.** JSON-LD gives sessions but not language. The Liveticket `opera.aspx?Id=` title ends in ` - VOS` for VO. We fetch each unique opera id once and cache it for 7 days (~40 small requests per refresh at most, usually 0–5 new). The cinema default is *not* "VO unless doppiato": kids' matinées are dubbed.

**D8 (2026-10-18) Health "unexpected zero".** A source is degraded only if it returns zero sessions **for dates the source itself advertises as having shows** (18tickets `#date-baloons`, The Space `showingDates.hasShowings`), or if zod validation fails. A cinema dark on Mon–Wed (Moderno 19–21 Oct) is normal.

**D9 (2026-10-18) Cinema day.** A screening starting before 05:00 Europe/Rome belongs to the previous cinema day. If the source provides a day (UCI `day`), trust the source. Store `starts_at` as `timestamptz`; derive `cinema_day` as a `date` column.

**D10 (2026-10-18) Source session identity.** Upsert key = `(cinema_id, source_session_id)` where available (UCI performance id, 18tickets booking uuid, The Space sessionId, Liveticket evento id, cinebot evento id). Otherwise use the fallback hash `sha1(cinema|starts_at|normalized_title|language_class)` (Farnese, Adriano, Casa del Cinema).

**D11 (2026-10-18) Italian-language exclusion.** The default filter is VO **and** `films.original_language != 'it'` (from TMDB). Until a film is matched, a VO session with no TMDB match is still shown, labelled "check with cinema".

**D12 (2026-10-18) Scope adjustments.**
- Detour parked: no venue at present.
- Nuovo Sacher deferred to M5 as low-fidelity (film-level VO weekdays, no times).
- Added Rome venues found on shared platforms at no extra adapter cost: Alhambra, Tibur, Mignon, Atlantic.
- Intrastevere configured but currently shows no dates; recheck in M5.

**D13 (2026-10-18) Hosting (proposed, confirm in M5).**
- Scrapers: GitHub Actions cron (near-term every 2h, full 14-day sweep every 6h).
- DB: Supabase.
- Website: Vercel.
- Bot: grammY webhook as a Vercel function.
- Alert digests: GitHub Actions cron every 15 min, respecting quiet hours 23:00–08:00 Europe/Rome.

**D14 (2026-10-18) VO only, no subtitle modelling.** The user cares only about original audio. This supersedes D4: `language_class` ∈ {`vo`, `dubbed`, `unknown`}, plus `audio_language` when a source names it. "dubbed" means Italian audio (a dubbed foreign film or an Italian original). Subtitles are not stored separately.

**D15 (2026-10-18) Local-first hosting.** Supersedes D13. I can't create accounts on the user's behalf, so everything runs on the user's Mac: Homebrew Postgres 16, the bot via long polling (no public URL needed), and launchd agents for the bot (KeepAlive) and scrapes (every 2h near-term, every 6h full). README explains how to move to Supabase plus a host later.

**D16 (2026-10-18) Wikidata instead of TMDB.** Wikidata needs no API key and is CC0. It gives original language (P364), year, director, and IMDb and TMDB ids. Matching = full-text search restricted to film classes, scored on title (exact or prefix), director surname and year. Only films with upcoming VO/unknown sessions are looked up. TMDB ids are stored, so posters can be added later with a key.

**D17 (2026-10-18) Film identity.** Sessions group by `coalesce(wikidata_id, film_key)`, so different cinema titles for one film merge once matched. `film_key` strips version tags, event suffixes ("C.A.", "Anteprima", "FILM+APERITIVO"), date notes and parenthesised alternates.

**D18 (2026-10-18) Unknown-language sessions are shown, last.** Per the brief ("include but label"), `unknown` sessions appear in a separate "Language not confirmed" section at the end of each listing, and can be hidden in /settings. Low-confidence VO times get ⚠️. Italian-original films are hidden by default (toggle in /settings).

**D19 (2026-10-18) 18tickets rate limit.** 18tickets returns HTTP 429 when its circuits are fetched in parallel; the limit appears to be per client across all circuits, including white-label domains. All 18tickets hosts share one slot at 5 s per request, with up to 4 exponential-backoff retries on 429.

**D20 (2026-10-18) Snapshots deduplicated.** Raw responses are kept for 14 days, but identical bodies for the same URL are stored once. Otherwise 2-hourly runs would store gigabytes.

**D21 (2026-10-18) Labelled set.** `fixtures/labels.yaml` was bootstrapped from classifier output on the fixtures, then hand-reviewed. One label was corrected: Barberini lists "Pink Floyd – The Dark Side of the Moon" as Italiano, but it is an English-audio concert film. Uncertain items were left unlabelled. Result: classifier VO precision 1.0, recall 0.978 (171 listings); 1.0 / 1.0 with overrides.

**D22 (2026-10-18) Review fixes.**
- The scrape lock is released on exit.
- Deactivation only touches cinema days that returned sessions in a clean run.
- A cinema that suddenly returns nothing is marked degraded, even if the source advertises no dates.
- Film rows are locked in sorted order, so parallel sources can't deadlock, and one cinema's DB error can't abort the run.
- New-film alert keys are per title variant, so they survive Wikidata regrouping. A film reachable through two subscriptions appears once per digest.
- A digest marks sent only what it shows.
- Users who block the bot are deleted.
- Fallback session ids (Farnese) no longer include the language class.
- Booking links must be absolute http(s) URLs, and `"` is escaped.
- `/stop` works only in private chats and also deletes reports.
- An Italian original language hides a VO session only when the Wikidata match score is ≥ 0.6.

**D23 (2026-10-18) New adapters.**
- Casa del Cinema reads the calendar page's inline event list (one request).
- Adriano and Atlantic share the NVR adapter.
- Both sources tag VO consistently, so an untagged title emits an `untagged` signal: weak evidence of Italian audio, never decisive against a real tag.
- The classifier now treats "film in inglese" / "in lingua <language>" as VO with that audio language. This was found on Adriano, where I Diavoli and Trainspotting would otherwise have been missed.
- Nuovo Sacher is parked: it publishes no times anywhere.
- Labelled set: 253 listings, VO precision 1.0, recall 0.989 (1.0 with overrides).
