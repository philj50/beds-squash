-- Admins choose which photos appear on the front page.
-- The newest published photo starts on. The rest start off.

alter table public.contributions
  add column if not exists on_front boolean not null default false;

create or replace function public.set_photo_on_front(p_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can choose the front page.';
  end if;
  if not exists (select 1 from public.contributions where id = p_id and kind = 'photo') then
    raise exception 'That photo is already gone.';
  end if;

  update public.contributions
  set on_front = coalesce(p_on, false)
  where id = p_id
    and kind = 'photo';
end;
$$;

revoke all on function public.set_photo_on_front(uuid, boolean) from public, anon;
grant execute on function public.set_photo_on_front(uuid, boolean) to authenticated;

update public.contributions
set on_front = true
where id = (
  select id
  from public.contributions
  where kind = 'photo'
    and status = 'published'
  order by published_at desc nulls last, created_at desc
  limit 1
);
