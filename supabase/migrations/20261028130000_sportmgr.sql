-- Public order of play copied from Sport Manager. The sync script writes.
-- Visitors only read.

create table public.sportmgr_tournaments (
  id bigint primary key,
  event_id text not null,
  title text not null,
  synced_at timestamptz not null default now()
);

create table public.sportmgr_entries (
  tournament_id bigint not null references public.sportmgr_tournaments (id) on delete cascade,
  grade text not null,
  player_name text not null,
  club text not null default '',
  seed text not null default '',
  primary key (tournament_id, grade, player_name, seed)
);

create table public.sportmgr_matches (
  id bigint primary key,
  tournament_id bigint not null references public.sportmgr_tournaments (id) on delete cascade,
  played_on date not null,
  start_time text not null default '',
  end_time text not null default '',
  court text not null default '',
  grade text not null,
  round_label text not null default '',
  home_name text not null,
  away_name text not null,
  score text not null default ''
);

create index sportmgr_matches_day
  on public.sportmgr_matches (tournament_id, played_on, start_time);

alter table public.sportmgr_tournaments enable row level security;
alter table public.sportmgr_entries enable row level security;
alter table public.sportmgr_matches enable row level security;

create policy "public read sport manager tournaments"
  on public.sportmgr_tournaments for select
  to anon, authenticated
  using (true);

create policy "public read sport manager entries"
  on public.sportmgr_entries for select
  to anon, authenticated
  using (true);

create policy "public read sport manager matches"
  on public.sportmgr_matches for select
  to anon, authenticated
  using (true);

grant select on public.sportmgr_tournaments, public.sportmgr_entries, public.sportmgr_matches
  to anon, authenticated;
