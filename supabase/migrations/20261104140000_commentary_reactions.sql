-- Reactions on a live match. A signed-in player can send one.
-- Older kinds stay allowed so rows already stored still fit.

alter table public.commentary_shouts drop constraint if exists commentary_shout_kind;

alter table public.commentary_shouts
  add constraint commentary_shout_kind
  check (kind in ('a', 'b', 'yes', 'clap', 'strong', 'love', 'happy', 'sad', 'comeon', 'getin'));

create or replace function public.commentary_shout(p_live bigint, p_kind text, p_guest text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  mid bigint := public.commentary_open_id(p_live);
  author text := 'A player';
  shout_id bigint;
begin
  if mid is null or auth.uid() is null or p_kind not in ('strong', 'love', 'happy', 'sad', 'comeon', 'getin') then
    return json_build_object('ok', false);
  end if;
  if exists (
    select 1
    from public.commentary_shouts
    where match_id = mid
      and profile_id = auth.uid()
      and created_at > now() - interval '3 seconds'
  ) then
    return json_build_object('ok', false);
  end if;
  select left(coalesce(nullif(btrim(display_name), ''), 'A player'), 80)
    into author
  from public.profiles
  where id = auth.uid();
  author := coalesce(author, 'A player');
  insert into public.commentary_shouts (match_id, profile_id, guest_token, author, kind)
  values (mid, auth.uid(), null, author, p_kind)
  returning id into shout_id;
  return json_build_object(
    'ok', true,
    'id', shout_id,
    'kind', p_kind,
    'name', author,
    'at', now()
  );
end;
$$;

revoke all on function public.commentary_shout(bigint, text, text) from public;
grant execute on function public.commentary_shout(bigint, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
