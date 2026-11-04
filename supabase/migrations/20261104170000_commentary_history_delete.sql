-- An admin can remove a finished match from commentary history.
-- Watchers and reactions go with it. A linked saved score stays, and is no longer visible.

create or replace function public.admin_delete_commentary_match(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  linked bigint;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can remove a commentary match.';
  end if;
  delete from public.commentary_matches
    where id = p_id
      and ended_at is not null
    returning marked_id into linked;
  if not found then
    raise exception 'That match is not in the history.';
  end if;
  if linked is not null then
    update public.marked_matches
      set public_visible = false
      where id = linked;
  end if;
end;
$$;

revoke all on function public.admin_delete_commentary_match(bigint) from public, anon;
grant execute on function public.admin_delete_commentary_match(bigint) to authenticated;

notify pgrst, 'reload schema';
