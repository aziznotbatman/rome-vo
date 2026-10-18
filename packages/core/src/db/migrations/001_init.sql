create table cinemas (
  id               serial primary key,
  slug             text not null unique,
  name             text not null,
  area             text not null,
  address          text,
  lat              double precision,
  lon              double precision,
  source_id        text not null,
  status           text not null default 'ok' check (status in ('ok', 'degraded')),
  status_reason    text,
  first_success_at timestamptz,
  last_success_at  timestamptz,
  updated_at       timestamptz not null default now()
);

create table films (
  id                serial primary key,
  film_key          text not null unique,
  title             text not null,
  original_title    text,
  year              int,
  director          text,
  runtime_min       int,
  poster_url        text,
  original_language text,
  wikidata_id       text,
  imdb_id           text,
  tmdb_id           text,
  match_confidence  real,
  needs_review      boolean not null default false,
  enriched_at       timestamptz,
  first_vo_seen_at  timestamptz,
  created_at        timestamptz not null default now()
);

create table sessions (
  id                bigserial primary key,
  cinema_id         int not null references cinemas (id) on delete cascade,
  film_id           int not null references films (id),
  source_session_id text not null,
  starts_at         timestamptz not null,
  cinema_day        date not null,
  raw_title         text not null,
  booking_url       text,
  room              text,
  language_class    text not null check (language_class in ('vo', 'dubbed', 'unknown')),
  confidence        real not null,
  reasons           jsonb not null default '[]',
  audio_language    text,
  overridden        boolean not null default false,
  is_active         boolean not null default true,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  unique (cinema_id, source_session_id)
);
create index sessions_active_day on sessions (cinema_day) where is_active;
create index sessions_active_film on sessions (film_id) where is_active;

create table source_runs (
  id             bigserial primary key,
  source_id      text not null,
  cinema_id      int references cinemas (id) on delete cascade,
  started_at     timestamptz not null,
  finished_at    timestamptz not null default now(),
  status         text not null check (status in ('ok', 'degraded', 'failed')),
  sessions_found int not null default 0,
  vo_found       int not null default 0,
  error          text
);
create index source_runs_recent on source_runs (started_at desc);

-- Rolling 14-day snapshots of raw responses, for debugging parser breakage.
create table raw_snapshots (
  id         bigserial primary key,
  url        text not null,
  status     int not null,
  body       text not null,
  fetched_at timestamptz not null default now()
);
create index raw_snapshots_age on raw_snapshots (fetched_at);

create table kv_cache (
  key        text primary key,
  value      text not null,
  expires_at timestamptz not null
);

-- Telegram users. Only the chat id and preferences are stored; /stop deletes the row (and cascades).
create table subscribers (
  chat_id        bigint primary key,
  locale         text not null default 'en',
  prefs          jsonb not null default '{}',
  digest_hours   int not null default 24,
  last_digest_at timestamptz,
  created_at     timestamptz not null default now()
);

create table subscriptions (
  id         bigserial primary key,
  chat_id    bigint not null references subscribers (chat_id) on delete cascade,
  kind       text not null check (kind in ('new_films', 'film', 'cinema')),
  target_id  int,
  created_at timestamptz not null default now()
);
create unique index subscriptions_unique on subscriptions (chat_id, kind, coalesce(target_id, 0));

create table alerts_sent (
  chat_id   bigint not null references subscribers (chat_id) on delete cascade,
  alert_key text not null,
  sent_at   timestamptz not null default now(),
  primary key (chat_id, alert_key)
);

create table reports (
  id         bigserial primary key,
  session_id bigint references sessions (id) on delete set null,
  chat_id    bigint,
  message    text not null,
  created_at timestamptz not null default now()
);
