-- England Squash membership number, stored with the player's name and email.

alter table public.squad_players
  add column if not exists england_squash_id text;

comment on column public.squad_players.england_squash_id is
  'England Squash membership number. The same player may appear on more than one squad.';

create table if not exists public.player_registry (
  id bigint generated always as identity primary key,
  display_name text not null,
  email text,
  england_squash_id text,
  club text,
  updated_at timestamptz not null default now()
);

comment on table public.player_registry is
  'County player list from the England Squash export: name, email and membership number.';

create unique index if not exists player_registry_email_key
  on public.player_registry (lower(email))
  where email is not null and email <> '';

create unique index if not exists player_registry_es_key
  on public.player_registry (england_squash_id)
  where england_squash_id is not null and england_squash_id <> '';

alter table public.player_registry enable row level security;

drop policy if exists "admins read player registry" on public.player_registry;
create policy "admins read player registry"
  on public.player_registry for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin
    )
  );

grant select on public.player_registry to authenticated;
grant select, insert, update, delete on public.player_registry to service_role;
