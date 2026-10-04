-- Keep a rude name off the minigame board, even if the page check is skipped.

create or replace function public.submit_minigame_score(p_name text, p_score integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  folded text;
  spaced text;
  collapsed text;
  word text;
  words text[] := array[
    'fuck', 'fucker', 'fucking', 'fuckyou', 'motherfucker',
    'shit', 'shitty', 'bullshit', 'dipshit', 'shithead',
    'cunt', 'bastard', 'bitch', 'wanker', 'wank', 'twat',
    'cock', 'dick', 'dickhead', 'prick', 'knob', 'piss',
    'slut', 'whore', 'bollock', 'bollocks', 'arse', 'arsehole',
    'asshole', 'asswipe', 'tits', 'pussy', 'faggot', 'nigger',
    'nigga', 'retard', 'spastic'
  ];
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

  folded := translate(lower(clean), '@43105$!|7', 'aaeiossiit');
  spaced := btrim(regexp_replace(folded, '[^a-z]+', ' ', 'g'));
  collapsed := replace(spaced, ' ', '');
  foreach word in array words loop
    if spaced ~ ('(^| )' || word || '( |$)')
      or collapsed = word
      or (char_length(word) >= 5 and position(word in collapsed) > 0)
    then
      raise exception 'Let. That name hit the tin, so it is not going on the board.';
    end if;
  end loop;

  insert into public.minigame_scores (player_name, score) values (clean, p_score);
  select count(*)::integer into rank
  from public.minigame_scores
  where score > p_score;
  return rank + 1;
end;
$$;

revoke all on function public.submit_minigame_score(text, integer) from public;
grant execute on function public.submit_minigame_score(text, integer) to anon, authenticated;
