-- An admin can correct or remove any news article, not only a match report.
-- Readers apply the saved wording, and a deleted article leaves the site.

create table if not exists public.news_article_edits (
  slug text primary key,
  title text,
  summary text,
  body text,
  status text not null default 'edited',
  updated_at timestamptz not null default now(),
  constraint news_article_edits_status_check check (status in ('edited', 'deleted')),
  constraint news_article_edits_slug_check check (slug ~ '^[a-z0-9-]{8,120}$')
);

alter table public.news_article_edits enable row level security;
revoke all on table public.news_article_edits from public, anon, authenticated;

create or replace function public.news_article_edits()
returns table (slug text, title text, summary text, body text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select e.slug, e.title, e.summary, e.body, e.status
  from public.news_article_edits e;
$$;

revoke all on function public.news_article_edits() from public;
grant execute on function public.news_article_edits() to anon, authenticated;

create or replace function public.save_news_article(
  p_slug text,
  p_title text,
  p_summary text,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
  v_title text := nullif(regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g'), '');
  v_summary text := nullif(regexp_replace(btrim(coalesce(p_summary, '')), '\s+', ' ', 'g'), '');
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit an article.';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9-]{8,120}$' then
    raise exception 'That article is already gone.';
  end if;
  if v_title is null or char_length(v_title) < 4 or char_length(v_title) > 180 then
    raise exception 'Add a title of 4 to 180 characters.';
  end if;
  if v_summary is not null and char_length(v_summary) > 400 then
    raise exception 'Keep the summary to 400 characters.';
  end if;
  if v_body is null or char_length(v_body) < 20 or char_length(v_body) > 12000 then
    raise exception 'Write the article, between 20 and 12000 characters.';
  end if;

  insert into public.news_article_edits (slug, title, summary, body, status, updated_at)
  values (v_slug, v_title, v_summary, v_body, 'edited', now())
  on conflict (slug) do update
  set title = excluded.title,
      summary = excluded.summary,
      body = excluded.body,
      status = 'edited',
      updated_at = now();
end;
$$;

revoke all on function public.save_news_article(text, text, text, text) from public, anon;
grant execute on function public.save_news_article(text, text, text, text) to authenticated;

create or replace function public.delete_news_article(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change an article.';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9-]{8,120}$' then
    raise exception 'That article is already gone.';
  end if;

  insert into public.news_article_edits (slug, status, updated_at)
  values (v_slug, 'deleted', now())
  on conflict (slug) do update
  set status = 'deleted', updated_at = now();
end;
$$;

revoke all on function public.delete_news_article(text) from public, anon;
grant execute on function public.delete_news_article(text) to authenticated;
