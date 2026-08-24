begin;

-- Keep public slugs stable: existing routes and historical snapshots retain their identifiers.
-- Remove Tri-Basic mappings before disabling add-on support because the capability trigger
-- deliberately prevents machines without support from retaining any relationship.
delete from public.machine_addons as ma
using public.machines as m
where ma.machine_id = m.id
  and m.slug = 'hyro-set-tri-basic';

update public.machines
set
  name = case slug
    when 'hyro-set-omen' then 'Hyro Set OME'
    when 'nahui-cure-uv' then 'NAHUI CURE UV-LED de tinta y barnices para serigrafía'
    else name
  end,
  number_of_bases = case slug
    when 'hyro-set-intro' then 6
    when 'hyro-set-tri-basic' then 3
    when 'nahui-pre-set-dtf' then null
    when 'nahui-flash-on' then null
    when 'nahui-cure-uv' then null
    else number_of_bases
  end,
  supports_addons = case slug
    when 'hyro-set-intro' then true
    when 'hyro-set-tri-basic' then false
    else supports_addons
  end,
  delivery_policy = case
    when slug in (
      'hyro-set-omen',
      'hyro-set-compact-4',
      'hyro-set-intro',
      'hyro-set-pro-8',
      'hyro-set-pro-6'
    ) then 'INSTALLATION_REQUIRED'::public.machine_delivery_policy
    else 'FLEXIBLE'::public.machine_delivery_policy
  end,
  image_url = case slug
    when 'hyro-set-omen' then '/machines/hyro-set-ome.png'
    when 'hyro-set-pro-8' then '/machines/hyro-set-pro-8.png'
    when 'hyro-set-pro-6' then '/machines/hyro-set-pro-6.png'
    when 'hyro-set-compact-4' then '/machines/hyro-set-compact-4.png'
    when 'hyro-set-intro' then '/machines/hyro-set-intro.png'
    when 'hyro-set-basic-4' then '/machines/hyro-set-basic-4.png'
    when 'hyro-set-tri-basic' then '/machines/hyro-set-tri-basic.png'
    when 'nahui-pre-set-dtf' then null
    when 'nahui-flash-on' then null
    when 'nahui-cure-uv' then null
    else image_url
  end
where slug in (
  'hyro-set-omen',
  'hyro-set-pro-8',
  'hyro-set-pro-6',
  'hyro-set-compact-4',
  'hyro-set-intro',
  'hyro-set-basic-4',
  'hyro-set-tri-basic',
  'nahui-pre-set-dtf',
  'nahui-flash-on',
  'nahui-cure-uv'
);

create temporary table _catalog_addon_corrections (
  stable_key text primary key,
  name text not null,
  description text,
  unit_price numeric(12, 2) not null,
  calculation_type public.addon_calculation_type not null
) on commit drop;

insert into _catalog_addon_corrections (
  stable_key,
  name,
  description,
  unit_price,
  calculation_type
)
values
  ('double-time', 'Sistema de Doble Tiempo', null, 26200.00, 'FIXED'),
  ('single-pedal', 'Pedal Sencillo', null, 1200.00, 'FIXED'),
  ('support-base', 'Base de Apoyo', null, 11500.00, 'FIXED'),
  ('coupling-system', 'Sistema de Acople', null, 4060.00, 'PER_BASE'),
  ('couplable-base', 'Base Acoplable', 'Incluye base metálica y goma.', 3200.00, 'PER_BASE'),
  ('application-tray', 'Kit de Charola para Aplicaciones', null, 3760.00, 'FIXED'),
  ('laser-guide', 'Kit de Láser con Guía', 'Incluye dos láseres que forman una cruz.', 4000.00, 'FIXED'),
  ('extra-cross-laser', 'Laser en cruz extra', null, 2000.00, 'FIXED'),
  ('station-base', 'Base para Estación', 'Incluye base metálica, base de contacto y goma de trabajo.', 5390.00, 'QUANTITY');

-- Normalize the existing catalog identities before using them as mapping keys.
update public.addons as target
set
  name = source.name,
  description = source.description,
  unit_price = source.unit_price,
  calculation_type = source.calculation_type
