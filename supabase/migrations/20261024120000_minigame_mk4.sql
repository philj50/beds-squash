-- Mk4 records a match, you against the court. Mk3 high scores stay in the table and leave the board.

alter table public.minigame_scores
  add column if not exists court_score integer,
  add column if not exists edition text not null default 'mk3';

alter table public.minigame_scores
  alter column edition set default 'mk4';

alter table public.minigame_scores
  drop constraint if exists minigame_court_score_range;

alter table public.minigame_scores
  add constraint minigame_court_score_range check (court_score is null or court_score between 0 and 99);

create or replace function public.minigame_leaderboard()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(ranked)), '[]'::json)
  from (
    select player_name as name, score as you, court_score as court
    from public.minigame_scores
    where edition = 'mk4' and court_score is not null
    order by
      (score >= 11 and score >= court_score + 2) desc,
      case
        when score >= 11 and score >= court_score + 2 then court_score
        else 100 - score
      end,
      score desc,
      created_at
    limit 10
  ) ranked;
$$;

revoke all on function public.minigame_leaderboard() from public;
grant execute on function public.minigame_leaderboard() to anon, authenticated;

drop function if exists public.submit_minigame_score(text, integer);

create or replace function public.submit_minigame_score(p_name text, p_you integer, p_court integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := upper(btrim(coalesce(p_name, '')));
  rank integer;
  builtin text[] := array[
    'ars', 'ass', 'cul', 'cum', 'cun', 'dik', 'fag', 'fap', 'fuc', 'fuk',
    'jap', 'kkk', 'nig', 'sex', 'tit', 'xxx'
  ];
  won boolean := p_you >= 11 and p_you >= p_court + 2;
begin
  if clean !~ '^[A-Z]{2,3}$' then
    raise exception 'Use two or three letters.';
  end if;
  if p_you is null or p_court is null or p_you < 0 or p_court < 0 or p_you > 99 or p_court > 99 then
    raise exception 'That result cannot be saved.';
  end if;
  if (p_you >= 11 and p_you >= p_court + 2) or (p_court >= 11 and p_court >= p_you + 2) then
    null;
  else
    raise exception 'That result is not a finished match.';
  end if;
  if lower(clean) = any (builtin)
    or exists (
      select 1 from public.minigame_blocked_initials
      where name_key = public.minigame_name_key(clean)
    )
  then
    raise exception 'Let. That name hit the tin, so it is not going on the board.';
  end if;

  insert into public.minigame_scores (player_name, score, court_score, edition)
  values (clean, p_you, p_court, 'mk4');

  select count(*)::integer into rank
  from public.minigame_scores
  where edition = 'mk4'
    and court_score is not null
    and (
      ((score >= 11 and score >= court_score + 2) and not won)
      or (
        ((score >= 11 and score >= court_score + 2) = won)
        and (
          case
            when score >= 11 and score >= court_score + 2 then court_score < p_court
              or (court_score = p_court and score > p_you)
            else score > p_you or (score = p_you and court_score < p_court)
          end
        )
      )
    );
  return rank + 1;
end;
$$;

revoke all on function public.submit_minigame_score(text, integer, integer) from public;
grant execute on function public.submit_minigame_score(text, integer, integer) to anon, authenticated;

-- The previous page sends one number. Keep that call from failing until the new page is published.
create or replace function public.submit_minigame_score(p_name text, p_score integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Minigame mk4 has replaced this board.';
end;
$$;

revoke all on function public.submit_minigame_score(text, integer) from public;
grant execute on function public.submit_minigame_score(text, integer) to anon, authenticated;
