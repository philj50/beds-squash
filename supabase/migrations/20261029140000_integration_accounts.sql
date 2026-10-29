-- Account names for outside services. Passwords stay in GitHub.
-- Only an admin can read the names, through admin_integration_accounts().

create table if not exists public.integration_accounts (
  slug text primary key,
  account text not null,
  updated_at timestamptz not null default now()
);

comment on table public.integration_accounts is
  'Sign-in name or pub/sub topic for an outside service. The password is not stored here.';

alter table public.integration_accounts enable row level security;

revoke all on table public.integration_accounts from public, anon, authenticated;

create or replace function public.admin_integration_accounts()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce(
    (
      select json_agg(json_build_object('slug', slug, 'account', account) order by slug)
      from public.integration_accounts
    ),
    '[]'::json
  );
end;
$$;

revoke all on function public.admin_integration_accounts() from public;
grant execute on function public.admin_integration_accounts() to authenticated;
