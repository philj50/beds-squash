-- A finished match can be opened by anyone, with the marker's name.
-- The score page uses this for the public result link.

create table if not exists public.match_results (
  id bigint generated always as identity primary key,
  marker_id uuid not null references auth.users (id) on delete cascade,
  player_a text not null,
  player_b text not null,
  winner text not null,
  score text not null,
  history jsonb not null,
  created_at timestamptz not null default now(),
  constraint match_result_winner check (winner in ('a', 'b')),
  constraint match_result_name_len check (
    char_length(player_a) between 2 and 80
    and char_length(player_b) between 2 and 80
  )
);

alter table public.match_results enable row level security;
revoke all on table public.match_results from public, anon, authenticated;

create or replace function public.publish_match_result(
  p_id bigint,
  p_a text,
  p_b text,
  p_winner text,
  p_score text,
  p_history jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  left_name text := nullif(regexp_replace(btrim(coalesce(p_a, '')), '\s+', ' ', 'g'), '');
  right_name text := nullif(regexp_replace(btrim(coalesce(p_b, '')), '\s+', ' ', 'g'), '');
  line text := nullif(btrim(coalesce(p_score, '')), '');
  side text := lower(btrim(coalesce(p_winner, '')));
  result_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in to publish this result.';
  end if;
  if side <> 'a' and side <> 'b' then
    raise exception 'That result cannot be published.';
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
  if line is null or char_length(line) > 120 then
    raise exception 'That score cannot be published.';
  end if;
  if p_history is null or jsonb_typeof(p_history) <> 'object'
     or jsonb_typeof(p_history -> 'games') <> 'array'
     or octet_length(p_history::text) > 80000 then
    raise exception 'That match cannot be published.';
  end if;
  if p_id is not null then
    update public.match_results
      set player_a = left_name,
          player_b = right_name,
          winner = side,
          score = line,
          history = p_history
      where id = p_id
        and marker_id = auth.uid()
      returning id into result_id;
    if result_id is null then
      raise exception 'That result is not yours.';
    end if;
  else
    insert into public.match_results (marker_id, player_a, player_b, winner, score, history)
    values (auth.uid(), left_name, right_name, side, line, p_history)
    returning id into result_id;
  end if;
  return json_build_object('id', result_id);
end;
$$;

revoke all on function public.publish_match_result(bigint, text, text, text, text, jsonb) from public;
grant execute on function public.publish_match_result(bigint, text, text, text, text, jsonb) to authenticated;

create or replace function public.withdraw_match_result(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to publish this result.';
  end if;
  delete from public.match_results
  where id = p_id
    and marker_id = auth.uid();
end;
$$;

revoke all on function public.withdraw_match_result(bigint) from public;
grant execute on function public.withdraw_match_result(bigint) to authenticated;

create or replace function public.match_result(p_id bigint)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'id', m.id,
    'playerA', m.player_a,
    'playerB', m.player_b,
    'winner', m.winner,
    'score', m.score,
    'history', m.history,
    'marker', coalesce(nullif(btrim(p.display_name), ''), 'A marker'),
    'createdAt', m.created_at
  )
  from public.match_results m
  left join public.profiles p on p.id = m.marker_id
  where m.id = p_id;
$$;

revoke all on function public.match_result(bigint) from public;
grant execute on function public.match_result(bigint) to anon, authenticated;
