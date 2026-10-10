-- Turn a login on or off from Users. The live account function does not know this action yet.

create or replace function public.set_account_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only an admin can do that.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and p_active is not true then
    raise exception 'You cannot turn off your own account.';
  end if;
  if exists (
    select 1
    from public.profiles
    where id = p_user_id
      and lower(coalesce(email, '')) = 'county-admin@players.invalid'
  ) then
    raise exception 'The county admin stays active.';
  end if;
  update auth.users
  set banned_until = case when p_active then null else now() + interval '100 years' end
  where id = p_user_id;
  if not found then
    raise exception 'Choose an account.';
  end if;
end;
$$;

revoke all on function public.set_account_active(uuid, boolean) from public, anon;
grant execute on function public.set_account_active(uuid, boolean) to authenticated;
