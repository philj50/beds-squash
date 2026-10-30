-- A live match leaves the list an hour after the last score.

create or replace function public.current_matches()
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
      case
        when auth.uid() is null then public.public_player_name(m.player_a)
        else m.player_a
      end as "playerA",
      case
        when auth.uid() is null then public.public_player_name(m.player_b)
        else m.player_b
      end as "playerB",
      m.score,
      case when auth.uid() is null then null else m.history end as history,
      case
        when auth.uid() is null then null
        else coalesce(nullif(btrim(p.display_name), ''), 'A marker')
      end as marker,
      m.updated_at as "updatedAt"
    from public.live_matches m
    left join public.profiles p on p.id = m.marker_id
    where m.updated_at > now() - interval '1 hour'
    order by m.updated_at desc
    limit 12
  ) rows;
$$;

revoke all on function public.current_matches() from public;
grant execute on function public.current_matches() to anon, authenticated;
