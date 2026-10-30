-- A marker can remove the matches they saved. The score page lists only those.
-- An admin still removes any match with admin_delete_marked_match.

create or replace function public.marked_matches()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(rows)), '[]'::json)
  from (
    select
      m.id,
      m.player_a as "playerA",
      m.player_b as "playerB",
      m.winner,
      m.score,
      coalesce(nullif(btrim(p.display_name), ''), 'Player') as marker,
      m.created_at as "createdAt"
    from public.marked_matches m
    left join public.profiles p on p.id = m.marker_id
    where m.marker_id = auth.uid()
    order by m.created_at desc
    limit 30
  ) rows;
$$;

revoke all on function public.marked_matches() from public, anon;
grant execute on function public.marked_matches() to authenticated;

create or replace function public.delete_marked_match(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to remove a score.';
  end if;
  delete from public.marked_matches
  where id = p_id
    and marker_id = auth.uid();
  get diagnostics removed = row_count;
  if removed = 0 then
    raise exception 'That match is not yours.';
  end if;
end;
$$;

revoke all on function public.delete_marked_match(bigint) from public, anon;
grant execute on function public.delete_marked_match(bigint) to authenticated;

create or replace function public.clear_marked_matches()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to remove a score.';
  end if;
  delete from public.marked_matches where marker_id = auth.uid();
end;
$$;

revoke all on function public.clear_marked_matches() from public, anon;
grant execute on function public.clear_marked_matches() to authenticated;
