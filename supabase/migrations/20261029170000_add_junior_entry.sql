-- An admin can add a Junior County Closed entry after the public form has closed.

create or replace function public.add_junior_entry(
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
  p_notes text,
  p_show_name boolean default false
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
  v_show boolean := coalesce(p_show_name, false);
  v_age text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only an admin can add an entry.' using errcode = '42501';
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

  if exists (
    select 1
    from public.junior_entries other
    where other.event_slug = 'junior-closed-2026'
      and lower(other.player_first_name) = lower(v_first)
      and lower(other.player_last_name) = lower(v_last)
      and other.date_of_birth = p_date_of_birth
  ) then
    raise exception 'This player is already entered.';
  end if;

  insert into public.junior_entries (
    event_slug,
    player_first_name,
    player_last_name,
    date_of_birth,
    age_category,
    draw,
    club,
    guardian_name,
    guardian_email,
    guardian_phone,
    emergency_name,
    emergency_phone,
    notes,
    guardian_confirmed,
    show_name
  ) values (
    'junior-closed-2026',
    v_first,
    v_last,
    p_date_of_birth,
    v_age,
    v_draw,
    v_club,
    v_guardian,
    v_email,
    v_guardian_phone,
    v_emergency,
    v_emergency_phone,
    v_notes,
    true,
    v_show
  );
exception
  when unique_violation then
    raise exception 'This player is already entered.';
end;
$$;

revoke all on function public.add_junior_entry(text, text, date, text, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.add_junior_entry(text, text, date, text, text, text, text, text, text, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
