# Sources (M0 discovery, probed live 2026-10-18)

All findings below were observed live on 2026-10-18 (Sunday). Raw responses are in `fixtures/<source>/`.
"VO signal" = where the source says the session is in original language.

## Summary

| # | Cinema(s) | Platform | Access method | VO signal | Horizon seen | Difficulty | Milestone |
|---|-----------|----------|---------------|-----------|--------------|------------|-----------|
| 1 | UCI Porta di Roma, Roma Est, Parco Leonardo, Luxe Maximo | UCI JSON API | Unauthenticated JSON | `language.slug` + `subtitles.name` per screen variant | ≥ 4 weeks (presales) | Easy | M1 |
| 2 | Circuito: Quattro Fontane, Eurcine, Giulio Cesare, Nuovo Olimpia | 18tickets (`ccroma`) | `GET /film/fetch_films?date=` (Rails UJS JS→HTML) | Separate film entry: title `- V.O.S.`, `film-label` badge, `Lingua:` field | ~3–4 weeks | Easy/medium | M1 |
| 3 | Barberini, Alhambra | 18tickets (`barberini`) | same adapter | `Lingua:` field (titles inconsistent: `- V. O.`, `- V.O`, none) | Barberini ~1 wk, Alhambra today only | Easy/medium | M2 |
| 4 | Lux, Odeon, Intrastevere, Tibur | 18tickets (`cdr`, "Cinema di Roma") | same adapter | `- ORIGINAL LANGUAGE` + `Lingua: Inglese con sottotitoli in Italiano` | ~1 wk | Easy/medium | M5 (adapter free) |
| 5 | Greenwich, Mignon | 18tickets (custom domain `*.multisalagreenwichroma.com`) | same adapter | `- V. O.` + `Lingua: ORIGINALE con sottotitoli italiani` | ~1 wk | Easy/medium | M5 (adapter free) |
| 6 | The Space Moderno, Parco de' Medici | The Space microservice JSON | JSON + anonymous session cookie | Session attribute `attributeType=Language`: `ITALIANO` / `LINGUA ORIGINALE` | 7 days (`showingDates`) | Medium | M2 |
| 7 | Cinema Troisi | WordPress (hosted by Liveticket) + Liveticket | Homepage JSON-LD `Event` graph + Liveticket `opera.aspx` title | Liveticket title suffix ` - VOS` | ~1 month | Medium | M2 |
| 8 | Cinema dei Piccoli | Custom site + cinebot.it ticketing | Homepage JSON-LD `Event` graph | `description`: `Lingua: … Sottotitoli: …` (explicit!) | ~1 wk | Easy | M5 |
| 9 | Farnese | WordPress + 2tickets.it | Homepage HTML | Per-time suffix `vos ita` / `ita` | 4 days | Easy | M5 |
| 10 | Casa del Cinema | WordPress (EventChamp) + Boxol | Calendar page's inline FullCalendar `events: [...]` | Title `(v.o.s.)`; untagged = Italian film | ~6 wks | Easy | **Done** |
| 11 | Adriano, Atlantic | NVR Cinema custom PHP ("cvu") | HTML `filmContainer` blocks | Title `| ORIGINAL VERSION` or `| FILM IN INGLESE`; untagged = Italian | ~10 days | Medium | **Done** |
| 12 | Nuovo Sacher | WordPress (Elementor) | WP REST `/wp-json/wp/v2/film` + film page | Separate post, slug `-vo`, heading `V. O. sottotitolata` | **No showtimes published** (rechecked 2026-10-18) | Not feasible | Parked |
| 13 | Detour | WordPress | — | All VO | **No current venue** ("roaming" mode; programme page last updated 2024) | n/a | Parked |

Out of scope found along the way: Circuito/18tickets also lists Napoli/Firenze/Bologna venues (filter by address city = Roma).

---

## 1. UCI Cinemas — JSON API

