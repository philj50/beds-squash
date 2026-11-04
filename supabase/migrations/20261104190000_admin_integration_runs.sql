-- Last stored run for each outside service. Only an admin can read it.

create or replace function public.admin_integration_runs()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce(
    (
      select json_agg(json_build_object(
        'source', source,
        'ranAt', ran_at,
        'summary', summary
      ) order by source, ran_at desc)
      from (
        select source, ran_at, summary
        from (
          select
            source,
            ran_at,
            summary,
            row_number() over (partition by source order by ran_at desc) as n
          from public.import_runs
        ) ranked
        where n <= 3
      ) recent
    ),
    '[]'::json
  );
end;
$$;

revoke all on function public.admin_integration_runs() from public, anon;
grant execute on function public.admin_integration_runs() to authenticated;

notify pgrst, 'reload schema';
