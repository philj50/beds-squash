-- An admin or a junior organiser can publish the hat draw on the Juniors page.
-- The public page shows a first name and surname initial.

create table if not exists public.junior_draw_publication (
  event_slug text primary key,
  published boolean not null default false
);

insert into public.junior_draw_publication (event_slug, published)
values ('junior-closed-2026', false)
on conflict (event_slug) do nothing;

alter table public.junior_draw_publication enable row level security;
revoke all on table public.junior_draw_publication from public, anon, authenticated;

create or replace function public.place_junior_draw(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.junior_entries%rowtype;
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

  select coalesce(max(draw_position), 0) + 1
    into v_next
  from public.junior_entries
  where event_slug = v_row.event_slug
    and age_category = v_row.age_category
    and draw = v_row.draw;

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
  v_id bigint;
begin
  if auth.uid() is null or not public.is_group_organiser('junior_organisers') then
    raise exception 'Only an admin or a junior organiser can place a player.' using errcode = '42501';
  end if;

  select * into v_row from public.junior_entries where id = p_id;
  if not found or v_row.draw_position is null then
    return;
  end if;

  update public.junior_entries
  set draw_position = null
  where id = p_id;

  for v_id in
    select id
    from public.junior_entries
    where event_slug = v_row.event_slug
      and age_category = v_row.age_category
      and draw = v_row.draw
      and draw_position > v_row.draw_position
    order by draw_position
  loop
    update public.junior_entries
    set draw_position = draw_position - 1
    where id = v_id;
  end loop;
end;
$$;

create or replace function public.junior_draw_is_published()
returns boolean
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
    (select published from public.junior_draw_publication where event_slug = 'junior-closed-2026'),
    false
  );
end;
$$;

create or replace function public.set_junior_draw_published(p_published boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_organiser('junior_organisers') then
    raise exception 'Only an admin or a junior organiser can publish the draw.' using errcode = '42501';
  end if;
  insert into public.junior_draw_publication (event_slug, published)
  values ('junior-closed-2026', coalesce(p_published, false))
  on conflict (event_slug) do update set published = excluded.published;
end;
$$;

create or replace function public.junior_public_draw()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((select published from public.junior_draw_publication where event_slug = 'junior-closed-2026'), false) is not true
      then jsonb_build_object('published', false, 'groups', '[]'::jsonb)
    else jsonb_build_object(
      'published', true,
      'groups', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'label', sized.label,
              'top', (
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
                from public.junior_entries e
                where e.event_slug = 'junior-closed-2026'
                  and e.age_category = sized.age
                  and e.draw = sized.section
                  and e.draw_position is not null
                  and e.draw_position <= ceil(sized.total / 2.0)
              ),
              'bottom', (
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
                from public.junior_entries e
                where e.event_slug = 'junior-closed-2026'
                  and e.age_category = sized.age
                  and e.draw = sized.section
                  and e.draw_position is not null
                  and e.draw_position > ceil(sized.total / 2.0)
              )
            )
            order by sized.sort
          )
          from (
            select
              g.label,
              g.age,
              g.section,
              g.sort,
              (
                select count(*)::int
                from public.junior_entries e
                where e.event_slug = 'junior-closed-2026'
                  and e.age_category = g.age
                  and e.draw = g.section
              ) as total
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
          ) as sized
          where exists (
            select 1
            from public.junior_entries e
            where e.event_slug = 'junior-closed-2026'
              and e.age_category = sized.age
              and e.draw = sized.section
              and e.draw_position is not null
          )
        ),
        '[]'::jsonb
      )
    )
  end;
$$;

revoke all on function public.place_junior_draw(bigint) from public, anon;
revoke all on function public.return_junior_draw(bigint) from public, anon;
revoke all on function public.junior_draw_is_published() from public, anon;
revoke all on function public.set_junior_draw_published(boolean) from public, anon;
revoke all on function public.junior_public_draw() from public;
grant execute on function public.place_junior_draw(bigint) to authenticated;
grant execute on function public.return_junior_draw(bigint) to authenticated;
grant execute on function public.junior_draw_is_published() to authenticated;
grant execute on function public.set_junior_draw_published(boolean) to authenticated;
grant execute on function public.junior_public_draw() to anon, authenticated;

notify pgrst, 'reload schema';
