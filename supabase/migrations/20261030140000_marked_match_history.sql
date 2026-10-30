-- Rally history for a marked match: each point, the server, and the service box.
-- An admin can correct the names or replace the history. Sport Manager is not updated.

create table if not exists public.marked_matches (
  id bigint generated always as identity primary key,
  marker_id uuid not null references auth.users (id) on delete cascade,
  player_a text not null,
  player_b text not null,
  winner text not null,
  games jsonb not null,
  score text not null,
  history jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint marked_winner check (winner in ('a', 'b')),
  constraint marked_name_len check (
    char_length(player_a) between 2 and 80
    and char_length(player_b) between 2 and 80
  )
);

alter table public.marked_matches
  add column if not exists history jsonb not null default '{}'::jsonb;

alter table public.marked_matches
  add column if not exists updated_at timestamptz;

alter table public.marked_matches enable row level security;
revoke all on table public.marked_matches from public, anon, authenticated;

drop function if exists public.save_marked_match(text, text, jsonb);

create or replace function public.save_marked_match(p_a text, p_b text, p_games jsonb, p_history jsonb)
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
  if p_history is null or jsonb_typeof(p_history) <> 'object' or jsonb_typeof(p_history -> 'games') <> 'array' then
    raise exception 'The rally history is missing.';
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
  insert into public.marked_matches (marker_id, player_a, player_b, winner, games, score, history)
  values (auth.uid(), left_name, right_name, winner_side, p_games, line, p_history)
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

revoke all on function public.save_marked_match(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_marked_match(text, text, jsonb, jsonb) to authenticated;

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
        coalesce(nullif(btrim(p.display_name), ''), 'Player') as marker,
        m.created_at as "createdAt"
      from public.marked_matches m
      left join public.profiles p on p.id = m.marker_id
      order by m.created_at desc
      limit 50
    ) rows
  );
end;
$$;

revoke all on function public.admin_marked_matches() from public, anon;
grant execute on function public.admin_marked_matches() to authenticated;

create or replace function public.admin_marked_match(p_id bigint)
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
    'id', m.id,
    'playerA', m.player_a,
    'playerB', m.player_b,
    'winner', m.winner,
    'score', m.score,
    'history', m.history,
    'marker', coalesce(nullif(btrim(p.display_name), ''), 'Player'),
    'createdAt', m.created_at
  )
    into row
  from public.marked_matches m
  left join public.profiles p on p.id = m.marker_id
  where m.id = p_id;
  return row;
end;
$$;

revoke all on function public.admin_marked_match(bigint) from public, anon;
grant execute on function public.admin_marked_match(bigint) to authenticated;

create or replace function public.admin_save_marked_match(p_id bigint, p_a text, p_b text, p_games jsonb, p_history jsonb)
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
  marker text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit a marked match.';
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
  if p_games is null or jsonb_typeof(p_games) <> 'array' or p_history is null or jsonb_typeof(p_history) <> 'object' then
    raise exception 'That score cannot be saved.';
  end if;
  n := jsonb_array_length(p_games);
  if n < 3 or n > 5 then
    raise exception 'A match is best of five.';
  end if;
  for i in 0 .. n - 1 loop
    ga := (p_games -> i ->> 'a')::int;
    gb := (p_games -> i ->> 'b')::int;
    if ga is null or gb is null or ga < 0 or gb < 0 then
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
    if ga > gb then won_a := won_a + 1; else won_b := won_b + 1; end if;
    if i < n - 1 and (won_a >= 3 or won_b >= 3) then
      raise exception 'The match had already finished.';
    end if;
    line := line || case when line = '' then '' else ', ' end || ga::text || '-' || gb::text;
  end loop;
  if won_a = 3 then winner_side := 'a';
  elsif won_b = 3 then winner_side := 'b';
  else raise exception 'Play until one player has won three games.';
  end if;
  update public.marked_matches
  set player_a = left_name,
      player_b = right_name,
      winner = winner_side,
      games = p_games,
      score = line,
      history = p_history,
      updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'That match is not on the list.';
  end if;
  select coalesce(nullif(btrim(display_name), ''), 'Player')
    into marker
  from public.profiles
  where id = (select marker_id from public.marked_matches where id = p_id);
  return json_build_object(
    'id', p_id,
    'playerA', left_name,
    'playerB', right_name,
    'winner', winner_side,
    'score', line,
    'marker', coalesce(marker, 'Player'),
    'createdAt', (select created_at from public.marked_matches where id = p_id)
  );
end;
$$;

revoke all on function public.admin_save_marked_match(bigint, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.admin_save_marked_match(bigint, text, text, jsonb, jsonb) to authenticated;

create or replace function public.admin_delete_marked_match(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can remove a marked match.';
  end if;
  delete from public.marked_matches where id = p_id;
end;
$$;

revoke all on function public.admin_delete_marked_match(bigint) from public, anon;
grant execute on function public.admin_delete_marked_match(bigint) to authenticated;
