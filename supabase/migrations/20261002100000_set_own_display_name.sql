-- A signed-in person can change the name on their own profile.
-- Other columns, including is_admin, stay as they are.

create or replace function public.set_my_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := trim(p_name);
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if clean is null or char_length(clean) < 2 or char_length(clean) > 80 then
    raise exception 'Enter a name between 2 and 80 characters.';
  end if;
  update public.profiles
    set display_name = clean
    where id = auth.uid();
end;
$$;

revoke all on function public.set_my_display_name(text) from public;
grant execute on function public.set_my_display_name(text) to authenticated;
