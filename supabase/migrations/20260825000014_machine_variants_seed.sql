begin;

with automatic_machines as (
  select id, base_price, slug from public.machines
  where slug in ('hyro-set-omen', 'hyro-set-pro-8', 'hyro-set-pro-6', 'hyro-set-compact-4')
), semi_automatic_machines as (
  select id, base_price, slug from public.machines
  where slug = 'hyro-set-basic-4'
), desired as (
  select id as machine_id, 'AUTOMATIC'::public.machine_variant_type as variant_type, 'Automática'::text as display_name, base_price as price, true as active, 0 as sort_order from automatic_machines
  union all select id, 'SEMI_AUTOMATIC'::public.machine_variant_type, 'Semiautomática', null, false, 1 from automatic_machines
  union all select id, 'AUTOMATIC'::public.machine_variant_type, 'Automática', null, false, 0 from semi_automatic_machines
  union all select id, 'SEMI_AUTOMATIC'::public.machine_variant_type, 'Semiautomática', base_price, true, 1 from semi_automatic_machines
)
insert into public.machine_variants(machine_id, variant_type, display_name, price, active, sort_order)
select machine_id, variant_type, display_name, price, active, sort_order from desired
on conflict (machine_id, variant_type) do update
set display_name = excluded.display_name,
    price = excluded.price,
    active = excluded.active,
    sort_order = excluded.sort_order;

commit;
