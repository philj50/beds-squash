-- Membership of the Admins group is enough, alongside the profile flag and an admin membership.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select p.is_admin
      from public.profiles p
      where p.id = auth.uid()
    ), false)
    or exists (
      select 1
      from public.memberships m
      where m.profile_id = auth.uid()
        and m.role = 'admin'
    )
    or exists (
      select 1
      from public.group_members g
      where g.profile_id = auth.uid()
        and g.group_slug = 'admins'
    );
$$;
