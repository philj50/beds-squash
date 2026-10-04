-- Named sign-ins for the admin traffic page. Page views stay anonymous.

create table public.site_sign_ins (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  signed_in_at timestamptz not null default now()
);

create index site_sign_ins_signed_in_at_idx on public.site_sign_ins (signed_in_at desc);
create index site_sign_ins_user_id_idx on public.site_sign_ins (user_id);

alter table public.site_sign_ins enable row level security;

create policy "admins read sign ins"
  on public.site_sign_ins
  for select
  to authenticated
  using (is_admin());

create or replace function public.record_my_sign_in()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if exists (
    select 1
    from public.site_sign_ins s
    where s.user_id = auth.uid()
      and s.signed_in_at > now() - interval '2 minutes'
  ) then
    return;
  end if;
  insert into public.site_sign_ins (user_id)
  values (auth.uid());
end;
$$;

revoke all on function public.record_my_sign_in() from public;
grant execute on function public.record_my_sign_in() to authenticated;

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