from _catalog_addon_corrections as source
where (source.stable_key = 'double-time' and lower(btrim(target.name)) = 'sistema de doble tiempo')
   or (source.stable_key = 'single-pedal' and lower(btrim(target.name)) = 'pedal sencillo')
   or (source.stable_key = 'support-base' and lower(btrim(target.name)) = 'base de apoyo')
   or (source.stable_key = 'coupling-system' and lower(btrim(target.name)) = 'sistema de acople')
   or (source.stable_key = 'couplable-base' and lower(btrim(target.name)) in ('base acopable', 'base acoplable'))
   or (source.stable_key = 'application-tray' and lower(btrim(target.name)) in ('kit de charola para etiqueta', 'kit de charola para aplicaciones'))
   or (source.stable_key = 'laser-guide' and lower(btrim(target.name)) in ('kit de laser con guía', 'kit de láser con guía'))
   or (source.stable_key = 'extra-cross-laser' and lower(btrim(target.name)) = 'laser en cruz extra')
   or (source.stable_key = 'station-base' and lower(btrim(target.name)) = 'base para estación');

-- These offers are explicitly optional under the corrected commercial rules.
update public.addons
set required = false,
    active = true
where lower(btrim(name)) in ('sistema de doble tiempo', 'base para estación');

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
  false,
  true
from _catalog_addon_corrections as source
where source.stable_key = 'station-base'
  and not exists (
    select 1
    from public.addons as target
    where lower(btrim(target.name)) = lower(btrim(source.name))
  );

create temporary table _catalog_addon_ids (
  stable_key text primary key,
  addon_id uuid not null
) on commit drop;

insert into _catalog_addon_ids (stable_key, addon_id)
select
  source.stable_key,
  (
    select target.id
    from public.addons as target
    where lower(btrim(target.name)) = lower(btrim(source.name))
    order by target.created_at, target.id
    limit 1
  )
from _catalog_addon_corrections as source;

-- Correct only the relationships owned by the initial real catalog.
update public.machine_addons as relation
set
  unit_price_override = null,
  description_override = null
from public.machines as machine,
     _catalog_addon_ids as addon
where relation.machine_id = machine.id
  and relation.addon_id = addon.addon_id
  and machine.slug in (
    'hyro-set-omen',
    'hyro-set-pro-8',
    'hyro-set-pro-6',
    'hyro-set-compact-4',
    'hyro-set-intro',
    'hyro-set-basic-4',
    'hyro-set-tri-basic'
  );

-- Tri-Basic has no add-ons under the final business rule.
delete from public.machine_addons as relation
using public.machines as machine
where relation.machine_id = machine.id
  and machine.slug = 'hyro-set-tri-basic';

-- Intro has exactly one optional quantity add-on.
delete from public.machine_addons as relation
using public.machines as machine,
      _catalog_addon_ids as addon
where relation.machine_id = machine.id
  and machine.slug = 'hyro-set-intro'
  and relation.addon_id <> (
    select addon_id
    from _catalog_addon_ids
    where stable_key = 'station-base'
  );

insert into public.machine_addons as relation (
  machine_id,
  addon_id,
  active,
  unit_price_override,
  description_override
)
select
  machine.id,
  addon.addon_id,
  true,
  null,
  null
from public.machines as machine
join _catalog_addon_ids as addon on addon.stable_key = 'station-base'
where machine.slug = 'hyro-set-intro'
on conflict (machine_id, addon_id) do update
set
  active = true,
  unit_price_override = null,
  description_override = null;

-- OME explicitly excludes Pedal Sencillo and has its own Double Time offer.
delete from public.machine_addons as relation
using public.machines as machine,
      _catalog_addon_ids as addon
where relation.machine_id = machine.id
  and machine.slug = 'hyro-set-omen'
  and relation.addon_id = addon.addon_id
  and addon.stable_key = 'single-pedal';

insert into public.machine_addons as relation (
  machine_id,
  addon_id,
  active,
  unit_price_override,
  description_override
)
select
  machine.id,
  addon.addon_id,
  true,
  28990.00,
  'Incluye dos pedales, uno para cada plancha.'
from public.machines as machine
join _catalog_addon_ids as addon on addon.stable_key = 'double-time'
where machine.slug = 'hyro-set-omen'
on conflict (machine_id, addon_id) do update
set
  active = true,
  unit_price_override = excluded.unit_price_override,
  description_override = excluded.description_override;

