-- A junior draw is one age group, or several played together.
-- Each draw is a knockout or a round robin, with a court and time at Towers.

drop function if exists public.set_junior_draw_group(text, text, text, text, text);
drop function if exists public.junior_draw_plans();
drop table if exists public.junior_draw_group;

create table if not exists public.junior_draw_pool (
  id bigint generated always as identity primary key,
  event_slug text not null default 'junior-closed-2026',
  format text not null default 'knockout',
  court text not null default '',
  start_time time,
  constraint junior_draw_pool_format_check check (format in ('knockout', 'round_robin'))
);

create table if not exists public.junior_draw_pool_member (
  pool_id bigint not null references public.junior_draw_pool (id) on delete cascade,
  event_slug text not null default 'junior-closed-2026',
  age_category text not null,
  draw text not null,
  primary key (event_slug, age_category, draw)
);

alter table public.junior_draw_pool enable row level security;
alter table public.junior_draw_pool_member enable row level security;
revoke all on table public.junior_draw_pool from public, anon, authenticated;
revoke all on table public.junior_draw_pool_member from public, anon, authenticated;

create or replace function public.junior_draw_pack(p_pool bigint, p_age text, p_section text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids bigint[];
  v_id bigint;
  v_next integer := 0;
begin
  select array_agg(e.id order by e.draw_position, e.id)
    into v_ids
  from public.junior_entries e
  where e.event_slug = 'junior-closed-2026'
    and e.draw_position is not null
    and (
      (p_pool is not null and exists (
        select 1
        from public.junior_draw_pool_member m
        where m.pool_id = p_pool
          and m.event_slug = e.event_slug
          and m.age_category = e.age_category
          and m.draw = e.draw
      ))
      or (p_pool is null and e.age_category = p_age and e.draw = p_section)
    );

  if v_ids is null then
    return;
  end if;

  update public.junior_entries
  set draw_position = null
  where id = any (v_ids);

  foreach v_id in array v_ids loop
    v_next := v_next + 1;
    update public.junior_entries
    set draw_position = v_next
    where id = v_id;
  end loop;
end;
$$;

create or replace function public.place_junior_draw(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.junior_entries%rowtype;
  v_pool bigint;
  v_next integer;
begin
  if auth.uid() is null or not public.is_group_organiser('junior_organisers') then
    raise exception 'Only an admin or a junior organiser can place a player.' using errcode = '42501';
  end if;

  select * into v_row from public.junior_entries where id = p_id;
  if not found then
    raise exception 'That entry is not on the list.' using errcode = 'P0002';
  end if;
  if v_row.draw_position is not null then
    return;
  end if;

  select pool_id into v_pool
  from public.junior_draw_pool_member
  where event_slug = v_row.event_slug
    and age_category = v_row.age_category
    and draw = v_row.draw;

  if v_pool is null then
    select coalesce(max(draw_position), 0) + 1
      into v_next
    from public.junior_entries
    where event_slug = v_row.event_slug
      and age_category = v_row.age_category
      and draw = v_row.draw;
  else
    select coalesce(max(e.draw_position), 0) + 1
      into v_next
    from public.junior_entries e
    join public.junior_draw_pool_member m
      on m.event_slug = e.event_slug
     and m.age_category = e.age_category
     and m.draw = e.draw
     and m.pool_id = v_pool
    where e.event_slug = v_row.event_slug;
  end if;

  update public.junior_entries
  set draw_position = v_next
  where id = p_id;
end;
$$;

create or replace function public.return_junior_draw(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.junior_entries%rowtype;
  v_pool bigint;
  v_id bigint;
begin
  if auth.uid() is null or not public.is_group_organiser('junior_organisers') then
    raise exception 'Only an admin or a junior organiser can place a player.' using errcode = '42501';
  end if;

  select * into v_row from public.junior_entries where id = p_id;
  if not found or v_row.draw_position is null then
    return;
  end if;

  select pool_id into v_pool
  from public.junior_draw_pool_member
  where event_slug = v_row.event_slug
    and age_category = v_row.age_category
    and draw = v_row.draw;

  update public.junior_entries
  set draw_position = null
  where id = p_id;

  for v_id in
    select e.id
    from public.junior_entries e
    where e.event_slug = v_row.event_slug
      and e.draw_position > v_row.draw_position
      and (
        (v_pool is null and e.age_category = v_row.age_category and e.draw = v_row.draw)
        or exists (
          select 1
          from public.junior_draw_pool_member m
          where m.pool_id = v_pool
            and m.event_slug = e.event_slug
            and m.age_category = e.age_category
            and m.draw = e.draw
        )
      )
    order by e.draw_position
  loop
    update public.junior_entries
    set draw_position = draw_position - 1
    where id = v_id;
  end loop;
end;
$$;

create or replace function public.junior_draw_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_organiser('junior_organisers') then
    raise exception 'Only an admin or a junior organiser can see the draw.' using errcode = '42501';
  end if;
  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'format', pool.format,
          'court', pool.court,
          'start', pool.start_at,
          'members', pool.members
        )
        order by pool.sort
      )
      from (
        select
          p.format,
          p.court,
          coalesce(to_char(p.start_time, 'HH24:MI'), '') as start_at,
          jsonb_agg(
            jsonb_build_object('age', m.age_category, 'section', m.draw)
            order by k.sort
          ) as members,
          min(k.sort) as sort
        from public.junior_draw_pool p
        join public.junior_draw_pool_member m on m.pool_id = p.id
        join (
          values
            ('Under 9', 'Mixed', 1),
            ('Under 11', 'Girls', 2),
            ('Under 13', 'Girls', 3),
            ('Under 15', 'Girls', 4),
            ('Under 17', 'Girls', 5),
            ('Under 19', 'Girls', 6),
            ('Under 11', 'Boys', 7),
            ('Under 13', 'Boys', 8),
            ('Under 15', 'Boys', 9),
            ('Under 17', 'Boys', 10),
            ('Under 19', 'Boys', 11)
        ) as k(age, section, sort)
          on k.age = m.age_category
         and k.section = m.draw
        where p.event_slug = 'junior-closed-2026'
        group by p.id
      ) as pool
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.set_junior_draw_pool(
  p_members jsonb,
  p_format text,
  p_court text,
  p_start text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member jsonb;
  v_age text;
  v_section text;
  v_start time;
  v_pool bigint;
  v_id bigint;
  v_changed boolean;
begin
  if auth.uid() is null or not public.is_group_organiser('junior_organisers') then
    raise exception 'Only an admin or a junior organiser can set the draw.' using errcode = '42501';
  end if;
  if p_format not in ('knockout', 'round_robin') then
    raise exception 'Choose knockout or round robin.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_members) is distinct from 'array' or jsonb_array_length(p_members) < 1 then
    raise exception 'Choose at least one category.' using errcode = '22023';
  end if;

  create temporary table if not exists _junior_draw_members (
    age text,
    section text,
    primary key (age, section)
  ) on commit drop;
  truncate _junior_draw_members;

  for v_member in select value from jsonb_array_elements(p_members) loop
    v_age := v_member ->> 'age';
    v_section := v_member ->> 'section';
    if not exists (
      select 1
      from (
        values
          ('Under 9', 'Mixed'),
          ('Under 11', 'Girls'),
          ('Under 13', 'Girls'),
          ('Under 15', 'Girls'),
          ('Under 17', 'Girls'),
          ('Under 19', 'Girls'),
          ('Under 11', 'Boys'),
          ('Under 13', 'Boys'),
          ('Under 15', 'Boys'),
          ('Under 17', 'Boys'),
          ('Under 19', 'Boys')
      ) as known(age, section)
      where known.age = v_age
        and known.section = v_section
    ) then
      raise exception 'That age group is not in the draw.' using errcode = '22023';
    end if;
    insert into _junior_draw_members (age, section) values (v_age, v_section)
    on conflict do nothing;
  end loop;

  v_start := null;
  if nullif(btrim(coalesce(p_start, '')), '') is not null then
    if btrim(p_start) !~ '^\d{2}:\d{2}$' then
      raise exception 'Enter a time as HH:MM.' using errcode = '22023';
    end if;
    v_start := btrim(p_start)::time;
  end if;

  select m.pool_id
    into v_pool
  from public.junior_draw_pool_member m
  join _junior_draw_members wanted
    on wanted.age = m.age_category
   and wanted.section = m.draw
  where m.event_slug = 'junior-closed-2026'
  order by m.pool_id
  limit 1;

  if v_pool is null then
    v_changed := true;
    insert into public.junior_draw_pool (event_slug, format, court, start_time)
    values ('junior-closed-2026', p_format, left(btrim(coalesce(p_court, '')), 40), v_start)
    returning id into v_pool;
  else
    select exists (
      select 1
      from public.junior_draw_pool_member m
      where m.pool_id = v_pool
        and not exists (
          select 1 from _junior_draw_members wanted
          where wanted.age = m.age_category and wanted.section = m.draw
        )
      union
      select 1
      from _junior_draw_members wanted
      where not exists (
        select 1
        from public.junior_draw_pool_member m
        where m.event_slug = 'junior-closed-2026'
          and m.age_category = wanted.age
          and m.draw = wanted.section
          and m.pool_id = v_pool
      )
    )
      into v_changed;
    update public.junior_draw_pool
    set format = p_format,
        court = left(btrim(coalesce(p_court, '')), 40),
        start_time = v_start
    where id = v_pool;
  end if;

  delete from public.junior_draw_pool_member m
  using _junior_draw_members wanted
  where m.event_slug = 'junior-closed-2026'
    and m.age_category = wanted.age
    and m.draw = wanted.section;

  delete from public.junior_draw_pool_member
  where pool_id = v_pool;

  insert into public.junior_draw_pool_member (pool_id, event_slug, age_category, draw)
  select v_pool, 'junior-closed-2026', age, section
  from _junior_draw_members;

  delete from public.junior_draw_pool p
  where p.event_slug = 'junior-closed-2026'
    and not exists (
      select 1 from public.junior_draw_pool_member m where m.pool_id = p.id
    );

  if v_changed then
  for v_id in
    select id from public.junior_draw_pool where event_slug = 'junior-closed-2026'
  loop
    perform public.junior_draw_pack(v_id, null, null);
  end loop;

  for v_age, v_section in
    select known.age, known.section
    from (
      values
        ('Under 9', 'Mixed'),
        ('Under 11', 'Girls'),
        ('Under 13', 'Girls'),
        ('Under 15', 'Girls'),
        ('Under 17', 'Girls'),
        ('Under 19', 'Girls'),
        ('Under 11', 'Boys'),
        ('Under 13', 'Boys'),
        ('Under 15', 'Boys'),
        ('Under 17', 'Boys'),
        ('Under 19', 'Boys')
    ) as known(age, section)
    where not exists (
      select 1
      from public.junior_draw_pool_member m
      where m.event_slug = 'junior-closed-2026'
        and m.age_category = known.age
        and m.draw = known.section
    )
  loop
    perform public.junior_draw_pack(null, v_age, v_section);
  end loop;
  end if;
end;
$$;

create or replace function public.junior_public_slice(
  p_label text,
  p_format text,
  p_court text,
  p_start text,
  p_pool bigint,
  p_age text,
  p_section text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with members as (
    select age_category, draw
    from public.junior_draw_pool_member
    where p_pool is not null
      and pool_id = p_pool
    union all
    select p_age, p_section
    where p_pool is null
  ),
  entrants as (
    select e.*
    from public.junior_entries e
    join members m
      on m.age_category = e.age_category
     and m.draw = e.draw
    where e.event_slug = 'junior-closed-2026'
  ),
  sized as (
    select
      count(*)::int as total,
      count(*) filter (where draw_position is not null)::int as placed
    from entrants
  )
  select case
    when (select placed from sized) = 0 then null
    else jsonb_build_object(
      'label', p_label,
      'format', coalesce(p_format, 'knockout'),
      'court', coalesce(p_court, ''),
      'start', coalesce(p_start, ''),
      'players', case
        when coalesce(p_format, 'knockout') = 'round_robin' then (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'place', e.draw_position,
                'name', public.junior_short_name(e.player_first_name, e.player_last_name)
              )
              order by e.draw_position
            ),
            '[]'::jsonb
          )
          from entrants e
          where e.draw_position is not null
        )
        else '[]'::jsonb
      end,
      'top', case
        when coalesce(p_format, 'knockout') = 'round_robin' then '[]'::jsonb
        else (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'place', e.draw_position,
                'name', public.junior_short_name(e.player_first_name, e.player_last_name)
              )
              order by e.draw_position
            ),
            '[]'::jsonb
          )
          from entrants e
          where e.draw_position is not null
            and e.draw_position <= ceil((select total from sized) / 2.0)
        )
      end,
      'bottom', case
        when coalesce(p_format, 'knockout') = 'round_robin' then '[]'::jsonb
        else (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'place', e.draw_position,
                'name', public.junior_short_name(e.player_first_name, e.player_last_name)
              )
              order by e.draw_position
            ),
            '[]'::jsonb
          )
          from entrants e
          where e.draw_position is not null
            and e.draw_position > ceil((select total from sized) / 2.0)
        )
      end
    )
  end;
