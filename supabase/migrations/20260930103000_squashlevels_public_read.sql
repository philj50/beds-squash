grant select on table
  public.squashlevels_players,
  public.squashlevels_ratings,
  public.squashlevels_matches,
  public.squashlevels_names
to anon, authenticated;

alter table public.squashlevels_players enable row level security;
alter table public.squashlevels_ratings enable row level security;
alter table public.squashlevels_matches enable row level security;
alter table public.squashlevels_names enable row level security;

create policy "public read squashlevels players"
  on public.squashlevels_players for select
  to anon, authenticated
  using (true);

create policy "public read squashlevels ratings"
  on public.squashlevels_ratings for select
  to anon, authenticated
  using (true);

create policy "public read squashlevels matches"
  on public.squashlevels_matches for select
  to anon, authenticated
  using (true);

create policy "public read squashlevels names"
  on public.squashlevels_names for select
  to anon, authenticated
  using (true);
