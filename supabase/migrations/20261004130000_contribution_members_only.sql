-- Only a signed-in player, team captain, club captain or admin can send content.
-- Publishing stays manual, and the public site can still read what an admin has published.

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
  v_clean jsonb;
  v_id uuid;
begin
  if not public.can_contribute() then
    raise exception 'Sign in as a player, captain or admin to send something in.';
  end if;
  v_clean := public.contribution_clean(p_kind, p_credit, p_caption, p_title, p_body, p_storage_path, p_url);
  insert into public.contributions (kind, credit, credit_key, title, caption, body, storage_path, url, status)
  values (
    v_clean->>'kind',
    v_clean->>'credit',
    v_clean->>'credit_key',
    v_clean->>'title',
    v_clean->>'caption',
    v_clean->>'body',
    v_clean->>'storage_path',
    v_clean->>'url',
    'pending'
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_contribution(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_contribution(text, text, text, text, text, text, text) to authenticated;

drop policy if exists "contributions upload incoming file" on storage.objects;
create policy "contributions upload incoming file"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'contributions'
    and public.can_contribute()
    and name ~ '^incoming/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$'
  );
