-- An admin can correct every field on a junior entry.

create or replace function public.edit_junior_entry(
  p_id bigint,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date,
  p_draw text,
  p_club text,
  p_guardian_name text,
  p_guardian_email text,
  p_guardian_phone text,
  p_emergency_name text,
  p_emergency_phone text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := nullif(regexp_replace(btrim(coalesce(p_first_name, '')), '\s+', ' ', 'g'), '');
  v_last text := nullif(regexp_replace(btrim(coalesce(p_last_name, '')), '\s+', ' ', 'g'), '');
  v_club text := nullif(regexp_replace(btrim(coalesce(p_club, '')), '\s+', ' ', 'g'), '');
  v_guardian text := nullif(regexp_replace(btrim(coalesce(p_guardian_name, '')), '\s+', ' ', 'g'), '');
  v_email text := nullif(btrim(coalesce(p_guardian_email, '')), '');
  v_guardian_phone text := nullif(regexp_replace(btrim(coalesce(p_guardian_phone, '')), '\s+', ' ', 'g'), '');
  v_emergency text := nullif(regexp_replace(btrim(coalesce(p_emergency_name, '')), '\s+', ' ', 'g'), '');
  v_emergency_phone text := nullif(regexp_replace(btrim(coalesce(p_emergency_phone, '')), '\s+', ' ', 'g'), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_draw text := nullif(btrim(coalesce(p_draw, '')), '');
  v_age text;
  v_event text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can correct an entry.';
  end if;

  if v_first is null or char_length(v_first) > 60 or v_last is null or char_length(v_last) > 60 then
    raise exception 'Add the junior''s first and last name.';
  end if;
  if v_club is null or char_length(v_club) < 2 or char_length(v_club) > 80 then
    raise exception 'Add the club.';
  end if;
  if v_guardian is null or char_length(v_guardian) < 2 or char_length(v_guardian) > 80 then
    raise exception 'Add the parent or guardian.';
  end if;
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(v_email) > 120 then
    raise exception 'Add a parent email.';
  end if;
  if v_guardian_phone is null or char_length(v_guardian_phone) < 8 or char_length(v_guardian_phone) > 20 then
    raise exception 'Add a parent phone number.';
  end if;
  if v_emergency is null or char_length(v_emergency) < 2 or char_length(v_emergency) > 80 then
    raise exception 'Add an emergency contact.';
  end if;
  if v_emergency_phone is null or char_length(v_emergency_phone) < 8 or char_length(v_emergency_phone) > 20 then
    raise exception 'Add an emergency phone number.';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'Keep the notes to 500 characters.';
  end if;
  if p_date_of_birth is null or p_date_of_birth > date '2026-11-08' or p_date_of_birth <= date '2007-11-08' then
    raise exception 'That date of birth is outside the junior age groups.';
  end if;

  v_age := case
    when p_date_of_birth > date '2017-11-08' then 'Under 9'
    when p_date_of_birth > date '2015-11-08' then 'Under 11'
    when p_date_of_birth > date '2013-11-08' then 'Under 13'
    when p_date_of_birth > date '2011-11-08' then 'Under 15'
    when p_date_of_birth > date '2009-11-08' then 'Under 17'
    else 'Under 19'
  end;

  if v_age = 'Under 9' then
    v_draw := 'Mixed';
  elsif v_draw not in ('Boys', 'Girls') then
    raise exception 'Choose Boys or Girls.';
  end if;

  select event_slug into v_event from public.junior_entries where id = p_id;
  if not found then
    raise exception 'That entry is already gone.';
  end if;

  if exists (
    select 1
    from public.junior_entries other
    where other.id <> p_id
      and other.event_slug = v_event
      and lower(other.player_first_name) = lower(v_first)
      and lower(other.player_last_name) = lower(v_last)
      and other.date_of_birth = p_date_of_birth
  ) then
    raise exception 'This player is already entered.';
  end if;

  update public.junior_entries
  set player_first_name = v_first,
      player_last_name = v_last,
      date_of_birth = p_date_of_birth,
      age_category = v_age,
      draw = v_draw,
      club = v_club,
      guardian_name = v_guardian,
      guardian_email = v_email,
      guardian_phone = v_guardian_phone,
      emergency_name = v_emergency,
      emergency_phone = v_emergency_phone,
      notes = v_notes
  where id = p_id;
exception
  when unique_violation then
    raise exception 'This player is already entered.';
end;
$$;

revoke all on function public.edit_junior_entry(bigint, text, text, date, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.edit_junior_entry(bigint, text, text, date, text, text, text, text, text, text, text, text) to authenticated;
