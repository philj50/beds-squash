-- Mixed Under 9 is a real section. Age is taken on 8 November 2026, the same rule as the entry form.

create or replace function public.junior_age_category(dob date)
returns text
language sql
immutable
as $$
  select case
    when dob is null or dob > date '2026-11-08' or dob <= date '2007-11-08' then null
    when dob > date '2017-11-08' then 'Under 9'
    when dob > date '2015-11-08' then 'Under 11'
    when dob > date '2013-11-08' then 'Under 13'
    when dob > date '2011-11-08' then 'Under 15'
    when dob > date '2009-11-08' then 'Under 17'
    else 'Under 19'
  end;
$$;

create or replace function public.junior_entries_set_category()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  category text;
begin
  category := public.junior_age_category(new.date_of_birth);
  if category is null then
    raise exception 'This date of birth is outside the junior age groups';
  end if;
  if new.guardian_confirmed is not true then
    raise exception 'A parent or guardian must confirm the entry';
  end if;
  new.age_category := category;
  if category = 'Under 9' then
    new.draw := 'Mixed';
  end if;
  new.player_first_name := btrim(new.player_first_name);
  new.player_last_name := btrim(new.player_last_name);
  new.club := btrim(new.club);
  new.guardian_name := btrim(new.guardian_name);
  new.guardian_email := lower(btrim(new.guardian_email));
  new.guardian_phone := btrim(new.guardian_phone);
  new.emergency_name := btrim(new.emergency_name);
  new.emergency_phone := btrim(new.emergency_phone);
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  return new;
end;
$$;

alter table public.junior_entries drop constraint junior_entries_category;
alter table public.junior_entries add constraint junior_entries_category
  check (age_category in ('Under 9', 'Under 11', 'Under 13', 'Under 15', 'Under 17', 'Under 19'));

alter table public.junior_entries drop constraint junior_entries_draw;
alter table public.junior_entries add constraint junior_entries_draw
  check (
    (age_category = 'Under 9' and draw = 'Mixed')
    or (age_category <> 'Under 9' and draw in ('Boys', 'Girls'))
  );

update public.junior_entries
set age_category = public.junior_age_category(date_of_birth)
where age_category is distinct from public.junior_age_category(date_of_birth);