- Base: `https://myuci---uci-backend-production-nfluwp7wga-oc.a.run.app/api` (Cloud Run, no auth, no cookies). robots.txt: allow all.
- `GET /theatres` → `{data: Theatre[]}`. Rome theatres (field `latitude`/`longitude` are **strings**):

  | id | slug | lat, lon |
  |----|------|----------|
  | 12 | `uci-cinemas-porta-di-roma-roma` | 41.971355, 12.5414713 |
  | 14 | `uci-cinemas-romaest-roma` | 41.9159171, 12.6617884 |
  | 11 | `uci-cinemas-parco-leonardo-roma` (Fiumicino; `city` says "Roma") | 41.7983211, 12.2954392 |
  | 60 | `uci-luxe-maximo` | 41.8076205, 12.4851106 |

- `GET /theatres/{slug}/programming/{YYYY-MM-DD}` → `{data: Movie[], meta}`. Confirmed. Dates weeks ahead return data (presales).
  - `Movie.screens` is an **array of single-key objects** `{ "<ScreenName>": Variant[] }` (e.g. `IMAX`, `2D`, `ISENSE`).
  - `Variant`: `slug`, `language {slug,name}`, `subtitles {name} | null`, `duration "HH:MM"`, `release_date`, `performances[]`.
  - `Performance`: `id`, `external_id`, `room`, `starts_at "YYYY-MM-DD HH:MM:SS"` (local Europe/Rome, no offset), `day` (cinema day), `cart_link` (relative to `https://ucicinemas.it`).
- `GET /movies/{slug}` → detail with `directors`, `actors`, `release_date`, `duration` (minutes), `distributor`. **No original title.** Use for TMDB matching.
- **Language values observed** (all Rome theatres, 3 dates):
  - `ITA / subtitles=null` → dubbed (104 variants)
  - `EN / subtitles=ITA` → VO English, Italian subs (variant slug `ov-street-fighter`)
  - `DSA / name "AUTISM FRIENDLY"` → **not a language**; autism‑friendly screening of the Italian version. Must not be read as VO.
- VO is rare at UCI (one film across 4 theatres today), but it's cleanly flagged.

## 2–5. 18tickets (one adapter, many hosts)

18tickets ("18Months") is a Rails app. Every circuit has a host; each cinema has a subdomain.

**Endpoint:** `GET https://<host>/film/fetch_films?date=YYYY-MM-DD[&cinema=<id>]` with header `X-Requested-With: XMLHttpRequest`.
Returns `text/javascript`: a series of `$("#selector").html('<escaped html>')` calls. The `#movie-list` fragment holds the programme.
`#date-baloons` lists the dates that have shows (`data-target='YYYY-MM-DD'`): use it to find the horizon instead of blind-probing 14 days.
An empty day returns no `#movie-list` and a `Swal.fire(... 'Nessuno spettacolo ...')`.
There is no JSON endpoint: `*.json` returns 406. robots.txt: 404, so nothing is disallowed.

**Per film entry** (`div.movie.movie--preview`):
- `a.movie__title` text: title, often with a VO suffix. Link `https://<host>/film/<filmId>`
- `div.film-label` badges: `V.O.S.`, `V.M. 14`, `FILM EVENTO`, `V. RESTAURATA`
- `p.movie__option` with `Regia:`, `Con:`, `Lingua:`
- schedule blocks per cinema: `div.time-select__place` (date text, Google Maps address `?q=…`, cinema name) + `a[data-time=<epoch ms>]` with booking href `https://<sub>.<host>/film/<filmId>/<uuid>#theater-init` and room name.

**VO is modelled as a separate film entry** (e.g. `FATHERLAND` vs `FATHERLAND - V.O.S.`, different film ids). So `Lingua:` applies to every session in the entry.

