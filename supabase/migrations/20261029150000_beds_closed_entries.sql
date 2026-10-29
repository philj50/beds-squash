-- County Closed entry list copied from Sport Manager.
-- Email and mobile stay here for admins. Passwords are not stored.

create table if not exists public.beds_closed_entries (
  tournament_id bigint not null,
  year integer not null,
  grade text not null default '',
  forename text not null default '',
  surname text not null default '',
  email text not null default '',
  telephone text not null default '',
  payment_status text not null default '',
  primary key (tournament_id, grade, forename, surname, email)
);

comment on table public.beds_closed_entries is
  'Sport Manager entry list for a County Closed. Email and mobile are copied from that list.';

alter table public.beds_closed_entries enable row level security;

revoke all on table public.beds_closed_entries from public, anon, authenticated;

drop policy if exists "admins read beds closed entries" on public.beds_closed_entries;
create policy "admins read beds closed entries"
  on public.beds_closed_entries for select
  to authenticated
  using (public.is_admin());

grant select on public.beds_closed_entries to authenticated;
