-- Only an admin can take a name off the minigame board.

create or replace function public.delete_minigame_score(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can remove a score.';
  end if;
  delete from public.minigame_scores where id = p_id;
  if not found then
    raise exception 'That score is already gone.';
  end if;
end;
$$;

revoke all on function public.delete_minigame_score(bigint) from public, anon;
grant execute on function public.delete_minigame_score(bigint) to authenticated;
