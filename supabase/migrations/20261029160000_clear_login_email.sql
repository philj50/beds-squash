-- An admin can clear the email on a login. The address is taken off the
-- player record. League Master is not copied back onto a field that was cleared.

create or replace function public.clear_login_email(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_email text;
  cleared text := 'cleared.' || p_user_id::text || '@players.invalid';
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only an admin can do that.' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.profiles
    where id = p_user_id
      and lower(coalesce(email, '')) = 'county-admin@players.invalid'
  ) then
    raise exception 'The county admin email stays as it is.';
  end if;

  select email into old_email from auth.users where id = p_user_id;
  update public.profiles set email = null where id = p_user_id;

  if old_email is not null then
    update auth.users
    set email = cleared
    where id = p_user_id;
    update auth.identities
    set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb(cleared), true),
        provider_id = case when lower(provider_id) = lower(old_email) then cleared else provider_id end
    where user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.clear_login_email(uuid) from public, anon;
grant execute on function public.clear_login_email(uuid) to authenticated;
