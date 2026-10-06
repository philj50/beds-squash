-- Remember who sent each contribution, so their own page can list it,
-- including items that are still waiting to be published.

alter table public.contributions
  add column if not exists submitted_by uuid references public.profiles (id) on delete set null;

create index if not exists contributions_submitted_by_idx
  on public.contributions (submitted_by, created_at desc);

drop policy if exists "read own contributions" on public.contributions;
create policy "read own contributions"
  on public.contributions
  for select
  to authenticated
  using (submitted_by = auth.uid());

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
