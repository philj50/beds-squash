-- Groups are the audiences an account belongs to.
-- League Master refreshes the managed groups. BC Juniors and Beds Closed are set by hand.

create table public.groups (
  slug text primary key,
  name text not null,
  source text not null check (source in ('account', 'leaguemaster', 'website')),
  managed boolean not null,
  position integer not null
);

insert into public.groups (slug, name, source, managed, position) values
  ('admins', 'Admins', 'account', true, 1),
  ('lm_clubs', 'LM Clubs', 'leaguemaster', true, 2),
  ('lm_captains', 'LM Captains', 'leaguemaster', true, 3),
  ('lm_players', 'LM Players', 'leaguemaster', true, 4),
  ('bc_juniors', 'BC Juniors', 'website', false, 5),
  ('beds_closed', 'Beds Closed', 'website', false, 6);

create table public.group_members (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  group_slug text not null references public.groups (slug),
  role text not null check (role in ('member', 'organiser')),
  primary key (profile_id, group_slug)
);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

create policy "signed in people can read groups"
  on public.groups for select to authenticated
  using (true);

create policy "read own groups or all as admin"
  on public.group_members for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

create policy "admins add website group members"
  on public.group_members for insert to authenticated
  with check (
    public.is_admin()
    and exists (
      select 1 from public.groups g
      where g.slug = group_slug and not g.managed
    )
  );

create policy "admins change website group role"
  on public.group_members for update to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.groups g
      where g.slug = group_slug and not g.managed
    )
  )
  with check (
    public.is_admin()
    and exists (
      select 1 from public.groups g
      where g.slug = group_slug and not g.managed
    )
  );

create policy "admins remove website group members"
  on public.group_members for delete to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.groups g
      where g.slug = group_slug and not g.managed
    )
  );

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
        and role = 'organiser'
    );
$$;

revoke all on function public.is_group_organiser(text) from public;
grant execute on function public.is_group_organiser(text) to authenticated;

create or replace function public.sync_account_groups()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.group_members gm
  using public.groups g
  where g.slug = gm.group_slug
    and g.managed;

  insert into public.group_members (profile_id, group_slug, role)
  select p.id, 'admins', 'organiser'
  from public.profiles p
  where p.is_admin;

  insert into public.group_members (profile_id, group_slug, role)
  select distinct m.profile_id, 'lm_players', 'member'
  from public.memberships m
  where m.role = 'team_player';

  insert into public.group_members (profile_id, group_slug, role)
  select distinct m.profile_id, 'lm_captains', 'member'
  from public.memberships m
  where m.role = 'team_captain';

  insert into public.group_members (profile_id, group_slug, role)
  select distinct m.profile_id, 'lm_clubs', 'member'
  from public.memberships m
  where m.role = 'club_captain';
end;
$$;

revoke all on function public.sync_account_groups() from public;

create or replace function public.apply_lm_roles()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.memberships (profile_id, role, club_slug)
  select p.id, 'club_captain', c.slug
  from public.clubs c
  join public.profiles p on lower(p.email) = lower(c.contact_email)
  where c.contact_email is not null and btrim(c.contact_email) <> ''
    and not exists (
      select 1 from public.memberships m
      where m.profile_id = p.id and m.role = 'club_captain' and m.club_slug = c.slug
    );

  insert into public.memberships (profile_id, role, team_id)
  select p.id, 'team_captain', t.id
  from public.teams t
  join public.profiles p on lower(p.email) = lower(t.captain_email)
  where t.captain_email is not null and btrim(t.captain_email) <> ''
    and not exists (
      select 1 from public.memberships m
      where m.profile_id = p.id and m.role = 'team_captain' and m.team_id = t.id
    );

  insert into public.memberships (profile_id, role, team_id)
  select distinct p.id, 'team_player', s.team_id
  from public.squad_players sp
  join public.captain_squads s on s.id = sp.squad_id
  join public.profiles p on lower(p.email) = lower(sp.email)
  where s.team_id is not null
    and sp.email is not null and btrim(sp.email) <> ''
    and not exists (
      select 1 from public.memberships m
      where m.profile_id = p.id and m.role = 'team_player' and m.team_id = s.team_id
    );

  delete from public.memberships m
  where m.role = 'club_captain'
    and not exists (
      select 1
      from public.clubs c
      join public.profiles p on p.id = m.profile_id
      where c.slug = m.club_slug
        and lower(c.contact_email) = lower(p.email)
    );

  delete from public.memberships m
  where m.role = 'team_captain'
    and not exists (
      select 1
      from public.teams t
      join public.profiles p on p.id = m.profile_id
      where t.id = m.team_id
        and lower(t.captain_email) = lower(p.email)
    );

  delete from public.memberships m
  where m.role = 'team_player'
    and not exists (
      select 1
      from public.squad_players sp
      join public.captain_squads s on s.id = sp.squad_id
      join public.profiles p on p.id = m.profile_id
      where s.team_id = m.team_id
        and sp.email is not null
        and btrim(sp.email) <> ''
        and lower(sp.email) = lower(p.email)
    );

  perform public.sync_account_groups();
end;
$$;

select public.sync_account_groups();

do $$
begin
  if to_regclass('public.junior_entries') is not null
     and exists (
       select 1
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'junior_entries'
         and c.relrowsecurity
     ) then
    execute 'drop policy if exists "junior organisers read entries" on public.junior_entries';
    execute $policy$
      create policy "junior organisers read entries"
        on public.junior_entries for select to authenticated
        using (public.is_group_organiser('bc_juniors'))
    $policy$;
    execute 'drop policy if exists "junior organisers delete entries" on public.junior_entries';
    execute $policy$
      create policy "junior organisers delete entries"
        on public.junior_entries for delete to authenticated
        using (public.is_group_organiser('bc_juniors'))
    $policy$;
  end if;
end $$;
