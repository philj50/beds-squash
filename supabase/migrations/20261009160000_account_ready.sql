-- Signed-in pages record activity, and private work needs an active account with an email.

create table if not exists public.site_sign_ins (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  signed_in_at timestamptz not null default now()
);

create index if not exists site_sign_ins_signed_in_at_idx on public.site_sign_ins (signed_in_at desc);
create index if not exists site_sign_ins_user_id_idx on public.site_sign_ins (user_id);

alter table public.site_sign_ins enable row level security;

drop policy if exists "admins read sign ins" on public.site_sign_ins;
create policy "admins read sign ins"
  on public.site_sign_ins
  for select
  to authenticated
  using (public.is_admin());

-- Called from the login page and from each signed-in page.
-- A person who stays logged in still gets a fresh time when they come back.
create or replace function public.record_my_sign_in()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if exists (
    select 1
    from public.site_sign_ins s
    where s.user_id = auth.uid()
      and s.signed_in_at > now() - interval '2 minutes'
  ) then
    return;
  end if;
  insert into public.site_sign_ins (user_id)
  values (auth.uid());
end;
$$;

revoke all on function public.record_my_sign_in() from public;
grant execute on function public.record_my_sign_in() to authenticated;

create or replace function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;

create or replace function public.account_has_email()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.email is not null
      and u.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and u.email !~* '^p-[a-z0-9]+@players\.invalid$'
  );
$$;

create or replace function public.my_account_status()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'active', public.account_is_active(),
    'has_email', public.account_has_email()
  );
$$;

revoke all on function public.account_is_active() from public, anon;
revoke all on function public.account_has_email() from public, anon;
revoke all on function public.my_account_status() from public, anon;
grant execute on function public.account_is_active() to authenticated;
grant execute on function public.account_has_email() to authenticated;
grant execute on function public.my_account_status() to authenticated;

create or replace function public.can_contribute()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_is_active()
    and public.account_has_email()
    and auth.uid() is not null
    and (
      public.is_admin()
      or exists (
        select 1
        from public.memberships
        where profile_id = auth.uid()
          and role in ('club_captain', 'team_captain', 'team_player')
      )
      or exists (
        select 1
        from public.group_members
        where profile_id = auth.uid()
      )
    );
$$;

revoke all on function public.can_contribute() from public, anon;
grant execute on function public.can_contribute() to authenticated;

create or replace function public.submit_contribution(
  p_kind text,
  p_credit text,
  p_caption text,
  p_title text,
  p_body text,
  p_storage_path text,
  p_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_clean jsonb;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in as a player, captain or admin to send something in.';
  end if;
  if not public.account_is_active() then
    raise exception 'This account is inactive.';
  end if;
  if not public.account_has_email() then
    raise exception 'This account needs an email address.';
  end if;
  if not public.can_contribute() then
    raise exception 'Sign in as a player, captain or admin to send something in.';
  end if;
  v_name := public.contribution_sender_name();
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'Add your name on your profile before sending something in.';
  end if;
  v_clean := public.contribution_clean(p_kind, v_name, p_caption, p_title, p_body, p_storage_path, p_url);
  insert into public.contributions (
    kind, credit, credit_key, title, caption, body, storage_path, url, status, submitted_by
  )
  values (
    v_clean->>'kind',
    v_clean->>'credit',
    v_clean->>'credit_key',
    v_clean->>'title',
    v_clean->>'caption',
    v_clean->>'body',
    v_clean->>'storage_path',
    v_clean->>'url',
    'pending',
    auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_contribution(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_contribution(text, text, text, text, text, text, text) to authenticated;

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
  if not public.account_is_active() then
    raise exception 'This account is inactive.';
  end if;
  if clean is null or char_length(clean) < 2 or char_length(clean) > 80 then
    raise exception 'Enter a name between 2 and 80 characters.';
  end if;
  update public.profiles
    set display_name = clean
    where id = auth.uid();
end;
$$;

revoke all on function public.set_my_display_name(text) from public, anon;
grant execute on function public.set_my_display_name(text) to authenticated;

drop policy if exists "player adds own availability" on public.availability;
create policy "player adds own availability"
  on public.availability
  for insert
  to authenticated
  with check (
    public.account_is_active()
    and public.account_has_email()
    and squad_player_id in (select public.own_squad_player_ids())
  );

drop policy if exists "player updates own availability" on public.availability;
create policy "player updates own availability"
  on public.availability
  for update
  to authenticated
  using (
    public.account_is_active()
    and public.account_has_email()
    and squad_player_id in (select public.own_squad_player_ids())
  )
  with check (
    public.account_is_active()
    and public.account_has_email()
    and squad_player_id in (select public.own_squad_player_ids())
  );

drop policy if exists "player clears own availability" on public.availability;
create policy "player clears own availability"
  on public.availability
  for delete
  to authenticated
  using (
    public.account_is_active()
    and public.account_has_email()
    and squad_player_id in (select public.own_squad_player_ids())
  );
