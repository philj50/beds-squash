-- Come on a named player. The marker still counts these with the Come on emoji.

alter table public.commentary_shouts drop constraint if exists commentary_shout_kind;

alter table public.commentary_shouts
  add constraint commentary_shout_kind
  check (kind in ('a', 'b', 'yes', 'clap', 'strong', 'love', 'happy', 'sad', 'comeon', 'comeona', 'comeonb', 'getin', 'celebrate'));

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
  if mid is null or auth.uid() is null or p_kind not in ('strong', 'love', 'happy', 'sad', 'comeon', 'comeona', 'comeonb', 'getin', 'celebrate') then
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
                case when kind in ('comeona', 'comeonb') then 'comeon' else kind end as kind,
                count(*)::int as n,
                array_position(
                  array['strong', 'love', 'happy', 'sad', 'comeon', 'getin', 'celebrate'],
                  case when kind in ('comeona', 'comeonb') then 'comeon' else kind end
                ) as ord
              from public.commentary_shouts
              where match_id = mid
                and kind in ('strong', 'love', 'happy', 'sad', 'comeon', 'comeona', 'comeonb', 'getin', 'celebrate')
                and (
                  (person.profile_id is not null and profile_id = person.profile_id)
                  or (person.guest_token is not null and guest_token = person.guest_token)
                )
              group by 1
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
          and s.kind in ('strong', 'love', 'happy', 'sad', 'comeon', 'comeona', 'comeonb', 'getin', 'celebrate')
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
