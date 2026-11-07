-- Admins choose which news articles appear on the front page.
-- A missing row means off. The Confirmed sponsors article starts on.

create table if not exists public.news_front (
  slug text primary key,
  on_front boolean not null,
  updated_at timestamptz not null default now(),
  constraint news_front_slug_check check (slug ~ '^[a-z0-9-]{8,120}$')
);

alter table public.news_front enable row level security;
revoke all on table public.news_front from public, anon, authenticated;

create or replace function public.news_front_page()
returns table (slug text, on_front boolean)
language sql
stable
security definer
set search_path = public
as $$
  select f.slug, f.on_front
  from public.news_front f;
$$;

revoke all on function public.news_front_page() from public;
grant execute on function public.news_front_page() to anon, authenticated;

create or replace function public.set_news_on_front(p_slug text, p_on boolean)
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
    raise exception 'That article is already gone.';
  end if;

  insert into public.news_front (slug, on_front, updated_at)
  values (v_slug, coalesce(p_on, false), now())
  on conflict (slug) do update
  set on_front = excluded.on_front,
      updated_at = now();
end;
$$;

revoke all on function public.set_news_on_front(text, boolean) from public, anon;
grant execute on function public.set_news_on_front(text, boolean) to authenticated;

insert into public.news_front (slug, on_front)
values ('2026-10-10-beds-closed-sponsors', true)
on conflict (slug) do update
set on_front = true,
    updated_at = now();
