-- A manual join between one website login, one SquashLevels player, and one League Master name.
-- Name matching still applies when a side of the link is empty.

create table public.player_links (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles (id) on delete cascade,
  squashlevels_player_id bigint,
  lm_player_name text,
  created_at timestamptz not null default now(),
  constraint player_links_needs_two check (
    (profile_id is not null)::integer
    + (squashlevels_player_id is not null)::integer
    + (lm_player_name is not null and btrim(lm_player_name) <> '')::integer
    >= 2
  )
);

create unique index player_links_profile_key
  on public.player_links (profile_id)
  where profile_id is not null;

create unique index player_links_squashlevels_key
  on public.player_links (squashlevels_player_id)
  where squashlevels_player_id is not null;

create unique index player_links_lm_name_key
  on public.player_links (lower(btrim(lm_player_name)))
  where lm_player_name is not null and btrim(lm_player_name) <> '';

alter table public.player_links enable row level security;

create policy "read player links"
  on public.player_links
  for select
  to authenticated
  using (true);

create policy "admins add player links"
  on public.player_links
  for insert
  to authenticated
  with check (public.is_admin());

create policy "admins remove player links"
  on public.player_links
  for delete
  to authenticated
  using (public.is_admin());

grant select, insert, delete on public.player_links to authenticated;
