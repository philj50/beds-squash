-- Anonymous page-view logging for admin dashboard (path + session id only).

create table public.site_page_views (
  id bigint generated always as identity primary key,
  viewed_at timestamptz not null default now(),
  path text not null,
  session_id uuid not null
);

create index site_page_views_viewed_at_idx on public.site_page_views (viewed_at desc);
create index site_page_views_path_idx on public.site_page_views (path);

alter table public.site_page_views enable row level security;

create policy "admins read page views"
  on public.site_page_views
  for select
  to authenticated
  using (is_admin());

create or replace function public.record_site_page_view(p_path text, p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_path is null or char_length(p_path) > 512 or p_session_id is null then
    return;
  end if;
  if p_path !~ '^/[a-zA-Z0-9/_.%-]*$' then
    return;
  end if;
  if exists (
    select 1
    from public.site_page_views v
    where v.session_id = p_session_id
      and v.path = p_path
      and v.viewed_at > now() - interval '30 minutes'
  ) then
    return;
  end if;
  insert into public.site_page_views (path, session_id)
  values (p_path, p_session_id);
end;
$$;

revoke all on function public.record_site_page_view(text, uuid) from public;
grant execute on function public.record_site_page_view(text, uuid) to anon, authenticated;

create or replace function public.get_site_traffic_stats()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select json_build_object(
    'total_7d', (select count(*)::int from public.site_page_views where viewed_at >= now() - interval '7 days'),
    'total_30d', (select count(*)::int from public.site_page_views where viewed_at >= now() - interval '30 days'),
    'sessions_7d', (select count(distinct session_id)::int from public.site_page_views where viewed_at >= now() - interval '7 days'),
    'sessions_30d', (select count(distinct session_id)::int from public.site_page_views where viewed_at >= now() - interval '30 days'),
    'by_day', coalesce((
      select json_agg(row_to_json(t) order by t.day desc)
      from (
        select (viewed_at at time zone 'Europe/London')::date as day,
               count(*)::int as page_views,
               count(distinct session_id)::int as sessions
        from public.site_page_views
        where viewed_at >= now() - interval '30 days'
        group by 1
        order by 1 desc
        limit 31
      ) t
    ), '[]'::json),
    'top_pages', coalesce((
      select json_agg(row_to_json(t) order by t.page_views desc)
      from (
        select path, count(*)::int as page_views
        from public.site_page_views
        where viewed_at >= now() - interval '30 days'
        group by path
        order by count(*) desc
        limit 20
      ) t
    ), '[]'::json)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_site_traffic_stats() from public;
grant execute on function public.get_site_traffic_stats() to authenticated;
