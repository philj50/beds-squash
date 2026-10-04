-- Stop a short list of rude initials, and let an admin stop any others.

drop function if exists public.allow_minigame_name(text);
drop function if exists public.unallow_minigame_name(bigint);
drop table if exists public.minigame_allowed_names;

create table public.minigame_blocked_initials (
  id bigint generated always as identity primary key,
  initials text not null,
  name_key text not null unique,
  created_at timestamptz not null default now()
);

alter table public.minigame_blocked_initials enable row level security;

create policy "public read blocked minigame initials"
  on public.minigame_blocked_initials
  for select
  to anon, authenticated
  using (true);

revoke all on public.minigame_blocked_initials from anon, authenticated;
grant select on public.minigame_blocked_initials to anon, authenticated;

create or replace function public.block_minigame_initials(p_initials text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := upper(btrim(coalesce(p_initials, '')));
begin
  if not public.is_admin() then
    raise exception 'Only an admin can stop initials.';
  end if;
  if clean !~ '^[A-Z]{2,3}$' then
    raise exception 'Use two or three letters.';
  end if;
  insert into public.minigame_blocked_initials (initials, name_key)
  values (clean, public.minigame_name_key(clean))
  on conflict (name_key) do nothing;
  if not found then
    raise exception 'Those initials are already stopped.';
  end if;
end;
$$;

revoke all on function public.block_minigame_initials(text) from public, anon;
grant execute on function public.block_minigame_initials(text) to authenticated;

create or replace function public.unblock_minigame_initials(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change the stopped initials.';
  end if;
  delete from public.minigame_blocked_initials where id = p_id;
  if not found then
    raise exception 'Those initials are not on the stopped list.';
  end if;
end;
$$;

revoke all on function public.unblock_minigame_initials(bigint) from public, anon;
grant execute on function public.unblock_minigame_initials(bigint) to authenticated;

create or replace function public.submit_minigame_score(p_name text, p_score integer)
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
begin
  if clean !~ '^[A-Z]{2,3}$' then
    raise exception 'Use two or three letters.';
  end if;
  if p_score is null or p_score < 1 or p_score > 9999 then
    raise exception 'That score cannot be saved.';
  end if;
  if lower(clean) = any (builtin)
    or exists (
      select 1 from public.minigame_blocked_initials
      where name_key = public.minigame_name_key(clean)
    )
  then
    raise exception 'Let. That name hit the tin, so it is not going on the board.';
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
