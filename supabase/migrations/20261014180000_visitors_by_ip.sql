-- Visitors today share one line when they share an IP address.
-- A hit with no IP stays on its own browser session.


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
    'page_hits', coalesce((
      select json_agg(row_to_json(t) order by t.hits desc)
      from (
        select path,
               count(*)::int as hits,
               count(*) filter (where user_id is not null)::int as signed_in_hits
        from public.site_page_views
        where viewed_at >= now() - interval '30 days'
        group by path
        order by count(*) desc
        limit 40
      ) t
    ), '[]'::json),
    'visitors_today', coalesce((
      with today as (
        select v.*
        from public.site_page_views v
        where v.viewed_at >= (date_trunc('day', timezone('Europe/London', now())) at time zone 'Europe/London')
      ),
      grouped as (
        select
          coalesce(nullif(client_ip, ''), session_id::text) as visitor_key,
          count(*)::int as hits,
          count(distinct session_id)::int as sessions,
          max(viewed_at) as last_seen,
          (array_agg(user_id order by viewed_at desc) filter (where user_id is not null))[1] as user_id,
          (array_agg(client_ip order by viewed_at desc) filter (where nullif(client_ip, '') is not null))[1] as client_ip,
          (array_agg(user_agent order by viewed_at desc) filter (where nullif(user_agent, '') is not null))[1] as user_agent,
          (array_agg(referrer order by viewed_at asc) filter (where nullif(referrer, '') is not null))[1] as referrer,
          (array_agg(language order by viewed_at desc) filter (where nullif(language, '') is not null))[1] as language
        from today
        group by 1
      )
      select json_agg(row_to_json(q) order by q.last_seen desc)
      from (
        select
          coalesce(nullif(btrim(p.display_name), ''), case when g.user_id is null then 'Not signed in' else 'Signed-in user' end) as display_name,
          coalesce(p.email, '') as email,
          g.hits,
          g.sessions,
          coalesce((
            select json_agg(n.name order by n.name)
            from (
              select distinct coalesce(nullif(btrim(pr.display_name), ''), 'Signed-in user') as name
              from today t
              join public.profiles pr on pr.id = t.user_id
              where coalesce(nullif(t.client_ip, ''), t.session_id::text) = g.visitor_key
            ) n
          ), '[]'::json) as names,
          coalesce(g.client_ip, '') as client_ip,
          coalesce(g.user_agent, '') as user_agent,
          coalesce(g.referrer, '') as referrer,
          coalesce(g.language, '') as language,
          g.last_seen,
          coalesce((
            select json_agg(json_build_object('path', s.path, 'hits', s.hits) order by s.hits desc)
            from (
              select t.path, count(*)::int as hits
              from today t
              where coalesce(nullif(t.client_ip, ''), t.session_id::text) = g.visitor_key
              group by t.path
              order by count(*) desc
              limit 12
            ) s
          ), '[]'::json) as pages
        from grouped g
        left join public.profiles p on p.id = g.user_id
        order by g.last_seen desc
        limit 80
      ) q
    ), '[]'::json),
    'signed_in_views', coalesce((
      select json_agg(row_to_json(t) order by t.viewed_at desc)
      from (
        select v.viewed_at,
               v.path,
               coalesce(nullif(btrim(p.display_name), ''), 'Signed-in user') as display_name,
               coalesce(p.email, '') as email,
               coalesce(v.client_ip, '') as client_ip
        from public.site_page_views v
        left join public.profiles p on p.id = v.user_id
        where v.user_id is not null
          and v.viewed_at >= now() - interval '30 days'
        order by v.viewed_at desc
        limit 80
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
