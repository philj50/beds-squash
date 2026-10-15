-- An admin can take a match article off the home page, or off the site.
-- Archived articles stay in the news list. Deleted articles stay in the admin list.

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'match_articles'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.match_articles drop constraint %I', v_name);
  end loop;
end $$;

alter table public.match_articles
  add constraint match_articles_status_check
  check (status in ('held', 'approved', 'published', 'archived', 'deleted'));

create or replace function public.set_match_article_place(p_id bigint, p_place text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change an article.';
  end if;
  if p_place not in ('home', 'archive', 'delete') then
    raise exception 'Choose home, archive, or delete.';
  end if;

  select status into v_status from public.match_articles where id = p_id;
  if not found then
    raise exception 'That article is already gone.';
  end if;

  if p_place = 'home' and v_status <> 'archived' then
    raise exception 'Only an archived article can go back on the home page.';
  end if;
  if p_place = 'archive' and v_status <> 'published' then
    raise exception 'Only an article on the site can be archived.';
  end if;
  if p_place = 'delete' and v_status = 'deleted' then
    raise exception 'That article is already deleted.';
  end if;

  update public.match_articles
  set status = case p_place
    when 'home' then 'published'
    when 'archive' then 'archived'
    else 'deleted'
  end
  where id = p_id;
end;
$$;

revoke all on function public.set_match_article_place(bigint, text) from public, anon;
grant execute on function public.set_match_article_place(bigint, text) to authenticated;

create or replace function public.match_article_places()
returns table (slug text, place text)
language sql
stable
security definer
set search_path = public
as $$
  select m.slug,
    case m.status
      when 'archived' then 'history'
      when 'deleted' then 'gone'
      else 'home'
    end
  from public.match_articles m
  where m.status in ('published', 'archived', 'deleted')
    and nullif(btrim(m.slug), '') is not null;
$$;

revoke all on function public.match_article_places() from public;
grant execute on function public.match_article_places() to anon, authenticated;

create or replace function public.published_match_articles()
returns table (slug text, title text, summary text, body text)
language sql
stable
security definer
set search_path = public
as $$
  select m.slug, m.title, m.summary, m.body
  from public.match_articles m
  where m.status in ('published', 'archived')
    and nullif(btrim(m.slug), '') is not null
    and nullif(btrim(m.title), '') is not null
    and nullif(btrim(m.body), '') is not null;
$$;

revoke all on function public.published_match_articles() from public;
grant execute on function public.published_match_articles() to anon, authenticated;
