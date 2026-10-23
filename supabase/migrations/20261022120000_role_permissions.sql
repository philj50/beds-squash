-- Admin, and sending something in, follow the role groups.
-- A tick on a person is only the switch that puts them in the Admins group.

insert into public.group_members (group_slug, profile_id, person_name)
select 'admins', p.id, coalesce(nullif(btrim(p.display_name), ''), 'Unnamed')
from public.profiles p
where p.is_admin
  and not exists (
    select 1 from public.group_members gm
    where gm.group_slug = 'admins' and gm.profile_id = p.id
  );

insert into public.group_members (group_slug, profile_id, person_name)
select 'admins', m.profile_id, coalesce(nullif(btrim(p.display_name), ''), 'Unnamed')
from public.memberships m
join public.profiles p on p.id = m.profile_id
where m.role = 'admin'
  and not exists (
    select 1 from public.group_members gm
    where gm.group_slug = 'admins' and gm.profile_id = m.profile_id
  );

create or replace function public.sync_admin_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.is_admin is not distinct from old.is_admin then
    return new;
  end if;
  if new.is_admin then
    begin
      insert into public.group_members (group_slug, profile_id, person_name)
      select 'admins', new.id, coalesce(nullif(btrim(new.display_name), ''), 'Unnamed')
      where not exists (
        select 1 from public.group_members gm
        where gm.group_slug = 'admins' and gm.profile_id = new.id
      );
    exception
      when unique_violation then
        null;
    end;
  else
    delete from public.group_members
    where group_slug = 'admins' and profile_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_admin_role on public.profiles;
create trigger profiles_admin_role
  after insert or update of is_admin on public.profiles
  for each row
  execute function public.sync_admin_role();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members g
    where g.profile_id = auth.uid()
      and g.group_slug = 'admins'
  );
$$;

create or replace function public.can_contribute()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if auth.uid() is null then
    return false;
  end if;
  if to_regprocedure('public.account_is_active()') is not null then
    execute 'select public.account_is_active()' into allowed;
    if not allowed then
      return false;
    end if;
  end if;
  if to_regprocedure('public.account_has_email()') is not null then
    execute 'select public.account_has_email()' into allowed;
    if not allowed then
      return false;
    end if;
  end if;
  return public.is_admin()
    or exists (
      select 1
      from public.group_members
      where profile_id = auth.uid()
    );
end;
$$;

revoke all on function public.can_contribute() from public, anon;
grant execute on function public.can_contribute() to authenticated;

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
    and g.managed
    and g.slug <> 'admins';

  insert into public.group_members (group_slug, profile_id, person_name)
  select 'admins', p.id, coalesce(nullif(btrim(p.display_name), ''), 'Unnamed')
  from public.profiles p
  where p.is_admin
    and not exists (
      select 1 from public.group_members gm
      where gm.group_slug = 'admins' and gm.profile_id = p.id
    );

  update public.profiles p
  set is_admin = true
  where not p.is_admin
    and exists (
      select 1 from public.group_members gm
      where gm.profile_id = p.id and gm.group_slug = 'admins'
    );

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
