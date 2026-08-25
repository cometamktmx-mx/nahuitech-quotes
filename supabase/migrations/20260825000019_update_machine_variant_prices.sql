begin;

-- Basic is commercially a single semiautomatic version. Its legacy automatic
-- row is retained for audit/catalog continuity, but it is not sellable.
update public.machine_variants as variant
set
  active = false,
  price = null,
  description = null
from public.machines as machine
where variant.machine_id = machine.id
  and machine.slug = 'hyro-set-basic-4'
  and variant.variant_type = 'AUTOMATIC'::public.machine_variant_type;

update public.machines as machine
set
  variant_selection_required = false,
  allowed_variant_types = array['SEMI_AUTOMATIC'::public.machine_variant_type]
where machine.slug = 'hyro-set-basic-4';

-- New commercial prices. Existing automatic prices for Pro 8, Pro 6 and
-- Compact remain untouched by design.
update public.machine_variants as variant
set
  price = source.price,
  active = true
from public.machines as machine
join (
  values
    ('hyro-set-omen'::text, 'AUTOMATIC'::public.machine_variant_type, 249990.00::numeric),
    ('hyro-set-omen'::text, 'SEMI_AUTOMATIC'::public.machine_variant_type, 118000.00::numeric),
    ('hyro-set-pro-8'::text, 'SEMI_AUTOMATIC'::public.machine_variant_type, 181000.00::numeric),
    ('hyro-set-pro-6'::text, 'SEMI_AUTOMATIC'::public.machine_variant_type, 136000.00::numeric),
    ('hyro-set-compact-4'::text, 'SEMI_AUTOMATIC'::public.machine_variant_type, 90000.00::numeric)
) as source(machine_slug, variant_type, price)
  on source.machine_slug = machine.slug
where variant.machine_id = machine.id
  and variant.variant_type = source.variant_type;

-- Basic keeps its existing semiautomatic price while being explicitly active.
update public.machine_variants as variant
set active = true
from public.machines as machine
where variant.machine_id = machine.id
  and machine.slug = 'hyro-set-basic-4'
  and variant.variant_type = 'SEMI_AUTOMATIC'::public.machine_variant_type;

