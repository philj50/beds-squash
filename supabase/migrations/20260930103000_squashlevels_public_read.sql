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
