-- On/off switches for the public ntfy notes, and a delivery switch for password resets.
-- Password reset mail stays on the test inbox until password_reset_delivery.live is true.
-- When that is true, only Alex Buckhurst's own reset is sent to his address.

create table if not exists public.ntfy_rules (
  slug text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.ntfy_rules (slug, enabled)
values
  ('ntfy-config', true),
  ('ntfy-lm', true),
  ('ntfy-sl', true),
  ('ntfy-errors', true),
  ('ntfy-juniors', true),
  ('ntfy-closed', true),
  ('ntfy-commentary', true)
on conflict (slug) do nothing;

alter table public.ntfy_rules enable row level security;

drop policy if exists ntfy_rules_read on public.ntfy_rules;
create policy ntfy_rules_read on public.ntfy_rules
  for select to anon, authenticated
  using (true);

revoke all on table public.ntfy_rules from public;
grant select on table public.ntfy_rules to anon, authenticated;

create or replace function public.set_ntfy_rule(p_slug text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only an admin can do that.' using errcode = '42501';
  end if;
  if p_slug is null or p_slug !~ '^ntfy-[a-z0-9-]+$' then
    raise exception 'Choose a note.';
  end if;
  update public.ntfy_rules
  set enabled = coalesce(p_enabled, false),
      updated_at = now()
  where slug = p_slug;
  if not found then
    raise exception 'Choose a note.';
  end if;
end;
$$;

revoke all on function public.set_ntfy_rule(text, boolean) from public, anon;
grant execute on function public.set_ntfy_rule(text, boolean) to authenticated;

create table if not exists public.password_reset_delivery (
  id integer primary key check (id = 1),
  live boolean not null default false
);

insert into public.password_reset_delivery (id, live)
values (1, false)
on conflict (id) do nothing;

alter table public.password_reset_delivery enable row level security;
revoke all on table public.password_reset_delivery from public, anon, authenticated;

create table if not exists public.password_reset_throttle (
  email_key text primary key,
  requested_at timestamptz not null default now()
);

alter table public.password_reset_throttle enable row level security;
revoke all on table public.password_reset_throttle from public, anon, authenticated;

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

  if exists (
    select 1 from public.ntfy_rules
    where slug = 'ntfy-juniors' and enabled is false
  ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

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

notify pgrst, 'reload schema';
