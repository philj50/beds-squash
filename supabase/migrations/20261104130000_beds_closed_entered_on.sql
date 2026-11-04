-- The day a County Closed entry first appeared on the Sport Manager list.
-- Names already on the list stay blank. Sport Manager does not send an earlier date.

alter table public.beds_closed_entries
  add column if not exists entered_on date;
