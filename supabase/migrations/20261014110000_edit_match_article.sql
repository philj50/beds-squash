-- An admin can correct a match article. Readers see the saved title, summary and text.

create or replace function public.edit_match_article(
  p_id bigint,
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
  v_title text := nullif(regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g'), '');
  v_summary text := nullif(regexp_replace(btrim(coalesce(p_summary, '')), '\s+', ' ', 'g'), '');
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit an article.';
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

  if not exists (select 1 from public.match_articles where id = p_id) then
    raise exception 'That article is already gone.';
  end if;

  update public.match_articles
  set title = v_title, summary = v_summary, body = v_body
  where id = p_id;
end;
$$;

revoke all on function public.edit_match_article(bigint, text, text, text) from public, anon;
grant execute on function public.edit_match_article(bigint, text, text, text) to authenticated;

create or replace function public.published_match_articles()
returns table (slug text, title text, summary text, body text)
language sql
stable
security definer
set search_path = public
as $$
  select m.slug, m.title, m.summary, m.body
  from public.match_articles m
  where m.status = 'published'
    and nullif(btrim(m.slug), '') is not null
    and nullif(btrim(m.title), '') is not null
    and nullif(btrim(m.body), '') is not null;
$$;

revoke all on function public.published_match_articles() from public;
grant execute on function public.published_match_articles() to anon, authenticated;
