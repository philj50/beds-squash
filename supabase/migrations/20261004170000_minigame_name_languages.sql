-- Rude names in more than one language, with an admin list of names that may be used.

create or replace function public.minigame_name_key(p_name text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    translate(
      replace(lower(btrim(coalesce(p_name, ''))), 'ß', 'ss'),
      '@43105$!|7áàäâãåéèëêíìïîóòöôõúùüûýÿñç',
      'aaeiossiitaaaaaaeeeeiiiiooooouuuuyync'
    ),
    '[^a-z]',
    '',
    'g'
  );
$$;

revoke all on function public.minigame_name_key(text) from public, anon;

create table public.minigame_allowed_names (
  id bigint generated always as identity primary key,
  player_name text not null,
  name_key text not null unique,
  created_at timestamptz not null default now()
);

alter table public.minigame_allowed_names enable row level security;

create policy "public read allowed minigame names"
  on public.minigame_allowed_names
  for select
  to anon, authenticated
  using (true);

revoke all on public.minigame_allowed_names from anon, authenticated;
grant select on public.minigame_allowed_names to anon, authenticated;

create or replace function public.allow_minigame_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if not public.is_admin() then
    raise exception 'Only an admin can allow a name.';
  end if;
  if clean is null or char_length(clean) < 2 or char_length(clean) > 16 then
    raise exception 'Enter a name of 2 to 16 characters.';
  end if;
  if clean !~ '^[A-Za-z0-9][A-Za-z0-9 .''-]*$' then
    raise exception 'Use letters and numbers in the name.';
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

create or replace function public.unallow_minigame_name(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change the allowed names.';
  end if;
  delete from public.minigame_allowed_names where id = p_id;
  if not found then
    raise exception 'That name is not on the allowed list.';
  end if;
end;
$$;

revoke all on function public.unallow_minigame_name(bigint) from public, anon;
grant execute on function public.unallow_minigame_name(bigint) to authenticated;

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
    'cock', 'dick', 'dickhead', 'prick', 'knob', 'knobhead', 'piss',
    'slut', 'whore', 'bollock', 'bollocks', 'arse', 'arsehole',
    'asshole', 'asswipe', 'tits', 'pussy', 'faggot', 'nigger',
    'nigga', 'retard', 'spastic', 'fanny', 'bellend', 'minge',
    'tosser', 'bugger', 'shag', 'slag',
    'putain', 'merde', 'salope', 'connard', 'couille', 'enfoire',
    'mierda', 'joder', 'cabron', 'maricon', 'gilipollas', 'puta',
    'scheisse', 'fotze', 'arschloch', 'hurensohn', 'wichser',
    'cazzo', 'stronzo', 'puttana', 'vaffanculo', 'merda',
    'kurwa', 'pierdol', 'skurwysyn', 'klootzak', 'hoer',
    'caralho', 'porra', 'foder'
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

  if exists (
    select 1 from public.minigame_allowed_names
    where name_key = public.minigame_name_key(clean)
  ) then
    insert into public.minigame_scores (player_name, score) values (clean, p_score);
    select count(*)::integer into rank from public.minigame_scores where score > p_score;
    return rank + 1;
  end if;

  folded := public.minigame_name_key(clean);
  spaced := btrim(regexp_replace(
    translate(
      replace(lower(clean), 'ß', 'ss'),
      '@43105$!|7áàäâãåéèëêíìïîóòöôõúùüûýÿñç',
      'aaeiossiitaaaaaaeeeeiiiiooooouuuuyync'
    ),
    '[^a-z]+',
    ' ',
    'g'
  ));
  collapsed := folded;
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
