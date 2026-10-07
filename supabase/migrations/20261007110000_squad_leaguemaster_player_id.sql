-- Remember the League Master player so a later name correction still finds the same row.

alter table public.squad_players
  add column if not exists leaguemaster_player_id text;

comment on column public.squad_players.leaguemaster_player_id is
  'League Master player id. The import uses it to copy the name, England Squash number, and email.';
