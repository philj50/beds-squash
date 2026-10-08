-- A role is the permission a group gives. People are not added to a role directly.
-- League Master fills the LM groups. A person in those groups who is on SquashLevels
-- also joins SL Players. Existing admin accounts join Admins and receive Admin.

create table if not exists public.roles (
  slug text primary key,
  name text not null,
  position integer not null
);

insert into public.roles (slug, name, position) values
  ('admin', 'Admin', 1),
  ('lm_club_captain', 'LM Club Captain', 2),
  ('lm_team_captain', 'LM Team Captain', 3),
  ('lm_player', 'LM Player', 4),
  ('sl_player', 'SL Player', 5),
  ('jc_player', 'JC Player', 6),
  ('junior_organiser', 'Junior Organiser', 7),
  ('bc_player', 'BC Player', 8),
  ('rb_player', 'RB Player', 9)
on conflict (slug) do update
set name = excluded.name, position = excluded.position;

create table if not exists public.groups (
  slug text primary key,
  name text not null,
  source text not null default 'website',
  managed boolean not null default false,
  position integer not null
);

alter table public.groups add column if not exists role_slug text;

alter table public.groups drop constraint if exists groups_source_check;
alter table public.groups
  add constraint groups_source_check
  check (source in ('account', 'leaguemaster', 'squashlevels', 'website'));

-- The previous member list was profile-only. This list is rebuilt from the sources below.
do $$
begin
  if to_regclass('public.group_members') is not null
     and not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'group_members'
         and column_name = 'person_name'
     ) then
    drop table public.group_members;
  end if;
end $$;

delete from public.groups
where slug in ('lm_clubs', 'lm_captains', 'bc_juniors', 'beds_closed');

insert into public.groups (slug, name, role_slug, source, managed, position) values
  ('admins', 'Admins', 'admin', 'account', true, 1),
  ('lm_club_captains', 'LM Club Captains', 'lm_club_captain', 'leaguemaster', true, 2),
  ('lm_team_captains', 'LM Team Captains', 'lm_team_captain', 'leaguemaster', true, 3),
  ('lm_players', 'LM Players', 'lm_player', 'leaguemaster', true, 4),
  ('sl_players', 'SL Players', 'sl_player', 'squashlevels', true, 5),
  ('jc_players', 'JC Players', 'jc_player', 'website', false, 6),
  ('junior_organisers', 'Junior Organisers', 'junior_organiser', 'website', false, 7),
  ('bc_players', 'BC Players', 'bc_player', 'website', false, 8),
  ('rb_players', 'RB Players', 'rb_player', 'website', false, 9)
on conflict (slug) do update
set name = excluded.name,
    role_slug = excluded.role_slug,
    source = excluded.source,
    managed = excluded.managed,
    position = excluded.position;

alter table public.groups drop constraint if exists groups_role_slug_fkey;
alter table public.groups
  add constraint groups_role_slug_fkey
  foreign key (role_slug) references public.roles (slug);

create table if not exists public.group_members (
  id bigint generated always as identity primary key,
  group_slug text not null references public.groups (slug) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  person_name text not null,
  place text
);

create unique index if not exists group_members_name_key
  on public.group_members (group_slug, lower(btrim(person_name)));

alter table public.roles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;

drop policy if exists "signed in people can read roles" on public.roles;
create policy "signed in people can read roles"
  on public.roles for select to authenticated
  using (true);

drop policy if exists "signed in people can read groups" on public.groups;
create policy "signed in people can read groups"
  on public.groups for select to authenticated
  using (true);

drop policy if exists "read own groups or all as admin" on public.group_members;
create policy "read own groups or all as admin"
  on public.group_members for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

grant select on public.roles to authenticated;
grant select on public.groups to authenticated;
grant select on public.group_members to authenticated;

create or replace function public.person_in_squashlevels(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with key as (
    select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) as name_key
  )
  select
    exists (
      select 1
      from key k
      join public.player_links pl
        on lower(regexp_replace(btrim(pl.lm_player_name), '\s+', ' ', 'g')) = k.name_key
       and pl.squashlevels_player_id is not null
    )
    or exists (
      select 1
      from key k
      join public.squashlevels_names n
        on n.name_key = k.name_key
       and n.status = 'matched'
       and n.player_id is not null
    )
    or exists (
      select 1
      from key k
      join public.squashlevels_players sp
        on lower(regexp_replace(btrim(sp.display_name), '\s+', ' ', 'g')) = k.name_key
    );
$$;

revoke all on function public.person_in_squashlevels(text) from public;
grant execute on function public.person_in_squashlevels(text) to authenticated;

create or replace function public.is_group_organiser(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1
      from public.group_members
      where profile_id = auth.uid()
        and group_slug = p_slug
    );
$$;

revoke all on function public.is_group_organiser(text) from public;
grant execute on function public.is_group_organiser(text) to authenticated;

