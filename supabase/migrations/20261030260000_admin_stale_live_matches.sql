-- An admin can take a match off the court once an hour has passed with no score.
-- A match that is still being marked is left alone.

create or replace function public.admin_stale_live_matches()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can see matches in play.';
  end if;
  return (
    select coalesce(json_agg(row_to_json(rows) order by rows."updatedAt"), '[]'::json)
    from (
      select
        m.id,
        m.player_a as "playerA",
        m.player_b as "playerB",
        m.score,
        coalesce(nullif(btrim(p.display_name), ''), 'A marker') as marker,
        m.updated_at as "updatedAt"
      from public.live_matches m
      left join public.profiles p on p.id = m.marker_id
      where m.updated_at < now() - interval '1 hour'
      order by m.updated_at
    ) rows
  );
end;
$$;

revoke all on function public.admin_stale_live_matches() from public;
grant execute on function public.admin_stale_live_matches() to authenticated;

create or replace function public.admin_clear_stale_live_match(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can clear a match in play.';
  end if;
  delete from public.live_matches
  where id = p_id
    and updated_at < now() - interval '1 hour';
  if not found then
    raise exception 'That match is still being marked, or it has already been cleared.';
  end if;
end;
$$;

revoke all on function public.admin_clear_stale_live_match(bigint) from public;
grant execute on function public.admin_clear_stale_live_match(bigint) to authenticated;

create or replace function public.admin_clear_stale_live_matches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can clear a match in play.';
  end if;
  delete from public.live_matches
  where updated_at < now() - interval '1 hour';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.admin_clear_stale_live_matches() from public;
grant execute on function public.admin_clear_stale_live_matches() to authenticated;
