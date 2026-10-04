-- The board takes two or three letters. A longer name, or a word with extra characters, is refused.

create or replace function public.allow_minigame_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := upper(btrim(coalesce(p_name, '')));
begin
  if not public.is_admin() then
    raise exception 'Only an admin can allow a name.';
  end if;
  if clean !~ '^[A-Z]{2,3}$' then
    raise exception 'Use two or three letters.';
  end if;
  insert into public.minigame_allowed_names (player_name, name_key)
  values (clean, public.minigame_name_key(clean))
  on conflict (name_key) do nothing;
  if not found then
    raise exception 'That name is already allowed.';
  end if;
end;
$$;

revoke all on function public.allow_minigame_name(text) from public, anon;
grant execute on function public.allow_minigame_name(text) to authenticated;

create or replace function public.submit_minigame_score(p_name text, p_score integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := upper(btrim(coalesce(p_name, '')));
  rank integer;
begin
  if clean !~ '^[A-Z]{2,3}$' then
    raise exception 'Use two or three letters.';
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
