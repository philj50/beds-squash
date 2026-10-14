-- An admin can change the name shown on a shared item.
-- submitted_by stays the account that uploaded it.

drop function if exists public.edit_contribution(uuid, text, text, text, text, text);

create or replace function public.edit_contribution(
  p_id uuid,
  p_caption text,
  p_title text,
  p_body text,
  p_url text,
  p_storage_path text,
  p_credit text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_old_path text;
  v_credit text := nullif(regexp_replace(btrim(coalesce(p_credit, '')), '\s+', ' ', 'g'), '');
  v_caption text := nullif(regexp_replace(btrim(coalesce(p_caption, '')), '\s+', ' ', 'g'), '');
  v_title text := nullif(regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g'), '');
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit an upload.';
  end if;

  if v_credit is null or char_length(v_credit) < 2 or char_length(v_credit) > 80 then
    raise exception 'Add a name of 2 to 80 characters.';
  end if;

  select kind, storage_path
  into v_kind, v_old_path
  from public.contributions
  where id = p_id;

  if not found then
    raise exception 'That upload is already gone.';
  end if;

  if v_kind in ('photo', 'video') then
    if v_caption is null or char_length(v_caption) > 200 then
      raise exception 'Add a caption of up to 200 characters.';
    end if;
    if v_path is null then
      v_path := v_old_path;
      v_old_path := null;
    else
      if v_kind = 'photo' and v_path !~ '^incoming/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif)$' then
        raise exception 'That photo cannot be accepted.';
      end if;
      if v_kind = 'video' and v_path !~ '^incoming/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm|mov)$' then
        raise exception 'That video cannot be accepted.';
      end if;
      if v_path is distinct from v_old_path and exists (
        select 1 from public.contributions where storage_path = v_path
      ) then
        raise exception 'That file is already in the queue.';
      end if;
      if v_path = v_old_path then
        v_old_path := null;
      end if;
    end if;
    update public.contributions
    set credit = v_credit,
        credit_key = lower(v_credit),
        caption = v_caption,
        storage_path = v_path,
        title = null,
        body = null,
        url = null
    where id = p_id and kind = v_kind;
  elsif v_kind = 'link' then
    if v_title is null or char_length(v_title) > 140 then
      raise exception 'Add a title of up to 140 characters.';
    end if;
    if v_caption is not null and char_length(v_caption) > 200 then
      raise exception 'Keep the note to 200 characters.';
    end if;
    if v_url is null or not public.contribution_link_ok(v_url) then
      raise exception 'Use an https link.';
    end if;
    update public.contributions
    set credit = v_credit,
        credit_key = lower(v_credit),
        title = v_title,
        caption = v_caption,
        url = v_url,
        body = null,
        storage_path = null
    where id = p_id and kind = 'link';
    v_old_path := null;
  elsif v_kind = 'article' then
    if v_title is null or char_length(v_title) < 4 or char_length(v_title) > 140 then
      raise exception 'Add a title of 4 to 140 characters.';
    end if;
    if v_caption is not null and char_length(v_caption) > 280 then
      raise exception 'Keep the summary to 280 characters.';
    end if;
    if v_body is null or char_length(v_body) < 40 or char_length(v_body) > 8000 then
      raise exception 'Write the article, between 40 and 8000 characters.';
    end if;
    update public.contributions
    set credit = v_credit,
        credit_key = lower(v_credit),
        title = v_title,
        caption = v_caption,
        body = v_body,
        storage_path = null,
        url = null
    where id = p_id and kind = 'article';
    v_old_path := null;
  else
    raise exception 'That upload cannot be edited.';
  end if;

  return v_old_path;
end;
$$;

revoke all on function public.edit_contribution(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.edit_contribution(uuid, text, text, text, text, text, text) to authenticated;
