begin;

create temporary table _nahuitech_catalog_machines (
  slug text primary key,
  name text not null,
  short_description text not null,
  base_price numeric(12, 2) not null,
  number_of_bases integer,
  supports_addons boolean not null,
  active boolean not null,
  sort_order integer not null
) on commit drop;

insert into _nahuitech_catalog_machines (
  slug,
  name,
  short_description,
  base_price,
  number_of_bases,
  supports_addons,
  active,
  sort_order
)
values
  ('hyro-set-omen', 'Hyro Set OMEN', 'Maquina de 8 estaciones con doble plancha', 299990.00, 8, true, true, 1),
  ('hyro-set-pro-8', 'Hyro Set Pro 8', 'Maquina de 8 estaciones con una plancha', 211990.00, 8, true, true, 2),
  ('hyro-set-pro-6', 'Hyro Set Pro 6', 'maquina de 6 estaciones con una plancha automatica', 159990.00, 6, true, true, 3),
  ('hyro-set-compact-4', 'Hyro Set Compact 4', 'maquina de 4 estaciones con una plancha, automatica', 105990.00, 4, true, true, 4),
  ('hyro-set-intro', 'Hyro Set Intro', 'maquina hybrida para sublimación', 99990.00, null, false, true, 5),
  ('hyro-set-basic-4', 'Hyro Set Basic 4', 'maquina de 4 estaciones semi automatica', 59990.00, 4, true, true, 6),
  ('hyro-set-tri-basic', 'Hyro Set Tri-Basic', 'maquina de 3 estaciones manual', 45990.00, 3, true, true, 7),
  ('nahui-pre-set-dtf', 'Nahui Pre Set DTF', 'maquina de Pre Secado PARA DTF', 34990.00, null, false, true, 8),
  ('nahui-flash-on', 'Nahui Flash-ON', 'MAQUINA ASPERSORA', 69990.00, null, false, true, 9),
  ('nahui-cure-uv', 'Nahui Cure UV', 'MAQUINA DE CURADO UV', 164990.00, null, false, true, 10);

create temporary table _nahuitech_catalog_addons (
  name text primary key,
  description text,
  unit_price numeric(12, 2) not null,
  calculation_type public.addon_calculation_type not null,
  required boolean not null,
  active boolean not null
) on commit drop;

insert into _nahuitech_catalog_addons (
  name,
  description,
  unit_price,
  calculation_type,
  required,
  active
)
values
  ('Sistema de Doble tiempo', null, 26200.00, 'FIXED', false, true),
  ('Pedal Sencillo', null, 1200.00, 'FIXED', false, true),
  ('Base de Apoyo', null, 11500.00, 'FIXED', false, true),
  ('Sistema de Acople', null, 4060.00, 'PER_BASE', false, true),
  ('Base Acopable', null, 3200.00, 'PER_BASE', false, true),
  ('Kit de Charola para Etiqueta', null, 3760.00, 'FIXED', false, true),
  ('Kit de Laser con Guía', null, 4000.00, 'FIXED', false, true),
  ('Laser en cruz extra', null, 2000.00, 'FIXED', false, true);

-- Remove only mappings that violate the declared rule for machines that do not
-- support add-ons. This makes it safe to update an existing matching machine.
delete from public.machine_addons as ma
using public.machines as m,
      _nahuitech_catalog_machines as source
where ma.machine_id = m.id
  and m.slug = source.slug
  and not source.supports_addons;

-- The workbook contains embedded images rather than URLs. image_url is left
-- NULL here until those files are deliberately uploaded to Supabase Storage.
insert into public.machines as target (
  name,
  slug,
  short_description,
  base_price,
  number_of_bases,
  image_url,
  active,
  sort_order,
  supports_addons
)
select
  source.name,
  source.slug,
  source.short_description,
  source.base_price,
  source.number_of_bases,
  null,
  source.active,
  source.sort_order,
  source.supports_addons
from _nahuitech_catalog_machines as source
on conflict (slug) do update
set
  name = excluded.name,
  short_description = excluded.short_description,
  base_price = excluded.base_price,
  number_of_bases = excluded.number_of_bases,
  image_url = coalesce(excluded.image_url, target.image_url),
  active = excluded.active,
  sort_order = excluded.sort_order,
  supports_addons = excluded.supports_addons;

-- addons.name has no unique constraint. The normalized name is the stable
-- catalog identity used to update an existing row or insert it exactly once.
update public.addons as target
set
  name = source.name,
  description = coalesce(source.description, target.description),
  unit_price = source.unit_price,
  calculation_type = source.calculation_type,
  required = source.required,
  active = source.active
from _nahuitech_catalog_addons as source
where lower(btrim(target.name)) = lower(btrim(source.name));

