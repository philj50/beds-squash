-- People who are not signed in can watch a live score, but only as a
-- first name and a surname initial. Signed-in viewers get the full names,
-- the marker, and the point-by-point score.

create or replace function public.public_player_name(full_name text)
returns text
language plpgsql
immutable
as $$
declare
  cleaned text := regexp_replace(btrim(coalesce(full_name, '')), '\s+', ' ', 'g');
  first_name text;
  last_name text;
begin
  if cleaned = '' then
    return '';
  end if;
  first_name := split_part(cleaned, ' ', 1);
  if position(' ' in cleaned) = 0 then
    return first_name;
  end if;
  last_name := regexp_replace(cleaned, '^.* ', '');
  return first_name || ' ' || upper(left(last_name, 1));
end;
$$;

revoke all on function public.public_player_name(text) from public;
revoke all on function public.public_player_name(text) from anon, authenticated;

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
    where m.updated_at > now() - interval '3 hours'
    order by m.updated_at desc
    limit 12
  ) rows;
$$;

revoke all on function public.current_matches() from public;
grant execute on function public.current_matches() to anon, authenticated;
