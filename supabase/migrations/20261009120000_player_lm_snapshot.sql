-- Last League Master values, kept beside the website values.
-- A non-empty website email, name, or ES number is not replaced on import.
-- lm_*_kept records a League Master value the admin has already chosen to leave.

alter table public.squad_players
  add column if not exists lm_email text,
  add column if not exists lm_england_squash_id text,
  add column if not exists lm_display_name text,
  add column if not exists lm_email_kept text,
  add column if not exists lm_es_kept text,
  add column if not exists lm_name_kept text;