| Host | Cinemas (id) | VO title pattern | `Lingua:` values seen |
|------|--------------|------------------|----------------------|
| `ccroma.18tickets.it` | Quattro Fontane (1), Eurcine (2), Giulio Cesare (4), Nuovo Olimpia (8); plus Firenze/Napoli/Bologna (filter on address) | `- V.O.S.` | `Italiano`, `italiano`, `Originale con (i) sottotitoli (in) italian(o/i)` (4 variants) |
| `cinema.barberini.18tickets.it`, `alhambra.barberini.18tickets.it` | Barberini, Alhambra (per subdomain; the circuit root returns Barberini) | `- V. O.`, `- V.O`, `- V. O. - FILM+APERITIVO`, **or none** (`I DIAVOLI (THE DEVILS)`) | `Lingua originale con sott. in italiano`, `Italiano` |
| `lux.cdr.18tickets.it`, `odeon.cdr…`, `intrastevere.cdr…`, `tibur.cdr…` | Lux, Odeon, Intrastevere, Tibur | `- ORIGINAL LANGUAGE` | `Inglese con sottotitoli in Italiano` (names the **audio** language) |
| `green.multisalagreenwichroma.com`, `mignon.multisalagreenwichroma.com` | Greenwich, Mignon | `- V. O.` | `ORIGINALE con sottotitoli italiani` |

Gotchas:
- **circuitocinema.com is NOT a reliable source.** Its booking links' slugs are inverted relative to reality. Example (Quattro Fontane, "Il tempo di anne", 2026-10-18): link slug `il-tempo-di-anne-v-o-s-_2026/990832` has no tag, and the 18tickets page for 990832 says **`Lingua: Italiano`**. Link `il-tempo-di-anne_2026/990837` is tagged `<em>V.O.S.</em>`, and its page says **`IL TEMPO DI ANNE - V.O.S.` / `Lingua: Originale con sottotitoli italiani`**. Fixtures: `fixtures/18tickets/qf-il-tempo-di-anne*`. The `<em>V.O.S.</em>` tag matched; the slug did not. Slugs also use `-v-o-` (Dune) as well as `-v-o-s-`. **Decision: use 18tickets directly; treat slugs as a weak signal only.**
- `Lingua: Italiano` can be wrong for VO-by-nature content (Barberini: "PINK FLOYD - THE DARK SIDE OF THE MOON" → `Italiano`). TMDB `original_language` plus `unknown`/"check with cinema" handles this.
- Nuovo Olimpia had no shows 18–20 Oct (first date 21 Oct). Intrastevere showed **no dates at all**: probably dark, recheck in M5.
- Some cinemas publish only today (Alhambra), so the scheduler must re-poll.
- HTML entities in titles (`JE SO&#39; PAZZO`): decode.
- **Rate limit:** parallel fetching across circuits triggers HTTP 429 (no `Retry-After`). It appears to be one limit per client across all 18tickets hosts. We send one request every 5 s to all of 18tickets combined, with up to 4 backoff retries (decisions D19).
- Displayed cinema names differ from marketing names (`Cinema Tibur`, `Multisala Lux Roma`): `match` in cinemas.yaml must be the feed's name.

## 6. The Space Cinema — JSON microservice

- Base `https://www.thespacecinema.it/api/microservice/showings`. Behind Cloudflare.
- `GET /cinemas` (no auth) → `result[].cinemas[]`. Rome: **1021 "Roma Moderno"**, **1025 "Roma Parco de' Medici"**.
- `GET /showingDates?cinemaId=<id>&minEmbargoLevel=2&forNextWeek=true` → `result[] {showingDate, hasShowings}` (7 days).
- `GET /cinemas/<id>/films?showingDate=YYYY-MM-DDT00:00:00&minEmbargoLevel=3&includesSession=true&includeSessionAttributes=true`
  → `result[]` films (`filmId` `HO000…`, `filmTitle`, `originalTitle` (empty in samples), `releaseDate`, `runningTime`, `director`, `cast`, `posterImageSrc`)
  → `showingGroups[].sessions[]`: `sessionId`, `startTime` (local), `showTimeWithTimeZone` (ISO with offset; **use this**), `isMidnightSession`, `screenName`, `bookingUrl` (relative), `attributes[]`.
