-- Public high scores for the squash minigame. A name is typed before play.

create table public.minigame_scores (
  id bigint generated always as identity primary key,
  player_name text not null,
  score integer not null,
  created_at timestamptz not null default now(),
  constraint minigame_name_len check (char_length(player_name) between 2 and 16),
  constraint minigame_score_range check (score between 0 and 9999)
);

create index minigame_scores_rank_idx on public.minigame_scores (score desc, created_at);

alter table public.minigame_scores enable row level security;

create policy "public read minigame scores"
  on public.minigame_scores
  for select
  to anon, authenticated
  using (true);

revoke all on public.minigame_scores from anon, authenticated;
grant select on public.minigame_scores to anon, authenticated;

create or replace function public.minigame_leaderboard()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(ranked)), '[]'::json)
  from (
    select player_name as name, score
    from public.minigame_scores
    order by score desc, created_at
    limit 10
  ) ranked;
$$;

revoke all on function public.minigame_leaderboard() from public;
grant execute on function public.minigame_leaderboard() to anon, authenticated;

create or replace function public.submit_minigame_score(p_name text, p_score integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  rank integer;
begin
  if clean is null or char_length(clean) < 2 or char_length(clean) > 16 then
    raise exception 'Enter a name of 2 to 16 characters.';
  end if;
  if clean !~ '^[A-Za-z0-9][A-Za-z0-9 .''-]*$' then
    raise exception 'Use letters and numbers in the name.';
  end if;
  if p_score is null or p_score < 1 or p_score > 9999 then
    raise exception 'That score cannot be saved.';
  end if;
  insert into public.minigame_scores (player_name, score) values (clean, p_score);
  select count(*)::integer into rank
  from public.minigame_scores
  where score > p_score;
  return rank + 1;
end;
$$;

revoke all on function public.submit_minigame_score(text, integer) from public;
grant execute on function public.submit_minigame_score(text, integer) to anon, authenticated;
