-- Hidden copies of the junior entry list. The website cannot read this table.

create table if not exists public.junior_entry_backups (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  entry_count integer not null,
  entries jsonb not null
);

alter table public.junior_entry_backups enable row level security;

revoke all on table public.junior_entry_backups from public, anon, authenticated;
