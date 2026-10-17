-- One published story per division on a match day. The old rule kept a single
-- article for the whole day, so a second division could not be stored.

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
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) ilike '%article_on%'
  loop
    execute format('alter table public.match_articles drop constraint %I', v_name);
  end loop;
end $$;

drop index if exists public.match_articles_article_on_key;

create unique index if not exists match_articles_slug_key on public.match_articles (slug);
