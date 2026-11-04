-- The marker sees each watcher and the reactions that person sent.
-- A signed-in watcher is named. A guest is Guest plus the address seen for that visit.
-- The address is stored on the watcher row and returned only to the marker of that match.

alter table public.commentary_watchers
  add column if not exists client_mark text;

create or replace function public.commentary_client_ip()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  raw text;
  headers jsonb;
  candidate text;
begin
  raw := nullif(current_setting('request.headers', true), '');
  if raw is null then
    return null;
  end if;
  begin
    headers := raw::jsonb;
  exception when others then
    return null;
  end;
  candidate := coalesce(
    nullif(btrim(headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(headers ->> 'x-real-ip'), ''),
    nullif(btrim(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1)), '')
  );
  if candidate is null or char_length(candidate) > 64 then
    return null;
  end if;
  if candidate ~ '^([0-9]{1,3}\.){3}[0-9]{1,3}$' or candidate ~ '^[0-9A-Fa-f:.]{2,64}$' then
    return candidate;
  end if;
  return null;
end;
$$;

revoke all on function public.commentary_client_ip() from public, anon, authenticated;

create or replace function public.commentary_here(p_live bigint, p_guest text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  mid bigint := public.commentary_open_id(p_live);
  guest text := case when p_guest ~ '^[0-9a-fA-F-]{36}$' then lower(p_guest) else null end;
  person text;
  mark text;
begin
  if mid is null then
    return json_build_object('now', '[]'::json, 'looked', '[]'::json, 'guestsNow', 0, 'guestsEarlier', 0);
  end if;
  if auth.uid() is not null then
    select left(coalesce(nullif(btrim(display_name), ''), 'A player'), 80)
      into person
    from public.profiles
    where id = auth.uid();
    person := coalesce(person, 'A player');
    insert into public.commentary_watchers (match_id, profile_id, display_name, seen_at)
    values (mid, auth.uid(), person, now())
    on conflict (match_id, profile_id) where profile_id is not null
    do update set display_name = excluded.display_name, seen_at = now();
  elsif guest is not null then
    mark := public.commentary_client_ip();
    insert into public.commentary_watchers (match_id, guest_token, display_name, seen_at, client_mark)
    values (mid, guest, '', now(), mark)
    on conflict (match_id, guest_token) where guest_token is not null
    do update set
      seen_at = now(),
      client_mark = coalesce(excluded.client_mark, public.commentary_watchers.client_mark);
  end if;
  return public.commentary_room(mid, false);
end;
$$;

revoke all on function public.commentary_here(bigint, text) from public;
grant execute on function public.commentary_here(bigint, text) to anon, authenticated;

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
begin
  if auth.uid() is null then
    return json_build_object('people', '[]'::json);
  end if;
  select id into live_id from public.live_matches where marker_id = auth.uid();
  if live_id is null then
    return json_build_object('people', '[]'::json);
  end if;
  mid := public.commentary_open_id(live_id);
  if mid is null then
    return json_build_object('people', '[]'::json);
  end if;
  return json_build_object(
    'people', coalesce((
      select json_agg(
        json_build_object(
          'name', person.name,
          'here', person.here,
          'emojis', coalesce((
            select json_agg(json_build_object('kind', counts.kind, 'n', counts.n) order by counts.ord)
            from (
              select
                kind,
                count(*)::int as n,
                array_position(array['strong', 'love', 'happy', 'sad', 'comeon', 'getin', 'celebrate'], kind) as ord
              from public.commentary_shouts
              where match_id = mid
                and kind in ('strong', 'love', 'happy', 'sad', 'comeon', 'getin', 'celebrate')
                and (
                  (person.profile_id is not null and profile_id = person.profile_id)
                  or (person.guest_token is not null and guest_token = person.guest_token)
                )
              group by kind
            ) counts
          ), '[]'::json)
        )
        order by person.here desc, person.name
      )
      from (
        select
          w.profile_id,
          w.guest_token,
          case
            when w.profile_id is not null then coalesce(nullif(btrim(w.display_name), ''), 'A player')
            else 'Guest ' || coalesce(nullif(btrim(w.client_mark), ''), left(w.guest_token, 4))
          end as name,
          w.seen_at > now() - interval '40 seconds' as here
        from public.commentary_watchers w
        where w.match_id = mid
        union all
        select
          s.profile_id,
          s.guest_token,
          case
            when s.profile_id is not null then max(s.author)
            else 'Guest ' || left(s.guest_token, 4)
          end as name,
          false as here
        from public.commentary_shouts s
        where s.match_id = mid
          and s.kind in ('strong', 'love', 'happy', 'sad', 'comeon', 'getin', 'celebrate')
          and not exists (
            select 1
            from public.commentary_watchers w
            where w.match_id = s.match_id
              and (
                (s.profile_id is not null and w.profile_id = s.profile_id)
                or (s.guest_token is not null and w.guest_token = s.guest_token)
              )
          )
        group by s.profile_id, s.guest_token
      ) person
    ), '[]'::json)
  );
end;
$$;

revoke all on function public.marker_crowd() from public, anon;
grant execute on function public.marker_crowd() to authenticated;

notify pgrst, 'reload schema';