$$;

create or replace function public.junior_public_draw()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with known as (
    select *
    from (
      values
        ('Mixed U9', 'Under 9', 'Mixed', 1),
        ('Girls U11', 'Under 11', 'Girls', 2),
        ('Girls U13', 'Under 13', 'Girls', 3),
        ('Girls U15', 'Under 15', 'Girls', 4),
        ('Girls U17', 'Under 17', 'Girls', 5),
        ('Girls U19', 'Under 19', 'Girls', 6),
        ('Boys U11', 'Under 11', 'Boys', 7),
        ('Boys U13', 'Under 13', 'Boys', 8),
        ('Boys U15', 'Under 15', 'Boys', 9),
        ('Boys U17', 'Under 17', 'Boys', 10),
        ('Boys U19', 'Under 19', 'Boys', 11)
    ) as g(label, age, section, sort)
  ),
  pools as (
    select
      p.id,
      p.format,
      coalesce(p.court, '') as court,
      coalesce(to_char(p.start_time, 'HH24:MI'), '') as start_at,
      string_agg(k.label, ' and ' order by k.sort) as label,
      min(k.sort) as sort
    from public.junior_draw_pool p
    join public.junior_draw_pool_member m on m.pool_id = p.id
    join known k on k.age = m.age_category and k.section = m.draw
    where p.event_slug = 'junior-closed-2026'
    group by p.id
  ),
  slices as (
    select public.junior_public_slice(label, format, court, start_at, id, null, null) as slice, sort
    from pools
    union all
    select public.junior_public_slice(k.label, 'knockout', '', '', null, k.age, k.section), k.sort
    from known k
    where not exists (
      select 1
      from public.junior_draw_pool_member m
      where m.event_slug = 'junior-closed-2026'
        and m.age_category = k.age
        and m.draw = k.section
    )
  )
  select case
    when coalesce((select published from public.junior_draw_publication where event_slug = 'junior-closed-2026'), false) is not true
      then jsonb_build_object('published', false, 'groups', '[]'::jsonb)
    else jsonb_build_object(
      'published', true,
      'groups', coalesce(
        (select jsonb_agg(slice order by sort) from slices where slice is not null),
        '[]'::jsonb
      )
    )
  end;
$$;

revoke all on function public.junior_draw_pack(bigint, text, text) from public, anon, authenticated;
revoke all on function public.junior_public_slice(text, text, text, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.place_junior_draw(bigint) from public, anon;
revoke all on function public.return_junior_draw(bigint) from public, anon;
revoke all on function public.junior_draw_plans() from public, anon;
revoke all on function public.set_junior_draw_pool(jsonb, text, text, text) from public, anon;
revoke all on function public.junior_public_draw() from public;
grant execute on function public.place_junior_draw(bigint) to authenticated;
grant execute on function public.return_junior_draw(bigint) to authenticated;
grant execute on function public.junior_draw_plans() to authenticated;
grant execute on function public.set_junior_draw_pool(jsonb, text, text, text) to authenticated;
grant execute on function public.junior_public_draw() to anon, authenticated;

notify pgrst, 'reload schema';
