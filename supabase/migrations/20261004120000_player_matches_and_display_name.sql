-- A player can open their own fixtures and mark their own availability.
-- Captains keep the access they already have. A player does not see the rest of the squad.

create or replace function public.player_squad_ids()
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  select s.id::bigint
  from public.captain_squads s
  where auth.uid() is not null
    and (
      exists (
        select 1
        from public.memberships m
        where m.profile_id = auth.uid()
          and m.role = 'team_player'
          and m.team_id is not null
          and m.team_id = s.team_id
      )
      or exists (
        select 1
        from public.squad_players p
        where p.squad_id = s.id
          and p.email is not null
          and lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
    );
$$;

create or replace function public.own_squad_player_ids()
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  select p.id::bigint
  from public.squad_players p
  where auth.uid() is not null
    and p.email is not null
    and lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

revoke all on function public.player_squad_ids() from public, anon;
revoke all on function public.own_squad_player_ids() from public, anon;
grant execute on function public.player_squad_ids() to authenticated;
grant execute on function public.own_squad_player_ids() to authenticated;

drop policy if exists "player reads own squad" on public.captain_squads;
create policy "player reads own squad"
  on public.captain_squads
  for select
  to authenticated
  using (id in (select public.player_squad_ids()));

drop policy if exists "player reads own squad row" on public.squad_players;
create policy "player reads own squad row"
  on public.squad_players
  for select
  to authenticated
  using (id in (select public.own_squad_player_ids()));

drop policy if exists "player reads own availability" on public.availability;
create policy "player reads own availability"
  on public.availability
  for select
  to authenticated
  using (squad_player_id in (select public.own_squad_player_ids()));

drop policy if exists "player adds own availability" on public.availability;
create policy "player adds own availability"
  on public.availability
  for insert
  to authenticated
  with check (squad_player_id in (select public.own_squad_player_ids()));

drop policy if exists "player updates own availability" on public.availability;
create policy "player updates own availability"
  on public.availability
  for update
  to authenticated
  using (squad_player_id in (select public.own_squad_player_ids()))
  with check (squad_player_id in (select public.own_squad_player_ids()));

drop policy if exists "player clears own availability" on public.availability;
create policy "player clears own availability"
  on public.availability
  for delete
  to authenticated
  using (squad_player_id in (select public.own_squad_player_ids()));

-- Saving a profile name was written earlier, but the live database never received it.
create or replace function public.set_my_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := trim(p_name);
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if clean is null or char_length(clean) < 2 or char_length(clean) > 80 then
    raise exception 'Enter a name between 2 and 80 characters.';
  end if;
  update public.profiles
    set display_name = clean
    where id = auth.uid();
end;
$$;

revoke all on function public.set_my_display_name(text) from public, anon;
grant execute on function public.set_my_display_name(text) to authenticated;
