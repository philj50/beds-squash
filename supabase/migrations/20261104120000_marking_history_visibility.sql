-- The admin list keeps every marked match and every finished commentary match.
-- Visible ones appear under Earlier matches. Hidden ones stay in admin.

alter table public.marked_matches
  add column if not exists public_visible boolean not null default false;

alter table public.commentary_matches
  add column if not exists public_visible boolean not null default true;

alter table public.commentary_matches
  add column if not exists marked_id bigint;

create unique index if not exists commentary_marked_once
  on public.commentary_matches (marked_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'commentary_marked_fk') then
    alter table public.commentary_matches
      add constraint commentary_marked_fk
      foreign key (marked_id) references public.marked_matches (id) on delete cascade;
  end if;
end $$;

create or replace function public.admin_marked_matches()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can open the score list.';
  end if;
  return (
    select coalesce(json_agg(row_to_json(rows)), '[]'::json)
    from (
      select
        m.id,
        m.player_a as "playerA",
        m.player_b as "playerB",
        m.winner,
        m.score,
        m.public_visible as visible,
        coalesce(nullif(btrim(p.display_name), ''), 'Player') as marker,
        m.created_at as "createdAt"
      from public.marked_matches m
      left join public.profiles p on p.id = m.marker_id
      order by m.created_at desc
    ) rows
  );
end;
$$;

revoke all on function public.admin_marked_matches() from public, anon;
grant execute on function public.admin_marked_matches() to authenticated;

create or replace function public.admin_set_marked_visible(p_id bigint, p_visible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  match public.marked_matches%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change who can see a match.';
  end if;
  select * into match from public.marked_matches where id = p_id;
  if not found then
    raise exception 'That match is not in the history.';
  end if;
  update public.marked_matches
    set public_visible = coalesce(p_visible, false)
    where id = p_id;
  if coalesce(p_visible, false) then
    insert into public.commentary_matches (
      marker_id, player_a, player_b, score, history, updated_at, ended_at, public_visible, marked_id
    ) values (
      match.marker_id,
      match.player_a,
      match.player_b,
      match.score,
      case when jsonb_typeof(match.history) = 'object' then match.history else '{"games":[[]]}'::jsonb end,
      match.created_at,
      match.created_at,
      true,
      match.id
    )
    on conflict (marked_id) do update
      set public_visible = true,
          player_a = excluded.player_a,
          player_b = excluded.player_b,
          score = excluded.score,
          history = excluded.history,
          ended_at = coalesce(public.commentary_matches.ended_at, excluded.ended_at);
  else
    update public.commentary_matches
      set public_visible = false
      where marked_id = p_id;
  end if;
end;
$$;

revoke all on function public.admin_set_marked_visible(bigint, boolean) from public, anon;
grant execute on function public.admin_set_marked_visible(bigint, boolean) to authenticated;

create or replace function public.admin_commentary_history()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can open the score list.';
  end if;
  return (
    select coalesce(json_agg(row_to_json(rows)), '[]'::json)
    from (
      select
        c.id,
        c.player_a as "playerA",
        c.player_b as "playerB",
        split_part(c.score, '||', 1) as score,
        c.public_visible as visible,
        coalesce(nullif(btrim(p.display_name), ''), 'A marker') as marker,
        c.ended_at as "endedAt"
      from public.commentary_matches c
      left join public.profiles p on p.id = c.marker_id
      where c.ended_at is not null
      order by c.ended_at desc
    ) rows
  );
end;
$$;

revoke all on function public.admin_commentary_history() from public, anon;
grant execute on function public.admin_commentary_history() to authenticated;

create or replace function public.admin_commentary_match(p_id bigint)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  row json;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can open a marked match.';
  end if;
  select json_build_object(
    'id', c.id,
    'playerA', c.player_a,
    'playerB', c.player_b,
    'score', split_part(c.score, '||', 1),
    'history', c.history,
    'visible', c.public_visible,
    'marker', coalesce(nullif(btrim(p.display_name), ''), 'A marker'),
    'endedAt', c.ended_at
  )
    into row
  from public.commentary_matches c
  left join public.profiles p on p.id = c.marker_id
  where c.id = p_id
    and c.ended_at is not null;
  return row;
end;
$$;

revoke all on function public.admin_commentary_match(bigint) from public, anon;
grant execute on function public.admin_commentary_match(bigint) to authenticated;

create or replace function public.admin_set_commentary_visible(p_id bigint, p_visible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  linked bigint;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change who can see a match.';
  end if;
  update public.commentary_matches
    set public_visible = coalesce(p_visible, false)
    where id = p_id
      and ended_at is not null
    returning marked_id into linked;
  if not found then
    raise exception 'That match is not in the history.';
  end if;
  if linked is not null then
    update public.marked_matches
      set public_visible = coalesce(p_visible, false)
      where id = linked;
  end if;
end;
$$;

revoke all on function public.admin_set_commentary_visible(bigint, boolean) from public, anon;
grant execute on function public.admin_set_commentary_visible(bigint, boolean) to authenticated;

create or replace function public.commentary_archive()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(rows)), '[]'::json)
  from (
    select
      c.id,
      case
        when auth.uid() is null then public.public_player_name(c.player_a)
        else c.player_a
      end as "playerA",
      case
        when auth.uid() is null then public.public_player_name(c.player_b)
        else c.player_b
      end as "playerB",
      c.score,
      c.ended_at as "endedAt"
    from public.commentary_matches c
    where c.ended_at is not null
      and c.public_visible
    order by c.ended_at desc
    limit 80
  ) rows;
$$;

revoke all on function public.commentary_archive() from public;
grant execute on function public.commentary_archive() to anon, authenticated;

create or replace function public.commentary_match(p_id bigint)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'id', c.id,
    'playerA', case
      when auth.uid() is null then public.public_player_name(c.player_a)
      else c.player_a
    end,
    'playerB', case
      when auth.uid() is null then public.public_player_name(c.player_b)
      else c.player_b
    end,
    'score', c.score,
    'history', c.history,
    'marker', case
      when auth.uid() is null then null
      else coalesce(nullif(btrim(p.display_name), ''), 'A marker')
    end,
    'updatedAt', c.updated_at,
    'endedAt', c.ended_at,
    'room', public.commentary_room(c.id, true),
    'shouts', public.commentary_shout_list(c.id, 0)
  )
  from public.commentary_matches c
  left join public.profiles p on p.id = c.marker_id
  where c.id = p_id
    and c.public_visible;
$$;

revoke all on function public.commentary_match(bigint) from public;
grant execute on function public.commentary_match(bigint) to anon, authenticated;

notify pgrst, 'reload schema';