- **Auth:** a request served from Cloudflare cache works without cookies (today's date was a `cf-cache-status: HIT`); anything uncached returns **401**. Loading any HTML page (e.g. `/cinema/roma-moderno/al-cinema`) sets HttpOnly `microservicesToken` + `microservicesRefreshToken` cookies, which is the site's normal anonymous session. Sending them makes all dates return 200. This is not a bot challenge or CAPTCHA. Adapter: GET a page into a cookie jar, then call the API; refresh on 401.
- **Language:** session attribute with `attributeType: "Language"`: `ITALIANO` (168) or `LINGUA ORIGINALE` (6). **No subtitle attribute exists.** Other attribute types: `Session` (2D, EPIC, Dolby Atmos…), `Session_Special` (LASER, Prezzo Family), `Movie` (EVENTO SPECIALE, EXTRA…).
- Moderno: `hasShowings=false` for 19–21 Oct. Not an error; must not trigger the "zero sessions" health alert.

## 7. Cinema Troisi — JSON-LD + Liveticket

- `https://cinematroisi.it/` (WordPress on `cinematroisi.liveticket.it`). The HTML `<title>` literally reads "500 Internal Server Error" while the body is fine (HTTP 200). Don't treat the title as an error.
- One `<script type="application/ld+json">` with `@graph` of `Event`s (74 events, 2026‑10‑18 → 2026‑11‑17):
  `name` ("Title - DD/MM/YYYY HH:MM"), `startDate` (local, no offset), `workFeatured {name, director, duration "PT128M", actor[]}`, `image`, `offers.url = http://www.liveticket.it/evento.aspx?Id=<eventId>&CallingPageUrl=…opera.aspx?Id=<operaId>…`.
- Language is **not** in JSON-LD (only occasional `- VOS` in `name`). Liveticket's opera page title says it:
  `https://www.liveticket.it/opera.aspx?Id=<operaId>` → `<title>Biglietti Digger - VOS</title>` vs `<title>Biglietti Pocahontas</title>` (kids' film, dubbed). ~39 KB; 39 unique opera ids vs 74 events. Cache by opera id for days.
- Poster filenames encode ids: `1437696itVO_it.jpg`, `627itVO2_it.jpg` (TMDB id 627 = Trainspotting), `tt0275847_it.jpg` (IMDb id). Use as a TMDB matching hint, not as a language signal.
- Not "everything is VO": kids' matinées (Pocahontas, Lilo & Stitch) and Italian films are on the programme. Per-cinema default = VO is **wrong** without the Liveticket check.

## 8. Cinema dei Piccoli — JSON-LD (best quality)

- `https://www.cinemadeipiccoli.com/` (cinemadeipiccoli.it does not resolve). JSON-LD `@graph` with `MovieTheater` (with `geo`), `Movie`, `Event`.
- `Event.name` "Title - mercoledì 21 ottobre 2026 18:45"; `Event.description` "Lingua: inglese, islandese. Sottotitoli: italiano". **Explicit audio + subtitles.**
- Booking: `https://ticket.cinebot.it/cinemadeipiccoli/evento/<id>_<slug>` (slug e.g. `la-bambola-v-o-sott`).
- Kids' films in the afternoon (dubbed), VO d'essai in the evening.

## 9. Cinema Farnese — WordPress HTML

- `https://www.cinemafarnese.it/` → `#movies_per_day div.movie.<YYYY-MM-DD>` blocks, `span.titolo_movie`, `div.movie_orari` like `17:15 ita` / `21:15 vos ita` (22 ita, 9 vos ita seen). Horizon: 4 days.
- The "Acquista ITA" / "Acquista V.O.S." buttons point to the **same** 2tickets checkout URL, so don't use them as a signal. The per-time suffix is the signal.
- Titles carry noise ("DIGGER dal 1 ottobre"): strip `dal <date>`.

## 10. Casa del Cinema — calendar page (adapter: `casadelcinema`)

- A bare bot User-Agent gets **403**; `Mozilla/5.0 (compatible; RomeVOBot/0.1; …)` gets 200. We use the compatible-style UA everywhere (still self-identifying). See decisions.
- **Best source:** `https://www.casadelcinema.it/it/calendar/` inlines a FullCalendar config with `events: [{ id, title, url, start: "YYYY-MM-DDTHH:MM", end }, ...]`. It's a JS object literal, not JSON. There is one entry per screening: an event id repeats per date. It includes past screenings (back to 2023) and runs about 6 weeks ahead. One request covers everything.
- Titles look like `SHAME di Steve McQueen (v.o.s.)`: we split off the director (a matching hint). Every foreign film is tagged `(v.o.s.)` (60/66 entries); untagged entries are Italian films, so they get a weak Italian-audio signal.
- Booking: the event page URL (free entry, or Boxol tickets linked from there). There is no per-screening room in the calendar.
- Alternatives seen: `GET /wp-json/wp/v2/event` (titles only, no dates); event pages have `.gt-event-schedule .gt-panel` rows (date, time, title, Boxol link) but would need one request per event.

## 11. Adriano and Atlantic (NVR Cinema) — HTML (adapter: `nvr`)

- `ferrerocinemas.it/adriano/index.php` → 301 → `https://www.nvrcinema.it/adriano/` (same operator runs `/atlantic/`). Note: `cinemaadriano.it` is a **Florence** cinema.
- `div.filmContainer` → `div.titolo` (`BLADE RUNNER - FINAL CUT 4K | ORIGINAL VERSION`), `regia`, `durata`, `ul.orari li` with `div.dayName` "Martedì 27/10" (**no year**: infer the nearest future date) + `span[idcalend]` time.
- Slow host (first request timed out after 10s).
- Booking: `.hours span[idcalend]` → `https://www.nvrcinema.it/generic/seatsframe.php?sc=<.webtic id>&sp=<idcalend>` (from `cvu/modules/clientProgFile.js`). Adriano `sc=5304`, Atlantic `sc=5305`.
- VO wording varies: `| ORIGINAL VERSION`, `| ORIGINAL VERSION CON SOTTOTITOLI IN ITALIANO`, and **`| FILM IN INGLESE`**. The classifier reads "in inglese / in lingua francese / …" as VO and records the language. Untagged titles are the Italian version.
- Films announced without showtimes have an empty `ul.orari` (the site hides them), so they yield no sessions.

## 12. Nuovo Sacher — WordPress, no times

- `https://www.cinemanuovosacher.it/` (sacherfilm.eu is the distribution company). `GET /wp-json/wp/v2/film` lists posts; VO versions are separate posts with slug suffix `-vo`.
- Film page: "V. O. sottotitolata", "Dal 10 Settembre 2026", "Mercoledì, Giovedì, Venerdì e Sabato versione originale sottotitolata". **No times anywhere**, not even client-rendered (checked in a real browser).
- Rechecked 2026-10-18: still no times on the homepage or film pages; no ticketing platform linked. **No adapter.** It needs a data source with times (e.g. the cinema's social posts), or manual entry.

## 13. Detour — parked

- `cinedetour.it`: "On the hunt for our new home, meanwhile operating in 'roaming headquarters' mode". Programme page last updated in 2024; members-only. No adapter.

## Politeness

- UA: `Mozilla/5.0 (compatible; RomeVOBot/<ver>; +<project url>)`.
- robots.txt checked for all hosts (`fixtures/robots/`); none disallow the paths we use (The Space disallows only booking/account paths; Liveticket blocks only Yahoo Slurp).
- No CAPTCHA was encountered or bypassed. cinemabarberini.it returns 403 to curl; not needed, since the Barberini data comes from 18tickets.