insert into public.addons (
  name,
  description,
  unit_price,
  calculation_type,
  required,
  active
)
select
  source.name,
  source.description,
  source.unit_price,
  source.calculation_type,
  source.required,
  source.active
from _nahuitech_catalog_addons as source
where not exists (
  select 1
  from public.addons as target
  where lower(btrim(target.name)) = lower(btrim(source.name))
);

create temporary table _nahuitech_catalog_addon_ids (
  name text primary key,
  addon_id uuid not null
) on commit drop;

insert into _nahuitech_catalog_addon_ids (name, addon_id)
select
  source.name,
  (
    select target.id
    from public.addons as target
    where lower(btrim(target.name)) = lower(btrim(source.name))
    order by target.created_at, target.id
    limit 1
  )
from _nahuitech_catalog_addons as source;

create temporary table _nahuitech_expected_machine_addons (
  machine_id uuid not null,
  addon_id uuid not null,
  primary key (machine_id, addon_id)
) on commit drop;

-- "TODAS" in the workbook means every machine that supports add-ons.
insert into _nahuitech_expected_machine_addons (machine_id, addon_id)
select m.id, addon.addon_id
from public.machines as m
join _nahuitech_catalog_machines as source on source.slug = m.slug
cross join _nahuitech_catalog_addon_ids as addon
where source.supports_addons
  and addon.name <> 'Base de Apoyo';

-- Base de Apoyo is compatible only with Basic and Tri-Basic.
insert into _nahuitech_expected_machine_addons (machine_id, addon_id)
select m.id, addon.addon_id
from public.machines as m
join _nahuitech_catalog_machines as source on source.slug = m.slug
join _nahuitech_catalog_addon_ids as addon on addon.name = 'Base de Apoyo'
where source.slug in ('hyro-set-basic-4', 'hyro-set-tri-basic');

-- Reconcile only relationships owned by this initial catalog. Other catalog
-- data remains untouched; stale relationships outside the Excel rules are removed.
delete from public.machine_addons as ma
using public.machines as m,
      _nahuitech_catalog_machines as source,
      _nahuitech_catalog_addon_ids as addon
where ma.machine_id = m.id
  and m.slug = source.slug
  and ma.addon_id = addon.addon_id
  and not exists (
    select 1
    from _nahuitech_expected_machine_addons as expected
    where expected.machine_id = ma.machine_id
      and expected.addon_id = ma.addon_id
  );

insert into public.machine_addons as target (machine_id, addon_id, active)
select machine_id, addon_id, true
from _nahuitech_expected_machine_addons
on conflict (machine_id, addon_id) do update
set active = excluded.active;

do $$
declare
  actual_machine_count integer;
  actual_addon_count integer;
  addon_machine_count integer;
  no_addon_machine_count integer;
  actual_relationship_count integer;
  invalid_machine_count integer;
begin
  select count(*)
    into actual_machine_count
  from public.machines as m
  join _nahuitech_catalog_machines as source on source.slug = m.slug;

  if actual_machine_count <> 10 then
    raise exception 'Expected 10 catalog machines, found %.', actual_machine_count;
  end if;

  select count(*)
    into actual_addon_count
  from _nahuitech_catalog_addon_ids;

  if actual_addon_count <> 8 then
    raise exception 'Expected 8 catalog add-ons, found %.', actual_addon_count;
  end if;

  select count(*) filter (where m.supports_addons),
         count(*) filter (where not m.supports_addons)
    into addon_machine_count, no_addon_machine_count
  from public.machines as m
  join _nahuitech_catalog_machines as source on source.slug = m.slug;

  if addon_machine_count <> 6 or no_addon_machine_count <> 4 then
    raise exception 'Expected 6 machines with add-ons and 4 without; found % and %.',
      addon_machine_count,
      no_addon_machine_count;
  end if;

  select count(*)
    into invalid_machine_count
  from public.machines as m
  join _nahuitech_catalog_machines as source on source.slug = m.slug
  where m.number_of_bases is distinct from source.number_of_bases;

  if invalid_machine_count <> 0 then
    raise exception 'Catalog machine number_of_bases values do not match the seed.';
  end if;

  select count(*)
    into actual_relationship_count
  from public.machine_addons as ma
  join public.machines as m on m.id = ma.machine_id
  join _nahuitech_catalog_machines as source on source.slug = m.slug
  join _nahuitech_catalog_addon_ids as addon on addon.addon_id = ma.addon_id;

  if actual_relationship_count <> 44 then
    raise exception 'Expected 44 catalog machine_addons relationships, found %.',
      actual_relationship_count;
  end if;

  if exists (
    select 1
    from public.machine_addons as ma
    join public.machines as m on m.id = ma.machine_id
    join _nahuitech_catalog_machines as source on source.slug = m.slug
    where not source.supports_addons
  ) then
    raise exception 'Machines without add-on support cannot have machine_addons records.';
  end if;
end;
$$;

commit;
