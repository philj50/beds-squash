-- A contribution belongs to the signed-in account. The name is taken from
-- that account, and the public cannot send one in.

alter table public.contributions
  add column if not exists submitted_by uuid references public.profiles (id) on delete set null;

create index if not exists contributions_submitted_by_idx
  on public.contributions (submitted_by, created_at desc);

create or replace function public.can_contribute()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
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

create or replace function public.contribution_sender_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select btrim(gm.person_name)
      from public.group_members gm
      where gm.profile_id = auth.uid()
        and gm.group_slug in ('lm_players', 'lm_team_captains', 'lm_club_captains')
        and nullif(btrim(gm.person_name), '') is not null
      order by case gm.group_slug
        when 'lm_players' then 1
        when 'lm_team_captains' then 2
        else 3
      end
      limit 1
    ),
    (
      select nullif(btrim(p.display_name), '')
      from public.profiles p
      where p.id = auth.uid()
    )
  );
$$;

revoke all on function public.contribution_sender_name() from public, anon;
grant execute on function public.contribution_sender_name() to authenticated;

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
