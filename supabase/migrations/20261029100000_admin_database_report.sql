-- Admin-only snapshot of public tables: row counts, size on disk, newest stored time,
-- and weekly new rows for the tables that grow over time.

create or replace function public.admin_database_report()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  tables jsonb := '[]'::jsonb;
  growth jsonb := '[]'::jsonb;
  rel record;
  spec record;
  n bigint;
  time_col text;
  newest timestamptz;
  points jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  for rel in
    select c.relname as name, pg_total_relation_size(c.oid)::bigint as bytes
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind = 'r'
    order by c.relname
  loop
    execute format('select count(*) from public.%I', rel.name) into n;

    time_col := null;
    select a.attname::text into time_col
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    where ns.nspname = 'public'
      and c.relname = rel.name
      and a.attnum > 0
      and not a.attisdropped
      and t.typname in ('timestamptz', 'timestamp', 'date')
      and a.attname::text in (
        'created_at', 'viewed_at', 'signed_in_at', 'submitted_at',
        'recorded_on', 'published_at', 'updated_at', 'starts_at'
      )
    order by array_position(
      array[
        'created_at', 'viewed_at', 'signed_in_at', 'submitted_at',
        'recorded_on', 'published_at', 'updated_at', 'starts_at'
      ]::text[],
      a.attname::text
    )
    limit 1;

    newest := null;
    if time_col is not null then
      execute format('select max(%I)::timestamptz from public.%I', time_col, rel.name) into newest;
    end if;

    tables := tables || jsonb_build_array(jsonb_build_object(
      'name', rel.name,
      'rows', n,
      'bytes', rel.bytes,
      'newest', newest
    ));
  end loop;

  for spec in
    select *
    from (
      values
        ('site_page_views', 'viewed_at', 'Page views'),
        ('site_sign_ins', 'signed_in_at', 'Sign-ins'),
        ('profiles', 'created_at', 'Accounts'),
        ('contributions', 'created_at', 'Things sent in'),
        ('minigame_scores', 'created_at', 'Minigame scores'),
        ('junior_entries', 'created_at', 'Junior entries')
    ) as series(table_name, column_name, label)
  loop
    if not exists (
      select 1
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_type t on t.oid = a.atttypid
      where ns.nspname = 'public'
        and c.relname = spec.table_name
        and a.attname = spec.column_name
        and a.attnum > 0
        and not a.attisdropped
        and t.typname in ('timestamptz', 'timestamp', 'date')
    ) then
      continue;
    end if;

    execute format($sql$
      select coalesce(jsonb_agg(jsonb_build_object('week', week, 'n', n) order by week), '[]'::jsonb)
      from (
        select w.week::text as week, coalesce(c.n, 0)::int as n
        from (
          select gs::date as week
          from generate_series(
            date_trunc('week', (now() at time zone 'Europe/London') - interval '25 weeks')::date,
            date_trunc('week', (now() at time zone 'Europe/London'))::date,
            interval '1 week'
          ) as gs
        ) w
        left join (
          select date_trunc('week', (%1$I)::timestamptz at time zone 'Europe/London')::date as week,
                 count(*)::int as n
          from public.%2$I
          where (%1$I)::timestamptz >= now() - interval '26 weeks'
          group by 1
        ) c on c.week = w.week
      ) s
    $sql$, spec.column_name, spec.table_name) into points;

    growth := growth || jsonb_build_array(jsonb_build_object(
      'label', spec.label,
      'points', points
    ));
  end loop;

  -- Accounts opened on the site, when profiles has no created_at of its own.
  if not exists (
    select 1 from jsonb_array_elements(growth) elem where elem->>'label' = 'Accounts'
  ) then
    begin
      execute $sql$
        select coalesce(jsonb_agg(jsonb_build_object('week', week, 'n', n) order by week), '[]'::jsonb)
        from (
          select w.week::text as week, coalesce(c.n, 0)::int as n
          from (
            select gs::date as week
            from generate_series(
              date_trunc('week', (now() at time zone 'Europe/London') - interval '25 weeks')::date,
              date_trunc('week', (now() at time zone 'Europe/London'))::date,
              interval '1 week'
            ) as gs
          ) w
          left join (
            select date_trunc('week', created_at at time zone 'Europe/London')::date as week,
                   count(*)::int as n
            from auth.users
            where created_at >= now() - interval '26 weeks'
            group by 1
          ) c on c.week = w.week
        ) s
      $sql$ into points;
      growth := growth || jsonb_build_array(jsonb_build_object(
        'label', 'Accounts',
        'points', points
      ));
    exception
      when insufficient_privilege or undefined_table or undefined_column then
        null;
    end;
  end if;

  return json_build_object(
    'database_bytes', pg_database_size(current_database()),
    'tables', coalesce((
      select jsonb_agg(elem order by (elem->>'bytes')::bigint desc, elem->>'name')
      from jsonb_array_elements(tables) elem
    ), '[]'::jsonb),
    'series', growth
  );
end;
$$;

revoke all on function public.admin_database_report() from public;
grant execute on function public.admin_database_report() to authenticated;