create or replace function public.sync_permission_groups()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_season text;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select t.last_season into current_season
  from public.teams t
  where t.last_season is not null and btrim(t.last_season) <> ''
  group by t.last_season
  order by t.last_season desc
  limit 1;

  delete from public.group_members gm
  using public.groups g
  where g.slug = gm.group_slug
    and g.managed;

  insert into public.group_members (group_slug, profile_id, person_name)
  select 'admins', p.id, coalesce(nullif(btrim(p.display_name), ''), 'Unnamed')
  from public.profiles p
  where p.is_admin;

  insert into public.group_members (group_slug, profile_id, person_name, place)
  select distinct on (lower(btrim(c.contact_name)))
    'lm_club_captains',
    p.id,
    btrim(c.contact_name),
    c.name
  from public.clubs c
  left join public.profiles p
    on c.contact_email is not null
   and btrim(c.contact_email) <> ''
   and lower(btrim(p.email)) = lower(btrim(c.contact_email))
  where c.contact_name is not null
    and btrim(c.contact_name) <> ''
    and exists (
      select 1 from public.teams t
      where t.club_slug = c.slug and t.last_season = current_season
    )
  order by lower(btrim(c.contact_name)), p.id nulls last;

  insert into public.group_members (group_slug, profile_id, person_name, place)
  select distinct on (lower(btrim(t.captain_name)))
    'lm_team_captains',
    p.id,
    btrim(t.captain_name),
    c.name || ' / ' || t.name
  from public.teams t
  join public.clubs c on c.slug = t.club_slug
  left join public.profiles p
    on t.captain_email is not null
   and btrim(t.captain_email) <> ''
   and lower(btrim(p.email)) = lower(btrim(t.captain_email))
  where t.last_season = current_season
    and t.captain_name is not null
    and btrim(t.captain_name) <> ''
  order by lower(btrim(t.captain_name)), p.id nulls last;

  insert into public.group_members (group_slug, profile_id, person_name, place)
  select
    'lm_players',
    (
      select p.id
      from public.profiles p
      where people.email is not null
        and lower(btrim(p.email)) = people.email
      limit 1
    ),
    people.person_name,
    people.place
  from (
    select
      min(btrim(person_name)) as person_name,
      string_agg(distinct place, '; ' order by place) as place,
      min(email) as email
    from (
      select
        btrim(n.player_name) as person_name,
        cl.name || ' / ' || t.name as place,
        nullif(lower(btrim(sp.email)), '') as email
      from public.nominations n
      join public.teams t on t.id = n.team_id
      join public.clubs cl on cl.slug = t.club_slug
      left join public.captain_squads s on s.team_id = t.id
      left join public.squad_players sp
        on sp.squad_id = s.id
       and lower(btrim(sp.display_name)) = lower(btrim(n.player_name))
      where n.season = current_season
        and n.player_name is not null
        and btrim(n.player_name) <> ''
      union all
      select
        btrim(sp.display_name),
        cl.name || ' / ' || t.name,
        nullif(lower(btrim(sp.email)), '')
      from public.squad_players sp
      join public.captain_squads s on s.id = sp.squad_id
      join public.teams t on t.id = s.team_id
      join public.clubs cl on cl.slug = t.club_slug
      where t.last_season = current_season
        and sp.display_name is not null
        and btrim(sp.display_name) <> ''
    ) raw
    group by lower(btrim(person_name))
  ) people;

  insert into public.group_members (group_slug, profile_id, person_name, place)
  select 'sl_players', lm.profile_id, lm.person_name, lm.place
  from (
    select distinct on (lower(btrim(person_name)))
      profile_id, person_name, place
    from public.group_members
    where group_slug in ('lm_club_captains', 'lm_team_captains', 'lm_players')
      and public.person_in_squashlevels(person_name)
    order by lower(btrim(person_name)), profile_id nulls last
  ) lm;
end;
$$;

revoke all on function public.sync_permission_groups() from public;
grant execute on function public.sync_permission_groups() to authenticated;

create or replace function public.sync_account_groups()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_permission_groups();
end;
$$;

revoke all on function public.sync_account_groups() from public;

do $$
begin
  if to_regclass('public.junior_entries') is not null then
    execute 'drop policy if exists "junior organisers read entries" on public.junior_entries';
    execute $policy$
      create policy "junior organisers read entries"
        on public.junior_entries for select to authenticated
        using (public.is_group_organiser('junior_organisers'))
    $policy$;
    execute 'drop policy if exists "junior organisers delete entries" on public.junior_entries';
    execute $policy$
      create policy "junior organisers delete entries"
        on public.junior_entries for delete to authenticated
        using (public.is_group_organiser('junior_organisers'))
    $policy$;
  end if;
end $$;

select public.sync_permission_groups();