with descriptions(machine_slug, variant_type, description) as (
  values
    (
      'hyro-set-omen'::text,
      'AUTOMATIC'::public.machine_variant_type,
      'Área de paleta de 55 × 40 cm. Capacidad de referencia de hasta 6,000 piezas terminadas en una jornada de 8 horas con dos usuarios. Ideal para operaciones de alto volumen que buscan máxima productividad, continuidad de trabajo y aprovechar dos estaciones de planchado para acelerar la producción.'::text
    ),
    (
      'hyro-set-pro-8'::text,
      'AUTOMATIC'::public.machine_variant_type,
      'Área de paleta de 55 × 40 cm. Capacidad de referencia de hasta 4,000 piezas terminadas en una jornada de 8 horas con un usuario. Ideal para talleres y empresas que necesitan aumentar su volumen de producción manteniendo un flujo de trabajo ágil, ordenado y eficiente.'::text
    ),
    (
      'hyro-set-pro-6'::text,
      'AUTOMATIC'::public.machine_variant_type,
      'Área de paleta de 55 × 40 cm. Capacidad de referencia de hasta 3,000 piezas terminadas en una jornada de 8 horas con un usuario. Ideal para negocios en crecimiento que buscan automatizar su producción, trabajar con mayor consistencia y aumentar capacidad sin requerir una operación compleja.'::text
    ),
    (
      'hyro-set-compact-4'::text,
      'AUTOMATIC'::public.machine_variant_type,
      'Área de paleta de 55 × 40 cm. Capacidad de referencia de hasta 1,500 piezas terminadas en una jornada de 8 horas con un usuario. Ideal para talleres que quieren dar el salto a la automatización aprovechando mejor el espacio de trabajo sin sacrificar capacidad productiva.'::text
    ),
    (
      'hyro-set-omen'::text,
      'SEMI_AUTOMATIC'::public.machine_variant_type,
      'Área de paleta de 45 × 35 cm. Configuración semiautomática pensada para quienes buscan la capacidad y estructura de OME con mayor intervención del operador. Ideal para talleres que necesitan flexibilidad, múltiples estaciones de trabajo y una plataforma preparada para crecer. La producción final depende del ritmo, experiencia y dinámica de trabajo del operador.'::text
    ),
    (
      'hyro-set-pro-8'::text,
      'SEMI_AUTOMATIC'::public.machine_variant_type,
      'Área de paleta de 45 × 35 cm. Sistema semiautomático de 8 estaciones ideal para talleres que manejan variedad de trabajos y buscan aumentar su capacidad manteniendo control directo sobre el proceso. La producción final depende del ritmo, experiencia y organización del operador.'::text
    ),
    (
      'hyro-set-pro-6'::text,
      'SEMI_AUTOMATIC'::public.machine_variant_type,
      'Área de paleta de 45 × 35 cm. Sistema semiautomático de 6 estaciones ideal para negocios que buscan profesionalizar su producción, trabajar de manera más ordenada y contar con capacidad para atender volúmenes crecientes. La producción final depende del ritmo y experiencia del operador.'::text
    ),
    (
      'hyro-set-compact-4'::text,
      'SEMI_AUTOMATIC'::public.machine_variant_type,
      'Área de paleta de 45 × 35 cm. Una solución semiautomática compacta para talleres que necesitan optimizar espacio y mejorar su flujo de producción sin migrar todavía a una operación completamente automática. La producción final depende del ritmo y experiencia del operador.'::text
    ),
    (
      'hyro-set-basic-4'::text,
      'SEMI_AUTOMATIC'::public.machine_variant_type,
      'Área de paleta de 45 × 35 cm. Capacidad de referencia de hasta 1,000 bajadas de plancha en una jornada de 8 horas con un usuario. Ideal para emprendimientos y talleres que buscan aumentar su capacidad de trabajo con una solución práctica, robusta y sencilla de operar. La producción final depende del ritmo y experiencia del operador.'::text
    )
)
update public.machine_variants as variant
set description = source.description
from public.machines as machine
join descriptions as source
  on source.machine_slug = machine.slug
where variant.machine_id = machine.id
  and variant.variant_type = source.variant_type;

-- The commercial price of Sistema de Acople changes only for OME. The PER_BASE
-- calculation remains data-driven and multiplies this value by machine bases.
update public.machine_addons as relation
set unit_price_override = 6250.00
from public.machines as machine
join public.addons as addon
  on lower(btrim(addon.name)) = 'sistema de acople'
where relation.machine_id = machine.id
  and relation.addon_id = addon.id
  and machine.slug = 'hyro-set-omen';

do $$
declare
  v_expected_variant_count integer := 10;
  v_actual_variant_count integer;
begin
  select count(*)
    into v_actual_variant_count
  from public.machine_variants as variant
  join public.machines as machine
    on machine.id = variant.machine_id
  where machine.slug in (
    'hyro-set-omen',
    'hyro-set-pro-8',
    'hyro-set-pro-6',
    'hyro-set-compact-4',
    'hyro-set-basic-4'
  );

  if v_actual_variant_count <> v_expected_variant_count then
    raise exception 'Expected % commercial variant records, found %.', v_expected_variant_count, v_actual_variant_count;
  end if;

  if exists (
    select 1
    from public.machine_variants as variant
    join public.machines as machine
      on machine.id = variant.machine_id
    where machine.slug = 'hyro-set-tri-basic'
  ) then
    raise exception 'Tri-Basic must not have machine variants.';
  end if;

  if not exists (
    select 1
    from public.machine_addons as relation
    join public.machines as machine
      on machine.id = relation.machine_id
    join public.addons as addon
      on addon.id = relation.addon_id
    where machine.slug = 'hyro-set-omen'
      and lower(btrim(addon.name)) = 'sistema de acople'
      and relation.unit_price_override = 6250.00
  ) then
    raise exception 'OME coupling-system override was not configured.';
  end if;
end;
$$;

commit;
