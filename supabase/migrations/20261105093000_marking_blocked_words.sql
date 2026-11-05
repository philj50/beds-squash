-- Extra words an admin can stop on a marked match, on top of the built-in list.

create table if not exists public.marking_blocked_words (
  id bigint generated always as identity primary key,
  word text not null,
  name_key text not null unique,
  created_at timestamptz not null default now()
);

alter table public.marking_blocked_words enable row level security;

drop policy if exists "public read blocked marking words" on public.marking_blocked_words;
create policy "public read blocked marking words"
  on public.marking_blocked_words
  for select
  to anon, authenticated
  using (true);

revoke all on public.marking_blocked_words from anon, authenticated;
grant select on public.marking_blocked_words to anon, authenticated;

create or replace function public.marking_word_key(p_word text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    translate(lower(btrim(coalesce(p_word, ''))), '@4$513!|07', 'aassiieiot'),
    '[^a-z]',
    '',
    'g'
  );
$$;

revoke all on function public.marking_word_key(text) from public, anon, authenticated;

create or replace function public.block_marking_word(p_word text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := regexp_replace(btrim(coalesce(p_word, '')), '\s+', ' ', 'g');
  key text := public.marking_word_key(clean);
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only an admin can stop a word.';
  end if;
  if char_length(clean) > 40 or char_length(key) < 2 then
    raise exception 'Use a word of at least two letters.';
  end if;
  insert into public.marking_blocked_words (word, name_key)
  values (clean, key)
  on conflict (name_key) do nothing;
  if not found then
    raise exception 'That word is already stopped.';
  end if;
end;
$$;

revoke all on function public.block_marking_word(text) from public, anon;
grant execute on function public.block_marking_word(text) to authenticated;

create or replace function public.unblock_marking_word(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only an admin can change the stopped words.';
  end if;
  delete from public.marking_blocked_words where id = p_id;
  if not found then
    raise exception 'That word is not on the stopped list.';
  end if;
end;
$$;

revoke all on function public.unblock_marking_word(bigint) from public, anon;
grant execute on function public.unblock_marking_word(bigint) to authenticated;

notify pgrst, 'reload schema';