-- New server-trusted configuration with all calculation and delivery rules.
create or replace function public.quote_configuration(
  p_machine_id uuid,
  p_addon_quantities jsonb
)
returns table (
  machine_id uuid,
  machine_name text,
  machine_slug text,
  machine_base_price numeric,
  machine_number_of_bases integer,
  machine_delivery_policy public.machine_delivery_policy,
  subtotal numeric,
  addon_lines jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_machine public.machines%rowtype;
  v_requested jsonb := coalesce(p_addon_quantities, '{}'::jsonb);
  v_requested_count integer;
  v_valid_count integer;
  v_addon_total numeric(12, 2);
  v_addon_lines jsonb;
begin
  if jsonb_typeof(v_requested) <> 'object' then
    raise exception 'Add-on quantities must be an object.';
  end if;

  select *
    into v_machine
  from public.machines as machine
  where machine.id = p_machine_id
    and machine.active;

  if not found then
    raise exception 'The selected machine is not available.';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_requested) as requested(addon_id)
    where requested.addon_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'An add-on identifier is invalid.';
  end if;

  if exists (
    select 1
    from jsonb_each(v_requested) as requested(addon_id, quantity_value)
    where jsonb_typeof(requested.quantity_value) <> 'number'
      or requested.quantity_value #>> '{}' !~ '^[1-9][0-9]*$'
      or char_length(requested.quantity_value #>> '{}') > 9
  ) then
    raise exception 'Every selected add-on quantity must be a positive integer.';
  end if;

  select count(*)
    into v_requested_count
  from jsonb_object_keys(v_requested);

  if not v_machine.supports_addons and v_requested_count > 0 then
    raise exception 'The selected machine does not support add-ons.';
  end if;

  select count(*)
    into v_valid_count
  from jsonb_each_text(v_requested) as requested(addon_id, selected_quantity)
  join public.machine_addons as relation
    on relation.addon_id = requested.addon_id::uuid
   and relation.machine_id = v_machine.id
   and relation.active
  join public.addons as addon
    on addon.id = relation.addon_id
   and addon.active;

  if v_valid_count <> v_requested_count then
    raise exception 'One or more selected add-ons are not compatible with the machine.';
  end if;

  if exists (
    select 1
    from jsonb_each_text(v_requested) as requested(addon_id, selected_quantity)
    join public.machine_addons as relation
      on relation.addon_id = requested.addon_id::uuid
     and relation.machine_id = v_machine.id
     and relation.active
    join public.addons as addon
      on addon.id = relation.addon_id
     and addon.active
    where addon.calculation_type in ('FIXED'::public.addon_calculation_type, 'PER_BASE'::public.addon_calculation_type)
      and requested.selected_quantity <> '1'
  ) then
    raise exception 'FIXED and PER_BASE add-ons must be selected once.';
  end if;

  if exists (
    select 1
    from public.machine_addons as relation
    join public.addons as addon on addon.id = relation.addon_id
    where relation.machine_id = v_machine.id
      and relation.active
      and addon.active
      and addon.required
      and not (v_requested ? addon.id::text)
  ) then
    raise exception 'A required add-on is missing.';
  end if;

  if v_machine.number_of_bases is null and exists (
    select 1
    from jsonb_each_text(v_requested) as requested(addon_id, selected_quantity)
    join public.addons as addon on addon.id = requested.addon_id::uuid
    where addon.calculation_type = 'PER_BASE'::public.addon_calculation_type
  ) then
    raise exception 'A PER_BASE add-on requires a machine with number_of_bases.';
  end if;

  with configuration_lines as (
    select
      addon.id as addon_id,
      addon.name as addon_name,
      coalesce(relation.description_override, addon.description) as addon_description,
      addon.calculation_type,
      coalesce(relation.unit_price_override, addon.unit_price) as effective_unit_price,
      case addon.calculation_type
        when 'PER_BASE'::public.addon_calculation_type then v_machine.number_of_bases
        else requested.selected_quantity::integer
      end as quantity
    from jsonb_each_text(v_requested) as requested(addon_id, selected_quantity)
    join public.machine_addons as relation
      on relation.addon_id = requested.addon_id::uuid
     and relation.machine_id = v_machine.id
     and relation.active
    join public.addons as addon
      on addon.id = relation.addon_id
     and addon.active
  )
  select
    coalesce(sum(effective_unit_price * quantity), 0),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'addon_id', addon_id,
          'name', addon_name,
          'description', addon_description,
          'calculation_type', calculation_type,
          'unit_price', effective_unit_price,
          'quantity', quantity,
          'line_total', effective_unit_price * quantity
        )
        order by addon_name
      ),
      '[]'::jsonb
    )
    into v_addon_total, v_addon_lines
  from configuration_lines;

  return query
  select
    v_machine.id,
    v_machine.name,
    v_machine.slug,
    v_machine.base_price,
    v_machine.number_of_bases,
    v_machine.delivery_policy,
    v_machine.base_price + v_addon_total,
    v_addon_lines;
