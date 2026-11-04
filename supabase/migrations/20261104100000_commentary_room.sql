-- Match commentary keeps a copy of each match, who looked in, and the short shouts.
-- A signed-in watcher is named. Someone who is not signed in is counted, not named.
-- No email address is stored or returned.

create table if not exists public.commentary_matches (
  id bigint generated always as identity primary key,
  live_id bigint,
  marker_id uuid not null references auth.users (id) on delete cascade,
  player_a text not null,
  player_b text not null,
  score text not null,
  history jsonb not null,
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint commentary_name_len check (
    char_length(player_a) between 2 and 80
    and char_length(player_b) between 2 and 80
  )
);

create unique index if not exists commentary_one_open
  on public.commentary_matches (live_id)
  where ended_at is null and live_id is not null;

create index if not exists commentary_matches_ended
  on public.commentary_matches (ended_at desc);

create table if not exists public.commentary_watchers (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.commentary_matches (id) on delete cascade,
  profile_id uuid references auth.users (id) on delete cascade,
  guest_token text,
  display_name text not null default '',
  seen_at timestamptz not null default now(),
  constraint commentary_watcher_one check (profile_id is not null or guest_token is not null)
);

create unique index if not exists commentary_watcher_profile
  on public.commentary_watchers (match_id, profile_id)
  where profile_id is not null;

create unique index if not exists commentary_watcher_guest
  on public.commentary_watchers (match_id, guest_token)
  where guest_token is not null;

create table if not exists public.commentary_shouts (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.commentary_matches (id) on delete cascade,
  profile_id uuid references auth.users (id) on delete set null,
  guest_token text,
  author text not null,
  kind text not null,
  created_at timestamptz not null default now(),
  constraint commentary_shout_kind check (kind in ('a', 'b', 'yes', 'clap'))
);

create index if not exists commentary_shouts_match
  on public.commentary_shouts (match_id, id);

alter table public.commentary_matches enable row level security;
alter table public.commentary_watchers enable row level security;
alter table public.commentary_shouts enable row level security;
revoke all on table public.commentary_matches from public, anon, authenticated;
revoke all on table public.commentary_watchers from public, anon, authenticated;
revoke all on table public.commentary_shouts from public, anon, authenticated;

