-- The marker can see who is watching their live match, and how many of each reaction was sent.

create or replace function public.marker_crowd()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  live_id bigint;
  mid bigint;
  room json;
begin
  if auth.uid() is null then
    return json_build_object('watching', '[]'::json, 'looked', '[]'::json, 'guests', 0, 'guestsEarlier', 0, 'emojis', '[]'::json);
  end if;
  select id into live_id from public.live_matches where marker_id = auth.uid();
  if live_id is null then
    return json_build_object('watching', '[]'::json, 'looked', '[]'::json, 'guests', 0, 'guestsEarlier', 0, 'emojis', '[]'::json);
  end if;
  mid := public.commentary_open_id(live_id);
  if mid is null then
    return json_build_object('watching', '[]'::json, 'looked', '[]'::json, 'guests', 0, 'guestsEarlier', 0, 'emojis', '[]'::json);
  end if;
  room := public.commentary_room(mid, false);
  return json_build_object(
    'watching', room -> 'now',
    'looked', room -> 'looked',
    'guests', coalesce((room ->> 'guestsNow')::int, 0),
    'guestsEarlier', coalesce((room ->> 'guestsEarlier')::int, 0),
    'emojis', coalesce((
      select json_agg(json_build_object('kind', kind, 'n', n))
      from (
        select kind, count(*)::int as n
        from public.commentary_shouts
        where match_id = mid
          and kind in ('strong', 'love', 'happy', 'sad', 'comeon', 'getin', 'celebrate')
        group by kind
      ) counts
    ), '[]'::json)
  );
end;
$$;

revoke all on function public.marker_crowd() from public, anon;
grant execute on function public.marker_crowd() to authenticated;

notify pgrst, 'reload schema';
