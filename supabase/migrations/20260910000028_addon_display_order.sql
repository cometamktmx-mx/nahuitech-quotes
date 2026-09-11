alter table public.addons add column if not exists display_order integer;
with ordered as (
  select id, row_number() over (order by created_at asc, id asc) as position
  from public.addons
)
update public.addons as addon
set display_order = ordered.position
from ordered
where addon.id = ordered.id and addon.display_order is null;
alter table public.addons alter column display_order set not null;
create index if not exists addons_display_order_idx on public.addons (display_order asc, name asc);
