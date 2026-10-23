-- Public entry counts, optional first name and surname initial, and a note to the junior organisers when an entry changes.

create extension if not exists pg_net;

alter table public.junior_entries
  add column if not exists show_name boolean not null default false;

grant insert (show_name) on table public.junior_entries to anon, authenticated;
grant select (show_name) on table public.junior_entries to authenticated;

create or replace function public.junior_short_name(first_name text, last_name text)
returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(coalesce(first_name, '')), '') is null then 'A player'
    when nullif(btrim(coalesce(last_name, '')), '') is null then btrim(first_name)
    else btrim(first_name) || ' ' || upper(left(btrim(last_name), 1)) || '.'
  end;
$$;

revoke all on function public.junior_short_name(text, text) from public, anon, authenticated;

create or replace function public.junior_entry_label(age text, draw text)
returns text
language sql
immutable
as $$
  select case
    when age = 'Under 9' and draw = 'Mixed' then 'Mixed U9'
    when age = 'Under 11' and draw = 'Girls' then 'Girls U11'
    when age = 'Under 13' and draw = 'Girls' then 'Girls U13'
    when age = 'Under 15' and draw = 'Girls' then 'Girls U15'
    when age = 'Under 17' and draw = 'Girls' then 'Girls U17'
    when age = 'Under 19' and draw = 'Girls' then 'Girls U19'
    when age = 'Under 11' and draw = 'Boys' then 'Boys U11'
    when age = 'Under 13' and draw = 'Boys' then 'Boys U13'
    when age = 'Under 15' and draw = 'Boys' then 'Boys U15'
    when age = 'Under 17' and draw = 'Boys' then 'Boys U17'
    when age = 'Under 19' and draw = 'Boys' then 'Boys U19'
    else btrim(coalesce(draw, '') || ' ' || coalesce(age, ''))
  end;
$$;

revoke all on function public.junior_entry_label(text, text) from public, anon, authenticated;

create or replace function public.junior_public_entries()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'label', g.label,
          'count', (
            select count(*)::int
            from public.junior_entries e
            where e.age_category = g.age
              and e.draw = g.draw
          ),
          'names', (
            select coalesce(
              jsonb_agg(
                public.junior_short_name(e.player_first_name, e.player_last_name)
                order by e.player_first_name, e.player_last_name
              ),
              '[]'::jsonb
            )
            from public.junior_entries e
            where e.age_category = g.age
              and e.draw = g.draw
              and e.show_name
          )
        )
        order by g.sort
      )
      from (
        values
          ('Mixed U9', 'Under 9', 'Mixed', 1),
          ('Girls U11', 'Under 11', 'Girls', 2),
          ('Girls U13', 'Under 13', 'Girls', 3),
          ('Girls U15', 'Under 15', 'Girls', 4),
          ('Girls U17', 'Under 17', 'Girls', 5),
          ('Girls U19', 'Under 19', 'Girls', 6),
          ('Boys U11', 'Under 11', 'Boys', 7),
          ('Boys U13', 'Under 13', 'Boys', 8),
          ('Boys U15', 'Under 15', 'Boys', 9),
          ('Boys U17', 'Under 17', 'Boys', 10),
          ('Boys U19', 'Under 19', 'Boys', 11)
      ) as g(label, age, draw, sort)
    ),
    '[]'::jsonb
  );
$$;

revoke all on function public.junior_public_entries() from public;
grant execute on function public.junior_public_entries() to anon, authenticated;

drop function if exists public.edit_junior_entry(bigint, text, text, date, text, text, text, text, text, text, text, text);

create function public.edit_junior_entry(
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
      notes = v_notes,
      show_name = v_show
  where id = p_id;
exception
  when unique_violation then
    raise exception 'This player is already entered.';
end;
$$;

revoke all on function public.edit_junior_entry(bigint, text, text, date, text, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.edit_junior_entry(bigint, text, text, date, text, text, text, text, text, text, text, text, boolean) to authenticated;

create or replace function public.notify_junior_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.junior_entries%rowtype;
  v_changes text;
  v_message text;
begin
  if tg_op = 'UPDATE' then
    v_changes := array_to_string(array_remove(array[
      case
        when old.player_first_name is distinct from new.player_first_name
          or old.player_last_name is distinct from new.player_last_name then 'Name'
      end,
      case when old.date_of_birth is distinct from new.date_of_birth then 'Date of birth' end,
      case
        when old.age_category is distinct from new.age_category
          or old.draw is distinct from new.draw then 'Section'
      end,
      case when old.club is distinct from new.club then 'Club' end,
      case
        when old.guardian_name is distinct from new.guardian_name
          or old.guardian_email is distinct from new.guardian_email
          or old.guardian_phone is distinct from new.guardian_phone then 'Parent details'
      end,
      case
        when old.emergency_name is distinct from new.emergency_name
          or old.emergency_phone is distinct from new.emergency_phone then 'Emergency contact'
      end,
      case when old.notes is distinct from new.notes then 'Notes' end,
      case when old.show_name is distinct from new.show_name then 'Name on the public list' end
    ], null), ', ');
    if v_changes is null or v_changes = '' then
      return new;
    end if;
  end if;

  v_row := case when tg_op = 'DELETE' then old else new end;
  v_message := case
    when tg_op = 'INSERT' then format(
      'New entry: %s, %s. %s',
      public.junior_short_name(v_row.player_first_name, v_row.player_last_name),
      public.junior_entry_label(v_row.age_category, v_row.draw),
      case when v_row.show_name then 'The name is on the public list.' else 'The name is not on the public list.' end
    )
    when tg_op = 'DELETE' then format(
      'Entry removed: %s, %s.',
      public.junior_short_name(v_row.player_first_name, v_row.player_last_name),
      public.junior_entry_label(v_row.age_category, v_row.draw)
    )
    else format(
      'Entry updated: %s, %s. Changed: %s.',
      public.junior_short_name(v_row.player_first_name, v_row.player_last_name),
      public.junior_entry_label(v_row.age_category, v_row.draw),
      v_changes
    )
  end;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    perform net.http_post(
      'https://ntfy.sh/',
      jsonb_build_object(
        'topic', 'beds_juniors_1234',
        'title', 'Beds juniors',
        'message', v_message,
        'tags', jsonb_build_array('squash')
      ),
      '{}'::jsonb,
      '{"Content-Type":"application/json"}'::jsonb,
      5000
    );
  elsif to_regprocedure('extensions.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    perform extensions.http_post(
      'https://ntfy.sh/',
      jsonb_build_object(
        'topic', 'beds_juniors_1234',
        'title', 'Beds juniors',
        'message', v_message,
        'tags', jsonb_build_array('squash')
      ),
      '{}'::jsonb,
      '{"Content-Type":"application/json"}'::jsonb,
      5000
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
exception
  when others then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
end;
$$;

revoke all on function public.notify_junior_entry() from public, anon, authenticated;

drop trigger if exists junior_entries_notify on public.junior_entries;
create trigger junior_entries_notify
  after insert or update or delete on public.junior_entries
  for each row execute function public.notify_junior_entry();
