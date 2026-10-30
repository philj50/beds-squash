-- Scores marked on the website. Sport Manager is not updated from here.
-- An organiser can read the list and enter the accepted result in Sport Manager.

create table public.marked_matches (
  id bigint generated always as identity primary key,
  marker_id uuid not null references auth.users (id) on delete cascade,
  player_a text not null,
  player_b text not null,
  winner text not null,
  games jsonb not null,
  score text not null,
  created_at timestamptz not null default now(),
  constraint marked_winner check (winner in ('a', 'b')),
  constraint marked_name_len check (
    char_length(player_a) between 2 and 80
    and char_length(player_b) between 2 and 80
  )
);

alter table public.marked_matches enable row level security;

revoke all on table public.marked_matches from public, anon, authenticated;

create or replace function public.save_marked_match(p_a text, p_b text, p_games jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  left_name text := nullif(regexp_replace(btrim(coalesce(p_a, '')), '\s+', ' ', 'g'), '');
  right_name text := nullif(regexp_replace(btrim(coalesce(p_b, '')), '\s+', ' ', 'g'), '');
  n int;
  i int;
  ga int;
  gb int;
  hi int;
  lo int;
  won_a int := 0;
  won_b int := 0;
  winner_side text;
  line text := '';
  new_id bigint;
  marker text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to save a score.';
  end if;
  if left_name is null or char_length(left_name) < 2 or char_length(left_name) > 80
     or left_name !~ '^[A-Za-z][A-Za-z .''-]*$' then
    raise exception 'Enter the first player''s name.';
  end if;
  if right_name is null or char_length(right_name) < 2 or char_length(right_name) > 80
     or right_name !~ '^[A-Za-z][A-Za-z .''-]*$' then
    raise exception 'Enter the second player''s name.';
  end if;
  if lower(left_name) = lower(right_name) then
    raise exception 'Pick two different players.';
  end if;
  if p_games is null or jsonb_typeof(p_games) <> 'array' then
    raise exception 'That score cannot be saved.';
  end if;
  n := jsonb_array_length(p_games);
  if n < 3 or n > 5 then
    raise exception 'A match is best of five.';
  end if;
  for i in 0 .. n - 1 loop
    ga := (p_games -> i ->> 'a')::int;
    gb := (p_games -> i ->> 'b')::int;
    if ga is null or gb is null or ga < 0 or gb < 0 or ga > 50 or gb > 50 then
      raise exception 'That score cannot be saved.';
    end if;
    hi := greatest(ga, gb);
    lo := least(ga, gb);
    if not (
      hi >= 11
      and hi - lo >= 2
      and ((hi = 11 and lo <= 9) or (hi > 11 and lo = hi - 2))
    ) then
      raise exception 'That game is not a finished PAR score.';
    end if;
    if ga > gb then
      won_a := won_a + 1;
    else
      won_b := won_b + 1;
    end if;
    if i < n - 1 and (won_a >= 3 or won_b >= 3) then
      raise exception 'The match had already finished.';
    end if;
    line := line || case when line = '' then '' else ', ' end || ga::text || '-' || gb::text;
  end loop;
  if won_a = 3 then
    winner_side := 'a';
  elsif won_b = 3 then
    winner_side := 'b';
  else
    raise exception 'Play until one player has won three games.';
  end if;
  insert into public.marked_matches (marker_id, player_a, player_b, winner, games, score)
  values (auth.uid(), left_name, right_name, winner_side, p_games, line)
  returning id into new_id;
  select coalesce(nullif(btrim(display_name), ''), 'Player')
    into marker
  from public.profiles
  where id = auth.uid();
  return json_build_object(
    'id', new_id,
    'playerA', left_name,
    'playerB', right_name,
    'winner', winner_side,
    'score', line,
    'marker', coalesce(marker, 'Player'),
    'createdAt', now()
  );
end;
$$;

revoke all on function public.save_marked_match(text, text, jsonb) from public, anon;
grant execute on function public.save_marked_match(text, text, jsonb) to authenticated;

create or replace function public.marked_matches()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(rows)), '[]'::json)
  from (
    select
      m.id,
      m.player_a as "playerA",
      m.player_b as "playerB",
      m.winner,
      m.score,
      coalesce(nullif(btrim(p.display_name), ''), 'Player') as marker,
      m.created_at as "createdAt"
    from public.marked_matches m
    left join public.profiles p on p.id = m.marker_id
    where auth.uid() is not null
    order by m.created_at desc
    limit 30
  ) rows;
$$;

revoke all on function public.marked_matches() from public, anon;
grant execute on function public.marked_matches() to authenticated;

create or replace function public.scoreboard_names()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(name order by name), '[]'::json)
  from (
    select distinct name
    from (
      select btrim(display_name) as name
      from public.profiles
      where display_name is not null and btrim(display_name) <> ''
      union
      select btrim(display_name)
      from public.squad_players
      where display_name is not null and btrim(display_name) <> ''
      union
      select btrim(display_name)
      from public.player_registry
      where display_name is not null and btrim(display_name) <> ''
      union
      select btrim(forename) || ' ' || btrim(surname)
      from public.beds_closed_entries
      where btrim(forename) <> '' and btrim(surname) <> ''
    ) raw
    where char_length(name) between 2 and 80
      and name ~ '^[A-Za-z][A-Za-z .''-]*$'
    limit 800
  ) named;
$$;

revoke all on function public.scoreboard_names() from public, anon;
grant execute on function public.scoreboard_names() to authenticated;
