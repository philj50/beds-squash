-- A hit also keeps the browser, the language, and the page that sent the visitor.

alter table public.site_page_views
  add column if not exists user_agent text,
  add column if not exists referrer text,
  add column if not exists language text;

drop function if exists public.record_site_page_view(text, uuid);

create or replace function public.record_site_page_view(
  p_path text,
  p_session_id uuid,
  p_referrer text default null,
  p_language text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_headers json;
  v_forwarded text;
  v_ip text;
  v_agent text;
  v_ref text;
  v_lang text;
  v_existing bigint;
begin
  if p_path is null or char_length(p_path) > 512 or p_session_id is null then
    return;
  end if;
  if p_path !~ '^/[a-zA-Z0-9/_.%-]*$' then
    return;
  end if;

  begin
    v_headers := current_setting('request.headers', true)::json;
  exception
    when others then
      v_headers := null;
  end;
  if v_headers is not null then
    v_forwarded := coalesce(v_headers->>'x-forwarded-for', v_headers->>'x-real-ip', v_headers->>'cf-connecting-ip');
    v_agent := nullif(left(regexp_replace(coalesce(v_headers->>'user-agent', ''), '[[:cntrl:]]', '', 'g'), 240), '');
  end if;
  v_ip := nullif(left(btrim(split_part(coalesce(v_forwarded, ''), ',', 1)), 64), '');
  if v_ip is not null and v_ip !~ '^([0-9]{1,3}\.){3}[0-9]{1,3}$' and v_ip !~ '^[0-9A-Fa-f:.]+$' then
    v_ip := null;
  end if;
  v_ref := nullif(left(btrim(coalesce(p_referrer, '')), 300), '');
  if v_ref is not null and v_ref !~ '^https?://' then
    v_ref := null;
  end if;
  v_lang := nullif(left(btrim(coalesce(p_language, '')), 16), '');
  if v_lang is not null and v_lang !~ '^[A-Za-z]{2}([_-][A-Za-z0-9]{1,8})?$' then
    v_lang := null;
  end if;

  select v.id
    into v_existing
    from public.site_page_views v
    where v.session_id = p_session_id
      and v.path = p_path
      and v.viewed_at > now() - interval '15 seconds'
    order by v.viewed_at desc
    limit 1;

  if v_existing is not null then
    update public.site_page_views
      set user_id = coalesce(user_id, v_user),
          client_ip = coalesce(client_ip, v_ip),
          user_agent = coalesce(user_agent, v_agent),
          referrer = coalesce(referrer, v_ref),
          language = coalesce(language, v_lang)
      where id = v_existing
        and (v_user is not null or v_ip is not null or v_agent is not null or v_ref is not null or v_lang is not null);
    return;
  end if;

  insert into public.site_page_views (path, session_id, user_id, client_ip, user_agent, referrer, language)
  values (p_path, p_session_id, v_user, v_ip, v_agent, v_ref, v_lang);
end;
$$;

revoke all on function public.record_site_page_view(text, uuid, text, text) from public;
grant execute on function public.record_site_page_view(text, uuid, text, text) to anon, authenticated;

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
          session_id,
          count(*)::int as hits,
          max(viewed_at) as last_seen,
          (array_agg(user_id order by viewed_at desc) filter (where user_id is not null))[1] as user_id,
          (array_agg(client_ip order by viewed_at desc) filter (where nullif(client_ip, '') is not null))[1] as client_ip,
          (array_agg(user_agent order by viewed_at desc) filter (where nullif(user_agent, '') is not null))[1] as user_agent,
          (array_agg(referrer order by viewed_at asc) filter (where nullif(referrer, '') is not null))[1] as referrer,
          (array_agg(language order by viewed_at desc) filter (where nullif(language, '') is not null))[1] as language
        from today
        group by session_id
      )
      select json_agg(row_to_json(q) order by q.last_seen desc)
      from (
        select
          coalesce(nullif(btrim(p.display_name), ''), case when g.user_id is null then 'Not signed in' else 'Signed-in user' end) as display_name,
          coalesce(p.email, '') as email,
          g.hits,
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
              where t.session_id = g.session_id
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