end;
$$;

-- Keep the old internal helper signature deterministic for any existing callers.
create or replace function public.quote_configuration(
  p_machine_id uuid,
  p_addon_ids uuid[]
)
returns table (
  machine_id uuid,
  machine_name text,
  machine_slug text,
  machine_base_price numeric,
  machine_number_of_bases integer,
  subtotal numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantities jsonb;
begin
  select coalesce(jsonb_object_agg(selected.addon_id::text, 1), '{}'::jsonb)
    into v_quantities
  from unnest(coalesce(p_addon_ids, '{}'::uuid[])) as selected(addon_id);

  return query
  select
    configuration.machine_id,
    configuration.machine_name,
    configuration.machine_slug,
    configuration.machine_base_price,
    configuration.machine_number_of_bases,
    configuration.subtotal
  from public.quote_configuration(p_machine_id, v_quantities) as configuration;
end;
$$;

drop function if exists public.preview_quote_coupon(uuid, uuid[], text);

create or replace function public.preview_quote_coupon(
  p_machine_id uuid,
  p_addon_quantities jsonb,
  p_coupon_code text
)
returns table (
  subtotal numeric,
  discount_amount numeric,
  total numeric,
  coupon_code text,
  coupon_name text,
  coupon_discount_type public.coupon_discount_type,
  coupon_discount_value numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := (select auth.uid());
  v_seller_role public.profile_role;
  v_configuration record;
  v_coupon record;
begin
  if v_seller_id is null then
    raise exception 'Authentication is required to validate a coupon.';
  end if;

  select profile.role
    into v_seller_role
  from public.profiles as profile
  where profile.id = v_seller_id
    and profile.active;

  if v_seller_role is distinct from 'seller'::public.profile_role then
    raise exception 'Only active sellers can validate coupons.';
  end if;

  select *
    into v_configuration
  from public.quote_configuration(p_machine_id, p_addon_quantities);

  select *
    into v_coupon
  from public.resolve_coupon_discount(
    v_configuration.machine_id,
    v_configuration.subtotal,
    p_coupon_code
  );

  return query
  select
    v_configuration.subtotal,
    v_coupon.discount_amount,
    v_configuration.subtotal - v_coupon.discount_amount,
    v_coupon.coupon_code,
    v_coupon.coupon_name,
    v_coupon.coupon_discount_type,
    v_coupon.coupon_discount_value;
end;
$$;

drop function if exists public.create_quote(
  uuid,
  uuid[],
  text,
  text,
  text,
  text,
  public.quote_delivery_type,
  text,
  uuid,
  text
);

create or replace function public.create_quote(
  p_machine_id uuid,
  p_addon_quantities jsonb,
  p_customer_name text,
  p_customer_company text,
  p_customer_whatsapp text,
  p_customer_email text,
  p_delivery_type public.quote_delivery_type,
  p_coupon_code text,
  p_client_generated_id uuid default null,
  p_client_generated_folio text default null
)
returns table (quote_id uuid, folio text, total numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := (select auth.uid());
  v_seller_role public.profile_role;
  v_configuration record;
  v_customer_id uuid;
  v_quote_id uuid;
  v_folio text;
  v_customer_name text;
  v_customer_company text;
  v_customer_whatsapp text;
  v_customer_email text;
  v_delivery_note text;
  v_discount_amount numeric(12, 2) := 0;
  v_coupon_code_snapshot text;
  v_coupon_name_snapshot text;
  v_coupon_discount_type_snapshot public.coupon_discount_type;
  v_coupon_discount_value_snapshot numeric(12, 2);
  v_total numeric(12, 2);
  v_attempt integer;
  v_existing_quote record;
begin
  if v_seller_id is null then
    raise exception 'Authentication is required to create a quote.';
  end if;

  select profile.role
    into v_seller_role
  from public.profiles as profile
  where profile.id = v_seller_id
    and profile.active;

  if v_seller_role is distinct from 'seller'::public.profile_role then
    raise exception 'Only active sellers can create quotes.';
  end if;

  if p_client_generated_id is not null then
    select quote.id, quote.folio, quote.total, quote.seller_id
      into v_existing_quote
    from public.quotes as quote
    where quote.client_generated_id = p_client_generated_id;

    if found then
      if v_existing_quote.seller_id <> v_seller_id then
        raise exception 'The client-generated quote identifier belongs to another seller.';
      end if;

      return query
      select v_existing_quote.id, v_existing_quote.folio, v_existing_quote.total;
      return;
    end if;
  end if;

  if p_client_generated_folio is not null
    and upper(btrim(p_client_generated_folio)) !~ '^NH-[0-9]{6}-[A-F0-9]{6}$' then
    raise exception 'The client-generated quote folio is not valid.';
  end if;

  v_customer_name := btrim(coalesce(p_customer_name, ''));
  v_customer_company := nullif(btrim(coalesce(p_customer_company, '')), '');
  v_customer_whatsapp := regexp_replace(
    btrim(coalesce(p_customer_whatsapp, '')),
    '[^0-9]',
    '',
    'g'
  );
  v_customer_email := nullif(lower(btrim(coalesce(p_customer_email, ''))), '');

  if char_length(v_customer_name) = 0 then
    raise exception 'Customer name is required.';
  end if;

  if char_length(v_customer_whatsapp) < 7
    or char_length(v_customer_whatsapp) > 15 then
    raise exception 'WhatsApp must contain between 7 and 15 digits.';
  end if;

  if v_customer_email is not null
    and position('@' in v_customer_email) = 0 then
    raise exception 'Customer email is not valid.';
  end if;

  if p_delivery_type is null then
    raise exception 'A delivery type is required.';
  end if;

  select *
    into v_configuration
  from public.quote_configuration(p_machine_id, p_addon_quantities);

  if v_configuration.machine_delivery_policy = 'INSTALLATION_REQUIRED'::public.machine_delivery_policy
    and p_delivery_type <> 'INSTALLATION'::public.quote_delivery_type then
    raise exception 'Installation is required for the selected machine.';
  end if;

  if v_configuration.machine_delivery_policy = 'SHIPPING_ONLY'::public.machine_delivery_policy
    and p_delivery_type <> 'SHIPPING'::public.quote_delivery_type then
    raise exception 'Shipping is required for the selected machine.';
  end if;

  if nullif(upper(btrim(coalesce(p_coupon_code, ''))), '') is not null then
    select
      resolved.coupon_code,
      resolved.coupon_name,
      resolved.coupon_discount_type,
      resolved.coupon_discount_value,
      resolved.discount_amount
      into
        v_coupon_code_snapshot,
        v_coupon_name_snapshot,
        v_coupon_discount_type_snapshot,
        v_coupon_discount_value_snapshot,
        v_discount_amount
    from public.resolve_coupon_discount(
      v_configuration.machine_id,
      v_configuration.subtotal,
      p_coupon_code
    ) as resolved;
  end if;

  v_total := v_configuration.subtotal - v_discount_amount;
  v_delivery_note := case p_delivery_type
    when 'SHIPPING' then 'Por cotizar'
    when 'INSTALLATION' then 'Por cotizar'
    when 'LATER' then 'Por definir'
  end;

  insert into public.customers (
    name,
    company,
    whatsapp,
    email,
    created_by
  )
  values (
    v_customer_name,
    v_customer_company,
    v_customer_whatsapp,
    v_customer_email,
    v_seller_id
  )
  returning id into v_customer_id;

  for v_attempt in 1..5 loop
    v_folio := coalesce(
      nullif(upper(btrim(p_client_generated_folio)), ''),
      format(
        'NH-%s-%s',
        to_char(current_date, 'YYMMDD'),
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
      )
    );

    begin
      insert into public.quotes (
        folio,
        customer_id,
        seller_id,
        status,
        machine_id,
        machine_name_snapshot,
        machine_slug_snapshot,
        machine_base_price_snapshot,
        machine_number_of_bases_snapshot,
        delivery_type,
        delivery_note,
        subtotal,
        discount_amount,
        total,
        coupon_code_snapshot,
        coupon_name_snapshot,
        coupon_discount_type_snapshot,
        coupon_discount_value_snapshot,
        notes,
        client_generated_id
      )
      values (
        v_folio,
        v_customer_id,
        v_seller_id,
        'CREATED',
        v_configuration.machine_id,
        v_configuration.machine_name,
        v_configuration.machine_slug,
        v_configuration.machine_base_price,
        v_configuration.machine_number_of_bases,
        p_delivery_type,
        v_delivery_note,
        v_configuration.subtotal,
        v_discount_amount,
        v_total,
        v_coupon_code_snapshot,
        v_coupon_name_snapshot,
        v_coupon_discount_type_snapshot,
        v_coupon_discount_value_snapshot,
        null,
        p_client_generated_id
      )
      returning id into v_quote_id;

      exit;
    exception
      when unique_violation then
        if p_client_generated_id is not null then
          select quote.id, quote.folio, quote.total, quote.seller_id
            into v_existing_quote
          from public.quotes as quote
          where quote.client_generated_id = p_client_generated_id;

          if found then
            if v_existing_quote.seller_id <> v_seller_id then
              raise exception 'The client-generated quote identifier belongs to another seller.';
            end if;

            return query
            select v_existing_quote.id, v_existing_quote.folio, v_existing_quote.total;
            return;
          end if;
        end if;

        if p_client_generated_folio is not null then
          raise exception 'The client-generated quote folio is already in use.';
        end if;

        if v_attempt = 5 then
          raise exception 'Could not generate a unique quote folio.';
        end if;
    end;
  end loop;

  insert into public.quote_addons (
    quote_id,
    addon_id,
    addon_name_snapshot,
    description_snapshot,
    calculation_type_snapshot,
    unit_price_snapshot,
    quantity,
    line_total
  )
  select
    v_quote_id,
    (line.value ->> 'addon_id')::uuid,
    line.value ->> 'name',
    nullif(line.value ->> 'description', ''),
    (line.value ->> 'calculation_type')::public.addon_calculation_type,
    (line.value ->> 'unit_price')::numeric,
    (line.value ->> 'quantity')::integer,
    (line.value ->> 'line_total')::numeric
  from jsonb_array_elements(v_configuration.addon_lines) as line(value);

  return query select v_quote_id, v_folio, v_total;
end;
$$;

revoke all on function public.quote_configuration(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.preview_quote_coupon(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.create_quote(
  uuid,
  jsonb,
  text,
  text,
  text,
  text,
  public.quote_delivery_type,
  text,
  uuid,
  text
) from public, anon, authenticated;

grant execute on function public.preview_quote_coupon(uuid, jsonb, text) to authenticated;
grant execute on function public.create_quote(
  uuid,
  jsonb,
  text,
  text,
  text,
  text,
  public.quote_delivery_type,
  text,
  uuid,
  text
) to authenticated;

do $$
declare
  v_intro_addons integer;
  v_tri_addons integer;
  v_ome_pedal integer;
  v_ome_double_time record;
begin
  select count(*)
    into v_intro_addons
  from public.machine_addons as relation
  join public.machines as machine on machine.id = relation.machine_id
  where machine.slug = 'hyro-set-intro'
    and relation.active;

  if v_intro_addons <> 1 then
    raise exception 'Hyro Set Intro must have exactly one active add-on; found %.', v_intro_addons;
  end if;

  select count(*)
    into v_tri_addons
  from public.machine_addons as relation
  join public.machines as machine on machine.id = relation.machine_id
  where machine.slug = 'hyro-set-tri-basic';

  if v_tri_addons <> 0 then
    raise exception 'Tri-Basic must not have machine_addons records; found %.', v_tri_addons;
  end if;

  select count(*)
    into v_ome_pedal
  from public.machine_addons as relation
  join public.machines as machine on machine.id = relation.machine_id
  join public.addons as addon on addon.id = relation.addon_id
  where machine.slug = 'hyro-set-omen'
    and addon.name = 'Pedal Sencillo';

  if v_ome_pedal <> 0 then
    raise exception 'OME must not be compatible with Pedal Sencillo.';
  end if;

  select relation.unit_price_override, relation.description_override
    into v_ome_double_time
  from public.machine_addons as relation
  join public.machines as machine on machine.id = relation.machine_id
  join public.addons as addon on addon.id = relation.addon_id
  where machine.slug = 'hyro-set-omen'
    and addon.name = 'Sistema de Doble Tiempo';

  if not found
    or v_ome_double_time.unit_price_override <> 28990.00
    or v_ome_double_time.description_override <> 'Incluye dos pedales, uno para cada plancha.' then
    raise exception 'OME double-time override is not configured correctly.';
  end if;
end;
$$;

commit;
