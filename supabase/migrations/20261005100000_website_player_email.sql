-- Player emails live on the website squad record. League Master names the player.
-- When that record has an email, it replaces any address stored against the nomination.
-- The player role follows the website email.

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
end;
$$;

revoke all on function public.apply_lm_roles() from public;
grant execute on function public.apply_lm_roles() to authenticated;

create or replace function public.sync_website_player_emails()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.lm_player_contacts c
  set email = nullif(lower(btrim(sp.email)), '')
  from public.squad_players sp
  join public.captain_squads s on s.id = sp.squad_id
  where s.team_id = c.team_id
    and lower(sp.display_name) = lower(c.player_name);

  insert into public.lm_player_contacts (team_id, player_name, email)
  select distinct on (s.team_id, lower(sp.display_name))
    s.team_id,
    sp.display_name,
    nullif(lower(btrim(sp.email)), '')
  from public.squad_players sp
  join public.captain_squads s on s.id = sp.squad_id
  where s.team_id is not null
    and sp.email is not null
    and btrim(sp.email) <> ''
    and not exists (
      select 1
      from public.lm_player_contacts c
      where c.team_id = s.team_id
        and lower(c.player_name) = lower(sp.display_name)
    )
  order by s.team_id, lower(sp.display_name), sp.id;

  perform public.apply_lm_roles();
end;
$$;

revoke all on function public.sync_website_player_emails() from public;
grant execute on function public.sync_website_player_emails() to authenticated;
