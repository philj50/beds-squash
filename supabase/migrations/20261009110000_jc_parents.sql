-- Parents named on a Junior County Closed entry. The website lists them from
-- those entries. This group is not filled or removed by League Master sync.

insert into public.roles (slug, name, position) values
  ('jc_parent', 'JC Parent', 7)
on conflict (slug) do update
set name = excluded.name, position = excluded.position;

update public.roles set position = 8 where slug = 'junior_organiser';
update public.roles set position = 9 where slug = 'bc_player';
update public.roles set position = 10 where slug = 'rb_player';

insert into public.groups (slug, name, role_slug, source, managed, position) values
  ('jc_parents', 'JC Parents', 'jc_parent', 'website', false, 7)
on conflict (slug) do update
set name = excluded.name,
    role_slug = excluded.role_slug,
    source = excluded.source,
    managed = excluded.managed,
    position = excluded.position;

update public.groups set position = 8 where slug = 'junior_organisers';
update public.groups set position = 9 where slug = 'bc_players';
update public.groups set position = 10 where slug = 'rb_players';