create or replace function public.keep_commentary_match(
  p_live bigint,
  p_a text,
  p_b text,
  p_score text,
  p_history jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  open_id bigint;
  open_a text;
  open_b text;
begin
  if auth.uid() is null then
    return;
  end if;
  select id, player_a, player_b
    into open_id, open_a, open_b
  from public.commentary_matches
  where live_id = p_live
    and ended_at is null
  order by id desc
  limit 1;
  if open_id is not null and lower(open_a) = lower(p_a) and lower(open_b) = lower(p_b) then
    update public.commentary_matches
      set score = p_score,
          history = p_history,
          updated_at = now()
      where id = open_id;
    return;
  end if;
  if open_id is not null then
    update public.commentary_matches
      set ended_at = now(),
          updated_at = now()
      where id = open_id;
  end if;
  insert into public.commentary_matches (live_id, marker_id, player_a, player_b, score, history, updated_at)
  values (p_live, auth.uid(), p_a, p_b, p_score, p_history, now());
end;
$$;

revoke all on function public.keep_commentary_match(bigint, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.end_commentary_match(p_live bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.commentary_matches
    set ended_at = now(),
        updated_at = now()
    where live_id = p_live
      and ended_at is null;
end;
$$;

revoke all on function public.end_commentary_match(bigint) from public, anon, authenticated;

create or replace function public.publish_live_match(p_a text, p_b text, p_score text, p_history jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  left_name text := nullif(regexp_replace(btrim(coalesce(p_a, '')), '\s+', ' ', 'g'), '');
  right_name text := nullif(regexp_replace(btrim(coalesce(p_b, '')), '\s+', ' ', 'g'), '');
  line text := nullif(btrim(coalesce(p_score, '')), '');
  live_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in to let people watch.';
  end if;
  if left_name is null or char_length(left_name) < 2 or char_length(left_name) > 80
     or left_name !~ '^[A-Za-z][A-Za-z .''-]*$' then
    raise exception 'Enter the first player''s name.';
  end if;
  if right_name is null or char_length(right_name) < 2 or char_length(right_name) > 80
     or right_name !~ '^[A-Za-z][A-Za-z .''-]*$' then
    raise exception 'Enter the second player''s name.';
  end if;
  if lower(left_name) = lower(right_name) then
    raise exception 'Pick two different players.';
  end if;
  if line is null or char_length(line) > 120 then
    line := '0-0';
  end if;
  if p_history is null or jsonb_typeof(p_history) <> 'object'
     or jsonb_typeof(p_history -> 'games') <> 'array'
     or octet_length(p_history::text) > 80000 then
    raise exception 'That match cannot be shared.';
  end if;
  insert into public.live_matches (marker_id, player_a, player_b, score, history, updated_at)
  values (auth.uid(), left_name, right_name, line, p_history, now())
  on conflict (marker_id) do update
    set player_a = excluded.player_a,
        player_b = excluded.player_b,
        score = excluded.score,
        history = excluded.history,
        updated_at = now()
  returning id into live_id;
  perform public.keep_commentary_match(live_id, left_name, right_name, line, p_history);
  return json_build_object('id', live_id);
end;
$$;

revoke all on function public.publish_live_match(text, text, text, jsonb) from public;
grant execute on function public.publish_live_match(text, text, text, jsonb) to authenticated;

create or replace function public.clear_live_match()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  live_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in to let people watch.';
  end if;
  select id into live_id from public.live_matches where marker_id = auth.uid();
  if live_id is not null then
    perform public.end_commentary_match(live_id);
  end if;
  delete from public.live_matches where marker_id = auth.uid();
end;
$$;

revoke all on function public.clear_live_match() from public;
grant execute on function public.clear_live_match() to authenticated;

create or replace function public.admin_clear_stale_live_match(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can clear a match in play.';
  end if;
  perform public.end_commentary_match(p_id);
  delete from public.live_matches
  where id = p_id;
  if not found then
    raise exception 'That match has already been cleared.';
  end if;
end;
$$;

revoke all on function public.admin_clear_stale_live_match(bigint) from public;
grant execute on function public.admin_clear_stale_live_match(bigint) to authenticated;

create or replace function public.admin_clear_stale_live_matches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can clear a match in play.';
  end if;
  update public.commentary_matches as kept
    set ended_at = now(),
        updated_at = now()
    from public.live_matches as live
    where kept.live_id = live.id
      and kept.ended_at is null
      and live.updated_at < now() - interval '1 hour';
  delete from public.live_matches
  where updated_at < now() - interval '1 hour';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.admin_clear_stale_live_matches() from public;
grant execute on function public.admin_clear_stale_live_matches() to authenticated;

-- Everyone following the match can open the points. The list is scores only.
create or replace function public.current_matches()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(rows)), '[]'::json)
  from (
    select
      m.id,
      case
        when auth.uid() is null then public.public_player_name(m.player_a)
        else m.player_a
      end as "playerA",
      case
        when auth.uid() is null then public.public_player_name(m.player_b)
        else m.player_b
      end as "playerB",
      m.score,
      m.history,
      case
        when auth.uid() is null then null
        else coalesce(nullif(btrim(p.display_name), ''), 'A marker')
      end as marker,
      m.updated_at as "updatedAt"
    from public.live_matches m
    left join public.profiles p on p.id = m.marker_id
    where m.updated_at > now() - interval '1 hour'
    order by m.updated_at desc
    limit 12
  ) rows;
$$;

revoke all on function public.current_matches() from public;
grant execute on function public.current_matches() to anon, authenticated;

create or replace function public.commentary_room(p_match bigint, p_ended boolean)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'now', coalesce((
      select json_agg(person order by person)
      from (
        select case
          when auth.uid() is null then public.public_player_name(display_name)
          else display_name
        end as person
        from public.commentary_watchers
        where match_id = p_match
          and profile_id is not null
          and not p_ended
          and seen_at > now() - interval '40 seconds'
      ) people
    ), '[]'::json),
    'looked', coalesce((
      select json_agg(person order by person)
      from (
        select case
          when auth.uid() is null then public.public_player_name(display_name)
          else display_name
        end as person
        from public.commentary_watchers
        where match_id = p_match
          and profile_id is not null
          and (p_ended or seen_at <= now() - interval '40 seconds')
      ) people
    ), '[]'::json),
    'guestsNow', (
      select count(*)
      from public.commentary_watchers
      where match_id = p_match
        and profile_id is null
        and not p_ended
        and seen_at > now() - interval '40 seconds'
    ),
    'guestsEarlier', (
      select count(*)
      from public.commentary_watchers
      where match_id = p_match
        and profile_id is null
        and (p_ended or seen_at <= now() - interval '40 seconds')
    )
  );
$$;

revoke all on function public.commentary_room(bigint, boolean) from public, anon, authenticated;

create or replace function public.commentary_shout_list(p_match bigint, p_after bigint)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(rows)), '[]'::json)
  from (
    select
      id,
      kind,
      case
        when auth.uid() is null then public.public_player_name(author)
        else author
      end as name,
      created_at as at
    from public.commentary_shouts
    where match_id = p_match
      and (p_after > 0 and id > p_after or p_after = 0)
    order by id desc
    limit case when p_after = 0 then 12 else 20 end
  ) rows;
$$;

revoke all on function public.commentary_shout_list(bigint, bigint) from public, anon, authenticated;

create or replace function public.commentary_open_id(p_live bigint)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.commentary_matches
  where live_id = p_live
    and ended_at is null
  order by id desc
  limit 1;
$$;

revoke all on function public.commentary_open_id(bigint) from public, anon, authenticated;

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
    insert into public.commentary_watchers (match_id, guest_token, display_name, seen_at)
    values (mid, guest, '', now())
    on conflict (match_id, guest_token) where guest_token is not null
    do update set seen_at = now();
  end if;
  return public.commentary_room(mid, false);
