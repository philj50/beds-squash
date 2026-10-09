-- A page view keeps the signed-in person when the browser sends their login.
-- Visits with no login stay anonymous.

alter table public.site_page_views
  add column if not exists user_id uuid;

create index if not exists site_page_views_user_id_idx
  on public.site_page_views (user_id, viewed_at desc);

create or replace function public.record_site_page_view(p_path text, p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
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
      and v.user_id is not distinct from v_user
  ) then
    return;
  end if;
  if v_user is not null then
    update public.site_page_views v
      set user_id = v_user
      where v.session_id = p_session_id
        and v.path = p_path
        and v.user_id is null
        and v.viewed_at > now() - interval '30 minutes';
    if found then
      return;
    end if;
  end if;
  insert into public.site_page_views (path, session_id, user_id)
  values (p_path, p_session_id, v_user);
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
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select json_build_object(
    'total_7d', (select count(*)::int from public.site_page_views where viewed_at >= now() - interval '7 days'),
    'total_30d', (select count(*)::int from public.site_page_views where viewed_at >= now() - interval '30 days'),
    'sessions_7d', (select count(distinct session_id)::int from public.site_page_views where viewed_at >= now() - interval '7 days'),
    'sessions_30d', (select count(distinct session_id)::int from public.site_page_views where viewed_at >= now() - interval '30 days'),
    'sign_ins_7d', (select count(*)::int from public.site_sign_ins where signed_in_at >= now() - interval '7 days'),
    'sign_ins_30d', (select count(*)::int from public.site_sign_ins where signed_in_at >= now() - interval '30 days'),
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
    ), '[]'::json),
    'signed_in_views', coalesce((
      select json_agg(row_to_json(t) order by t.viewed_at desc)
      from (
        select v.viewed_at,
               v.path,
               coalesce(nullif(btrim(p.display_name), ''), 'Signed-in user') as display_name,
               coalesce(p.email, '') as email
        from public.site_page_views v
        left join public.profiles p on p.id = v.user_id
        where v.user_id is not null
          and v.viewed_at >= now() - interval '30 days'
        order by v.viewed_at desc
        limit 40
      ) t
    ), '[]'::json),
    'recent_sign_ins', coalesce((
      select json_agg(row_to_json(t) order by t.signed_in_at desc)
      from (
        select s.signed_in_at,
               coalesce(p.display_name, 'Unknown') as display_name,
               coalesce(p.email, '') as email
        from public.site_sign_ins s
        left join public.profiles p on p.id = s.user_id
        where s.signed_in_at >= now() - interval '30 days'
        order by s.signed_in_at desc
        limit 40
      ) t
    ), '[]'::json)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_site_traffic_stats() from public;
grant execute on function public.get_site_traffic_stats() to authenticated;
