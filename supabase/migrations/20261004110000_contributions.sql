-- Photos, videos, links and articles sent in from the Share page.
-- They stay pending until an admin publishes them. Nothing is published automatically.
-- Video files are limited to 10 MB. Photos are limited to 8 MB.

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('photo', 'video', 'link', 'article')),
  credit text not null check (char_length(credit) between 2 and 80),
  credit_key text not null,
  title text,
  caption text,
  body text,
  storage_path text,
  url text,
  status text not null default 'pending' check (status in ('pending', 'published')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint contributions_shape check (
    (kind = 'photo' and storage_path is not null and url is null and title is null and body is null and caption is not null)
    or (kind = 'video' and storage_path is not null and url is null and title is null and body is null and caption is not null)
    or (kind = 'link' and url is not null and storage_path is null and body is null and title is not null)
    or (kind = 'article' and title is not null and body is not null and storage_path is null and url is null)
  )
);

create index contributions_status_created_idx on public.contributions (status, created_at desc);
create index contributions_published_credit_idx on public.contributions (credit_key) where status = 'published';

alter table public.contributions enable row level security;

create policy "read published contributions"
  on public.contributions
  for select
  to anon, authenticated
  using (status = 'published' or (auth.uid() is not null and public.is_admin()));

revoke all on public.contributions from anon, authenticated;
grant select on public.contributions to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contributions',
  'contributions',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
);

create policy "contributions upload incoming file"
  on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'contributions'
    and name ~ '^incoming/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$'
  );

create policy "contributions read published or admin"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'contributions'
    and (
      (auth.uid() is not null and public.is_admin())
      or exists (
        select 1
        from public.contributions item
        where item.storage_path = name
          and item.status = 'published'
      )
    )
  );

create policy "contributions admin delete"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'contributions' and public.is_admin());

create or replace function public.contribution_link_ok(p_url text)
returns boolean
language sql
immutable
as $$
  select p_url ~ '^https://[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([/?#][^\s<>]*)?$'
    and char_length(p_url) between 12 and 500
    and p_url !~* '^https://(localhost|127\.0\.0\.1)([/:?#]|$)';
$$;

revoke all on function public.contribution_link_ok(text) from public;

create or replace function public.contribution_clean(
  p_kind text,
  p_credit text,
  p_caption text,
  p_title text,
  p_body text,
  p_storage_path text,
  p_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_credit text := nullif(regexp_replace(btrim(coalesce(p_credit, '')), '\s+', ' ', 'g'), '');
  v_caption text := nullif(regexp_replace(btrim(coalesce(p_caption, '')), '\s+', ' ', 'g'), '');
  v_title text := nullif(regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g'), '');
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if v_credit is null or char_length(v_credit) > 80 then
    raise exception 'Add your name, up to 80 characters.';
  end if;
  if v_kind not in ('photo', 'video', 'link', 'article') then
    raise exception 'Choose a photo, video, link or article.';
  end if;

  if v_kind in ('photo', 'video') then
    if v_url is not null or v_title is not null or v_body is not null then
      raise exception 'Send the file on its own.';
    end if;
    if v_caption is null or char_length(v_caption) > 200 then
      raise exception 'Add a caption of up to 200 characters.';
    end if;
    if v_kind = 'photo' and v_path !~ '^incoming/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif)$' then
      raise exception 'That photo cannot be accepted.';
    end if;
    if v_kind = 'video' and v_path !~ '^incoming/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm|mov)$' then
      raise exception 'That video cannot be accepted.';
    end if;
    if exists (select 1 from public.contributions where storage_path = v_path) then
      raise exception 'That file is already in the queue.';
    end if;
  elsif v_kind = 'link' then
    if v_path is not null or v_body is not null then
      raise exception 'Send the link on its own.';
    end if;
    if v_title is null or char_length(v_title) > 140 then
      raise exception 'Add a title of up to 140 characters.';
    end if;
    if v_caption is not null and char_length(v_caption) > 200 then
      raise exception 'Keep the note to 200 characters.';
    end if;
    if v_url is null or not public.contribution_link_ok(v_url) then
      raise exception 'Use an https link.';
    end if;
  else
    if v_path is not null or v_url is not null then
      raise exception 'Send the article as text.';
    end if;
    if v_title is null or char_length(v_title) < 4 or char_length(v_title) > 140 then
      raise exception 'Add a title of 4 to 140 characters.';
    end if;
    if v_caption is not null and char_length(v_caption) > 280 then
      raise exception 'Keep the summary to 280 characters.';
    end if;
    if v_body is null or char_length(v_body) < 40 or char_length(v_body) > 8000 then
      raise exception 'Write the article, between 40 and 8000 characters.';
    end if;
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'credit', v_credit,
    'credit_key', lower(v_credit),
    'caption', v_caption,
    'title', v_title,
    'body', v_body,
    'storage_path', v_path,
    'url', v_url
  );
end;
$$;

revoke all on function public.contribution_clean(text, text, text, text, text, text, text) from public;

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

revoke all on function public.submit_contribution(text, text, text, text, text, text, text) from public;
grant execute on function public.submit_contribution(text, text, text, text, text, text, text) to anon, authenticated;

create or replace function public.add_contribution(
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
  if not public.is_admin() then
    raise exception 'Only an admin can add to the site.';
  end if;
  v_clean := public.contribution_clean(p_kind, p_credit, p_caption, p_title, p_body, p_storage_path, p_url);
  insert into public.contributions (kind, credit, credit_key, title, caption, body, storage_path, url, status, published_at)
  values (
    v_clean->>'kind',
    v_clean->>'credit',
    v_clean->>'credit_key',
    v_clean->>'title',
    v_clean->>'caption',
    v_clean->>'body',
    v_clean->>'storage_path',
    v_clean->>'url',
    'published',
    now()
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.add_contribution(text, text, text, text, text, text, text) from public;
grant execute on function public.add_contribution(text, text, text, text, text, text, text) to authenticated;

create or replace function public.publish_contribution(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can publish.';
  end if;
  update public.contributions
  set status = 'published', published_at = coalesce(published_at, now())
  where id = p_id and status = 'pending';
  if not found then
    raise exception 'That item is not waiting to be published.';
  end if;
end;
$$;

revoke all on function public.publish_contribution(uuid) from public;
grant execute on function public.publish_contribution(uuid) to authenticated;

create or replace function public.delete_contribution(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can remove items.';
  end if;
  select storage_path into v_path from public.contributions where id = p_id;
  if not found then
    raise exception 'That item is already gone.';
  end if;
  delete from public.contributions where id = p_id;
  return v_path;
end;
$$;

revoke all on function public.delete_contribution(uuid) from public;
grant execute on function public.delete_contribution(uuid) to authenticated;

create or replace function public.contribution_leaderboard()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(ranked)), '[]'::json)
  from (
    select
      (array_agg(credit order by published_at desc nulls last))[1] as credit,
      count(*) filter (where kind = 'photo')::int as photos,
      count(*) filter (where kind = 'video')::int as videos,
      count(*) filter (where kind = 'link')::int as links,
      count(*) filter (where kind = 'article')::int as articles,
      count(*)::int as total
    from public.contributions
    where status = 'published'
    group by credit_key
    order by count(*) desc, min(credit)
    limit 20
  ) ranked;
$$;

revoke all on function public.contribution_leaderboard() from public;
grant execute on function public.contribution_leaderboard() to anon, authenticated;
