-- Our email for a League Master player. The name stays on the nomination list.
-- Club and captain emails stay on the club and team rows copied from League Master.

create table public.lm_player_contacts (
  id bigint generated always as identity primary key,
  team_id bigint not null,
  player_name text not null,
  email text,
  unique (team_id, player_name)
);

alter table public.lm_player_contacts enable row level security;

create policy "admins read player contacts"
  on public.lm_player_contacts
  for select
  to authenticated
  using (is_admin());

create policy "admins add player contacts"
  on public.lm_player_contacts
  for insert
  to authenticated
  with check (is_admin());

create policy "admins update player contacts"
  on public.lm_player_contacts
  for update
  to authenticated
  using (is_admin())
  with check (is_admin());

grant select, insert, update on public.lm_player_contacts to authenticated;

-- Keep an email we already stored, when the name is on the nomination list.
insert into public.lm_player_contacts (team_id, player_name, email)
select distinct n.team_id, n.player_name, lower(sp.email)
from public.nominations n
join public.captain_squads s on s.team_id = n.team_id
join public.squad_players sp
  on sp.squad_id = s.id
 and lower(sp.display_name) = lower(n.player_name)
where sp.email is not null
  and btrim(sp.email) <> ''
on conflict (team_id, player_name) do nothing;

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
  select p.id, 'team_player', c.team_id
  from public.lm_player_contacts c
  join public.profiles p on lower(p.email) = lower(c.email)
  where c.email is not null and btrim(c.email) <> ''
    and not exists (
      select 1 from public.memberships m
      where m.profile_id = p.id and m.role = 'team_player' and m.team_id = c.team_id
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
      from public.lm_player_contacts c
      join public.profiles p on p.id = m.profile_id
      where c.team_id = m.team_id
        and lower(c.email) = lower(p.email)
    );
end;
$$;

revoke all on function public.apply_lm_roles() from public;
grant execute on function public.apply_lm_roles() to authenticated;
