# Proposed repo layout

```text
rome-vo/
├── package.json                 # pnpm workspaces root, scripts: test, lint, typecheck, scrape, admin
├── pnpm-workspace.yaml
├── .env.example                 # DATABASE_URL, SUPABASE_*, TMDB_API_KEY, TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, ...
├── config/
│   ├── cinemas.yaml             # every venue: id, name, area, lat/lon, adapter, adapter config, language defaults
│   └── overrides.yaml           # manual corrections (cinema / film / session scope), applied after classification
├── docs/
│   ├── sources.md  decisions.md  repo-layout.md
├── fixtures/                    # raw captured responses, one dir per source (read-only test inputs)
│   └── labels/                  # hand-labelled expectations: <fixture>.labels.json
├── packages/
│   ├── core/                    # domain types + zod schemas (RawSession, Session, Film), time utils (Europe/Rome, cinema day)
│   ├── adapters/
│   │   └── src/
│   │       ├── types.ts         # interface SourceAdapter { id; fetchSessions(range, ctx): Promise<AdapterResult> }
│   │       ├── http.ts          # polite fetch: UA, per-host rate limit + jitter, retries, cache, cookie jar, raw snapshot hook
│   │       ├── uci/             # uci.adapter.ts, uci.schema.ts, uci.parse.ts, uci.test.ts
│   │       ├── eighteen-tickets/ # one adapter, many hosts (Circuito, Barberini, CdR, Greenwich)
│   │       ├── thespace/
│   │       ├── troisi-liveticket/
│   │       ├── jsonld-events/   # Piccoli (and reusable for other schema.org sites)
│   │       ├── farnese/  casadelcinema/  nvr/  sacher/
│   ├── classifier/              # signals → language_class + confidence + reasons; precision/recall report script
│   ├── enricher/                # TMDB search/match + cache, manual-review flagging
│   ├── db/                      # SQL migrations (supabase/migrations), typed query layer shared by bot + web
│   └── pipeline/                # run: adapters → normalize → classify → enrich → upsert → health → alert diff
├── apps/
│   ├── bot/                     # grammY bot (webhook handler + local long-poll dev mode), i18n (en, it)
│   ├── web/                     # Next.js site
│   └── admin-cli/               # `pnpm admin runs|stats|reclassify|override`
└── .github/workflows/           # ci.yml (lint/typecheck/test), scrape-near.yml, scrape-full.yml, alerts.yml, live-smoke.yml (manual)
```

Rules:
- Adapters are pure parsers plus a thin fetch layer. Parsing functions take the raw payload, so contract tests run on `fixtures/` with no network.
- Each adapter returns `{sessions, advertisedDates, errors}`. The pipeline catches per-cinema failures and writes a `source_runs` row for each cinema.
- The classifier is source-agnostic. Adapters emit **signals** (`explicit_tag`, `structured_language`, `lingua_field`, `title_suffix`, `url_slug`, `duplicate_entry`, `cinema_default`) and the classifier weights them.
