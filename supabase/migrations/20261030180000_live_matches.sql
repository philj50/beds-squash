-- A match being marked can be watched by anyone on the site.
-- Names and the score only. No email address is published.

create table if not exists public.live_matches (
  id bigint generated always as identity primary key,
  marker_id uuid not null unique references auth.users (id) on delete cascade,
  player_a text not null,
  player_b text not null,
  score text not null,
  history jsonb not null,
  updated_at timestamptz not null default now(),
  constraint live_name_len check (
    char_length(player_a) between 2 and 80
    and char_length(player_b) between 2 and 80
  )
);

alter table public.live_matches enable row level security;
revoke all on table public.live_matches from public, anon, authenticated;

create or replace function public.publish_live_match(p_a text, p_b text, p_score text, p_history jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  left_name text := nullif(regexp_replace(btrim(coalesce(p_a, '')), '\s+', ' ', 'g'), '');
  right_name text := nullif(regexp_replace(btrim(coalesce(p_b, '')), '\s+', ' ', 'g'), '');
  line text := nullif(btrim(coalesce(p_score, '')), '');
  live_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in to let people watch.';
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
    line := '0-0';
  end if;
  if p_history is null or jsonb_typeof(p_history) <> 'object'
     or jsonb_typeof(p_history -> 'games') <> 'array'
     or octet_length(p_history::text) > 80000 then
    raise exception 'That match cannot be shared.';
  end if;
  insert into public.live_matches (marker_id, player_a, player_b, score, history, updated_at)
  values (auth.uid(), left_name, right_name, line, p_history, now())
  on conflict (marker_id) do update
    set player_a = excluded.player_a,
        player_b = excluded.player_b,
        score = excluded.score,
        history = excluded.history,
        updated_at = now()
  returning id into live_id;
  return json_build_object('id', live_id);
end;
$$;

revoke all on function public.publish_live_match(text, text, text, jsonb) from public;
grant execute on function public.publish_live_match(text, text, text, jsonb) to authenticated;

create or replace function public.clear_live_match()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to let people watch.';
  end if;
  delete from public.live_matches where marker_id = auth.uid();
end;
$$;

revoke all on function public.clear_live_match() from public;
grant execute on function public.clear_live_match() to authenticated;

create or replace function public.current_matches()
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
      m.score,
      m.history,
      coalesce(nullif(btrim(p.display_name), ''), 'A marker') as marker,
      m.updated_at as "updatedAt"
    from public.live_matches m
    left join public.profiles p on p.id = m.marker_id
    where m.updated_at > now() - interval '3 hours'
    order by m.updated_at desc
    limit 12
  ) rows;
$$;

revoke all on function public.current_matches() from public;
grant execute on function public.current_matches() to anon, authenticated;
