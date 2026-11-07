-- Admins choose which events appear under Coming up.
-- A passed start date is stored as off. Future events start on.

create table if not exists public.event_front (
  slug text primary key,
  on_front boolean not null,
  updated_at timestamptz not null default now(),
  constraint event_front_slug_check check (slug ~ '^[a-z0-9-]{8,120}$')
);

alter table public.event_front enable row level security;
revoke all on table public.event_front from public, anon, authenticated;

create or replace function public.event_front_page()
returns table (slug text, on_front boolean)
language sql
stable
security definer
set search_path = public
as $$
  select f.slug, f.on_front
  from public.event_front f;
$$;

revoke all on function public.event_front_page() from public;
grant execute on function public.event_front_page() to anon, authenticated;

create or replace function public.set_event_on_front(p_slug text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only an admin can choose the front page.';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9-]{8,120}$' then
    raise exception 'That event is already gone.';
  end if;

  insert into public.event_front (slug, on_front, updated_at)
  values (v_slug, coalesce(p_on, false), now())
  on conflict (slug) do update
  set on_front = excluded.on_front,
      updated_at = now();
end;
$$;

revoke all on function public.set_event_on_front(text, boolean) from public, anon;
grant execute on function public.set_event_on_front(text, boolean) to authenticated;

insert into public.event_front (slug, on_front)
values
  ('2026-11-junior-county-closed', true),
  ('2027-01-beds-closed', true)
on conflict (slug) do nothing;
