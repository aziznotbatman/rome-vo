# Rome VO — original-language cinema in Rome

A Telegram bot ([@romacinemabot](https://t.me/romacinemabot)) that lists only the screenings in **original language** (VO / VOS) across Rome cinemas, and alerts you when a new VO film appears.

It scrapes 24 cinemas from 9 data sources, classifies every screening as `vo`, `dubbed` or `unknown`, and stores everything in Postgres. The bot reads from the database.

| Source | Cinemas |
|---|---|
| UCI JSON API | Porta di Roma, Roma Est, Parco Leonardo, Luxe Maximo |
| 18tickets (one adapter) | Quattro Fontane, Eurcine, Giulio Cesare, Nuovo Olimpia, Barberini, Alhambra, Lux, Odeon, Intrastevere, Tibur, Greenwich, Mignon |
| The Space JSON API | Moderno, Parco de' Medici |
| JSON-LD + Liveticket | Troisi |
| JSON-LD | Cinema dei Piccoli |
| HTML | Farnese |
| Calendar page (FullCalendar) | Casa del Cinema |
| NVR Cinema HTML | Adriano, Atlantic |

How each source works, including its quirks, is in [docs/sources.md](docs/sources.md). Design decisions are in [docs/decisions.md](docs/decisions.md).

## Running on this Mac

Everything runs locally: Postgres (Homebrew), the bot (long polling, so it needs no public URL) and scheduled scrapes (launchd). The Mac must be awake for the bot to answer and for jobs to run; launchd runs a missed interval once after wake.

macOS doesn't let background agents read `~/Documents`, so `ops/install-launchd.sh` copies the code to `~/Library/Application Support/RomeVO` and runs it from there. **After editing code, config or `.env`, run `ops/install-launchd.sh` again** to redeploy and restart.

```bash
brew install postgresql@16 && brew services start postgresql@16
createdb romevo && createdb romevo_test
corepack enable && pnpm install
cp .env.example .env    # then fill in TELEGRAM_BOT_TOKEN
pnpm migrate
pnpm scrape             # first full fetch, ~5 min
ops/install-launchd.sh  # bot + schedules; logs in ~/Library/Logs/romevo/
```

Day-to-day commands:

```bash
pnpm scrape [--days 14] [--only uci,circuito] [--no-enrich]   # fetch now
pnpm admin                 # source health, last runs, classifier mix
pnpm classifier:report     # precision/recall on the labelled fixtures
pnpm test                  # unit + contract + integration tests
pnpm bot                   # run the bot in the foreground (stop the launchd one first)
ops/install-launchd.sh --uninstall
```

### Environment variables (`.env`)

| Variable | Required | Meaning |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | From @BotFather |
| `DATABASE_URL` | yes | `postgres://localhost:5432/romevo` |
| `ADMIN_CHAT_ID` | no | Your chat id (send `/whoami` to the bot). Enables `/admin` and Telegram alerts when a source breaks |
| `TEST_DATABASE_URL` | no | Defaults to `postgres://localhost:5432/romevo_test` |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn`, `error` |

## Bot

`/today` `/tomorrow` `/week` list VO screenings grouped by film, then cinema; tap a time to book. `/film <title>` and `/cinema <name>` show one film or one cinema, with a 🔔 Follow button. `/settings` controls the filters: after 18:00, weekends, cinema selection, sort by distance (share your location), whether to include Italian-language films, whether to show unconfirmed-language screenings, and digest frequency. `/subscribe` turns on alerts for any new VO film. `/report` saves a wrong-label report. `/stop` deletes everything stored about you.

What is shown:
- A screening counts as VO if the cinema says so (tags, language fields). Films whose original language is Italian (from Wikidata) are hidden unless you turn them on.
- ⚠️ after a time means the evidence is weak or contradictory: check with the cinema.
- Screenings with no language information at all are listed at the end under "Language not confirmed".

Alerts are batched into one digest per 6, 12 or 24 hours (your choice) and are never sent between 23:00 and 08:00. Each new film is announced once; following a film or a cinema announces its new screenings once. A newly added cinema's existing programme is not announced.

## How to add a cinema

1. **Same platform as an existing source** (e.g. another 18tickets venue): add an entry to [config/cinemas.yaml](config/cinemas.yaml) with its `host` and the cinema name exactly as the feed shows it (`match`). Run `pnpm tsx scripts/geocode.ts` to fill in coordinates, then `pnpm scrape --only <id>`.
2. **New platform:** write `packages/core/src/adapters/<name>.ts` exporting a pure `parse…()` function and a `SourceAdapter`. Emit `RawSession`s with `signals` (the raw language evidence; the adapter never decides VO itself). Register it in `adapters/index.ts` and the `adapter` enum in `config.ts`. Save real responses in `fixtures/<name>/`, add contract tests next to the adapter, and add the new listings to `fixtures/labels.yaml`.

## How to fix a wrong label

Add a rule to [config/overrides.yaml](config/overrides.yaml):

```yaml
- { cinema: barberini, title: "pink floyd", set: vo, note: "Concert film, English audio; source says Italiano" }
```

`cinema` (slug), `title` (case-insensitive substring of the raw title) and `sourceSessionId` narrow the rule; `set` is `vo`, `dubbed` or `unknown`; `note` is required. The next scrape applies it. If the mistake is a pattern rather than a one-off, fix the classifier in `packages/core/src/classifier.ts` and add the case to `fixtures/labels.yaml`.

## Layout

```text
config/              cinemas.yaml (sources + cinemas), overrides.yaml
packages/core/src/
  adapters/          one file per source; pure parsers + fetch
  classifier.ts      signals → vo / dubbed / unknown + confidence + reasons
  normalize.ts       title cleanup and film grouping key
  enrich/wikidata.ts original language, year, IMDb/TMDB ids (no API key)
  pipeline/          run: fetch → normalize → upsert → health → enrich
  db/                migrations, writes
  queries.ts         read layer shared by bot (and website)
  alerts.ts          digest computation, quiet hours
apps/bot/src/        grammY bot
scripts/             scrape, migrate, admin, geocode, classifier-report
fixtures/            captured source responses + labels.yaml
ops/                 launchd install + run wrapper
```

## Moving to the cloud later

The code has no Mac-specific parts except `ops/`. To host it: create a Postgres database (e.g. Supabase) and set `DATABASE_URL`; run `pnpm bot` on any always-on host (Fly.io, Railway, a VPS); and run `pnpm scrape:near` every 2h and `pnpm scrape` every 6h from cron or GitHub Actions. Those services need accounts you create yourself.

Film metadata: [Wikidata](https://www.wikidata.org) (CC0). Showtimes belong to the cinemas.
