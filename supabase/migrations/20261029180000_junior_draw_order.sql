-- A junior organiser places each entrant in hat order.
-- The position stays empty until a name is drawn.

alter table public.junior_entries
  add column if not exists draw_position integer;

comment on column public.junior_entries.draw_position is
  'Order this player was drawn into their age group and section. Empty until a junior organiser places them.';

create unique index if not exists junior_entries_draw_position_key
  on public.junior_entries (event_slug, age_category, draw, draw_position)
  where draw_position is not null;

grant select (draw_position) on table public.junior_entries to authenticated;

create or replace function public.junior_entries_clear_draw_place()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.age_category is distinct from old.age_category or new.draw is distinct from old.draw then
    new.draw_position := null;
  end if;
  return new;
end;
$$;

drop trigger if exists junior_entries_set_draw_place on public.junior_entries;
create trigger junior_entries_set_draw_place
  before update on public.junior_entries
  for each row
  execute function public.junior_entries_clear_draw_place();

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
    raise exception 'Only a junior organiser can place a player.' using errcode = '42501';
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
    raise exception 'Only a junior organiser can place a player.' using errcode = '42501';
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

revoke all on function public.place_junior_draw(bigint) from public, anon;
revoke all on function public.return_junior_draw(bigint) from public, anon;
grant execute on function public.place_junior_draw(bigint) to authenticated;
grant execute on function public.return_junior_draw(bigint) to authenticated;

notify pgrst, 'reload schema';