end;
$$;

revoke all on function public.commentary_here(bigint, text) from public;
grant execute on function public.commentary_here(bigint, text) to anon, authenticated;

create or replace function public.commentary_shout(p_live bigint, p_kind text, p_guest text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  mid bigint := public.commentary_open_id(p_live);
  guest text := case when p_guest ~ '^[0-9a-fA-F-]{36}$' then lower(p_guest) else null end;
  author text := 'Someone';
  shout_id bigint;
begin
  if mid is null or p_kind not in ('a', 'b', 'yes', 'clap') then
    return json_build_object('ok', false);
  end if;
  if auth.uid() is null and guest is null then
    return json_build_object('ok', false);
  end if;
  if exists (
    select 1
    from public.commentary_shouts
    where match_id = mid
      and created_at > now() - interval '3 seconds'
      and (
        (auth.uid() is not null and profile_id = auth.uid())
        or (auth.uid() is null and guest_token = guest)
      )
  ) then
    return json_build_object('ok', false);
  end if;
  if auth.uid() is not null then
    select left(coalesce(nullif(btrim(display_name), ''), 'A player'), 80)
      into author
    from public.profiles
    where id = auth.uid();
    author := coalesce(author, 'A player');
  end if;
  insert into public.commentary_shouts (match_id, profile_id, guest_token, author, kind)
  values (mid, auth.uid(), case when auth.uid() is null then guest else null end, author, p_kind)
  returning id into shout_id;
  return json_build_object(
    'ok', true,
    'id', shout_id,
    'kind', p_kind,
    'name', case when auth.uid() is null then public.public_player_name(author) else author end,
    'at', now()
  );
end;
$$;

revoke all on function public.commentary_shout(bigint, text, text) from public;
grant execute on function public.commentary_shout(bigint, text, text) to anon, authenticated;

create or replace function public.commentary_shouts(p_live bigint, p_after bigint)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  mid bigint := public.commentary_open_id(p_live);
begin
  if mid is null then
    return '[]'::json;
  end if;
  return public.commentary_shout_list(mid, coalesce(p_after, 0));
end;
$$;

revoke all on function public.commentary_shouts(bigint, bigint) from public;
grant execute on function public.commentary_shouts(bigint, bigint) to anon, authenticated;

create or replace function public.commentary_archive()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(rows)), '[]'::json)
  from (
    select
      c.id,
      case
        when auth.uid() is null then public.public_player_name(c.player_a)
        else c.player_a
      end as "playerA",
      case
        when auth.uid() is null then public.public_player_name(c.player_b)
        else c.player_b
      end as "playerB",
      c.score,
      c.ended_at as "endedAt"
    from public.commentary_matches c
    where c.ended_at is not null
    order by c.ended_at desc
    limit 40
  ) rows;
$$;

revoke all on function public.commentary_archive() from public;
grant execute on function public.commentary_archive() to anon, authenticated;

create or replace function public.commentary_match(p_id bigint)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'id', c.id,
    'playerA', case
      when auth.uid() is null then public.public_player_name(c.player_a)
      else c.player_a
    end,
    'playerB', case
      when auth.uid() is null then public.public_player_name(c.player_b)
      else c.player_b
    end,
    'score', c.score,
    'history', c.history,
    'marker', case
      when auth.uid() is null then null
      else coalesce(nullif(btrim(p.display_name), ''), 'A marker')
    end,
    'updatedAt', c.updated_at,
    'endedAt', c.ended_at,
    'room', public.commentary_room(c.id, true),
    'shouts', public.commentary_shout_list(c.id, 0)
  )
  from public.commentary_matches c
  left join public.profiles p on p.id = c.marker_id
  where c.id = p_id;
$$;

revoke all on function public.commentary_match(bigint) from public;
grant execute on function public.commentary_match(bigint) to anon, authenticated;

insert into public.commentary_matches (marker_id, player_a, player_b, score, history, updated_at, ended_at)
select
  m.marker_id,
  m.player_a,
  m.player_b,
  m.score,
  case
    when jsonb_typeof(m.history) = 'object' then m.history
    else '{"games":[[]]}'::jsonb
  end,
  coalesce(m.updated_at, m.created_at, now()),
  coalesce(m.updated_at, m.created_at, now())
from public.marked_matches m
where not exists (select 1 from public.commentary_matches)
order by m.created_at desc
limit 40;

insert into public.commentary_matches (live_id, marker_id, player_a, player_b, score, history, updated_at)
select
  m.id,
  m.marker_id,
  m.player_a,
  m.player_b,
  m.score,
  case
    when jsonb_typeof(m.history) = 'object' then m.history
    else '{"games":[[]]}'::jsonb
  end,
  m.updated_at
from public.live_matches m
where m.updated_at > now() - interval '1 hour'
  and not exists (
    select 1
    from public.commentary_matches c
    where c.live_id = m.id
      and c.ended_at is null
  );

notify pgrst, 'reload schema';
