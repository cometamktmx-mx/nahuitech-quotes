begin;

alter table public.machines
  add column if not exists variant_selection_required boolean not null default true,
  add column if not exists allowed_variant_types public.machine_variant_type[] not null default array[
    'AUTOMATIC'::public.machine_variant_type,
    'SEMI_AUTOMATIC'::public.machine_variant_type
  ];

alter table public.machine_variants
  add column if not exists description text;

alter table public.quotes
  add column if not exists machine_variant_description_snapshot text,
  add column if not exists subtotal_before_tax_snapshot numeric(12, 2),
  add column if not exists tax_rate_snapshot numeric(5, 4),
  add column if not exists tax_amount_snapshot numeric(12, 2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'machines_allowed_variant_types_not_empty'
      and conrelid = 'public.machines'::regclass
  ) then
    alter table public.machines
      add constraint machines_allowed_variant_types_not_empty
      check (cardinality(allowed_variant_types) > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotes_tax_snapshot_consistency'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_tax_snapshot_consistency check (
        (
          subtotal_before_tax_snapshot is null
          and tax_rate_snapshot is null
          and tax_amount_snapshot is null
        )
        or (
          subtotal_before_tax_snapshot is not null
          and tax_rate_snapshot = 0.1600
          and tax_amount_snapshot is not null
          and subtotal_before_tax_snapshot >= 0
          and tax_amount_snapshot >= 0
          and round(subtotal_before_tax_snapshot + tax_amount_snapshot, 2) = round(total, 2)
        )
      );
  end if;
end;
$$;

comment on column public.machines.variant_selection_required is
  'When false, one permitted active variant may be selected explicitly by the seller flow without rendering a version chooser.';

comment on column public.machines.allowed_variant_types is
  'Commercially permitted machine variant types. Active variants outside this list are rejected.';

comment on column public.machine_variants.description is
  'Customer-facing commercial description for this exact machine version.';

comment on column public.quotes.machine_variant_description_snapshot is
  'Historical commercial version description shown in quote detail and PDF. It is never rebuilt from the catalog.';

comment on column public.quotes.subtotal_before_tax_snapshot is
  'Tax-exclusive portion of the final commercial total, calculated after any coupon discount.';

comment on column public.quotes.tax_rate_snapshot is
  'Included VAT rate used to break down the final commercial total.';

comment on column public.quotes.tax_amount_snapshot is
  'Included VAT amount calculated from the final commercial total.';

create or replace function public.validate_machine_variant_allowed_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed_variant_types public.machine_variant_type[];
begin
  select machine.allowed_variant_types
    into v_allowed_variant_types
  from public.machines as machine
  where machine.id = new.machine_id;

  if not found then
    raise exception 'The selected machine does not exist.';
  end if;

  if new.active and not (new.variant_type = any(v_allowed_variant_types)) then
    raise exception 'This machine does not allow the selected variant type.';
  end if;

  return new;
end;
$$;

create or replace function public.validate_machine_allowed_variant_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.machine_variants as machine_variant
    where machine_variant.machine_id = new.id
      and machine_variant.active
      and not (machine_variant.variant_type = any(new.allowed_variant_types))
  ) then
    raise exception 'A machine cannot disallow an active variant.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_machine_variant_allowed_type on public.machine_variants;
create trigger validate_machine_variant_allowed_type
before insert or update of machine_id, variant_type, active on public.machine_variants
for each row execute function public.validate_machine_variant_allowed_type();

drop trigger if exists validate_machine_allowed_variant_types on public.machines;
create trigger validate_machine_allowed_variant_types
before update of allowed_variant_types on public.machines
for each row execute function public.validate_machine_allowed_variant_types();

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
  p_client_generated_folio text default null,
  p_machine_image_url_snapshot text default null,
  p_machine_variant_id uuid default null,
  p_salesperson_id uuid default null
)
returns table (quote_id uuid, folio text, total numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid := (select auth.uid());
  v_creator_role public.profile_role;
  v_creator_name text;
  v_profile_salesperson_id uuid;
  v_salesperson_id uuid;
  v_salesperson_name text;
  v_configuration record;
  v_variant_description text;
  v_image_url text;
  v_customer_id uuid;
  v_quote_id uuid;
  v_folio text;
  v_attempt integer;
  v_existing record;
  v_discount numeric(12, 2) := 0;
  v_total_with_tax numeric(12, 2);
  v_subtotal_before_tax numeric(12, 2);
  v_tax_amount numeric(12, 2);
  v_coupon record;
  v_coupon_code text;
  v_coupon_name text;
  v_coupon_type public.coupon_discount_type;
  v_coupon_value numeric(12, 2);
  v_customer_name text := btrim(coalesce(p_customer_name, ''));
  v_customer_company text := nullif(btrim(coalesce(p_customer_company, '')), '');
  v_customer_whatsapp text := regexp_replace(btrim(coalesce(p_customer_whatsapp, '')), '[^0-9]', '', 'g');
  v_customer_email text := nullif(lower(btrim(coalesce(p_customer_email, ''))), '');
begin
  select profile.role, profile.full_name, profile.salesperson_id
    into v_creator_role, v_creator_name, v_profile_salesperson_id
  from public.profiles as profile
  where profile.id = v_creator_id
    and profile.active;

  if v_creator_role is distinct from 'seller'::public.profile_role
    and v_creator_role is distinct from 'expo'::public.profile_role then
    raise exception 'Only active seller flow accounts can create quotes.';
  end if;

  if v_creator_role = 'seller'::public.profile_role then
    if p_salesperson_id is not null
      and (v_profile_salesperson_id is null or p_salesperson_id <> v_profile_salesperson_id) then
      raise exception 'An individual seller can only use their linked salesperson.';
    end if;

    v_salesperson_id := v_profile_salesperson_id;

    if v_salesperson_id is null then
      v_salesperson_name := v_creator_name;
    else
      select salesperson.full_name
        into v_salesperson_name
      from public.salespeople as salesperson
      where salesperson.id = v_salesperson_id
        and salesperson.active;

      if not found then
        raise exception 'The linked salesperson is not active.';
      end if;
    end if;
  else
    if p_salesperson_id is null then
      raise exception 'An expo account must select an active salesperson.';
    end if;

    select salesperson.id, salesperson.full_name
      into v_salesperson_id, v_salesperson_name
    from public.salespeople as salesperson
    where salesperson.id = p_salesperson_id
      and salesperson.active;

    if not found then
      raise exception 'The selected salesperson is not available.';
    end if;
  end if;

  if v_customer_name = '' or char_length(v_customer_whatsapp) not between 7 and 15 then
    raise exception 'Customer name and WhatsApp are required.';
  end if;

  if v_customer_email is not null and position('@' in v_customer_email) = 0 then
    raise exception 'Customer email is not valid.';
  end if;

  if p_client_generated_id is not null then
    select existing_quote.id,
           existing_quote.folio,
           existing_quote.total,
           existing_quote.created_by_user_id
      into v_existing
    from public.quotes as existing_quote
    where existing_quote.client_generated_id = p_client_generated_id;

    if found then
      if v_existing.created_by_user_id <> v_creator_id then
        raise exception 'The quote identifier belongs to another account.';
      end if;

      return query
      select v_existing.id, v_existing.folio, v_existing.total;
      return;
    end if;
  end if;

  select *
    into v_configuration
  from public.quote_variant_configuration(
    p_machine_id,
    p_addon_quantities,
    p_machine_variant_id
  );

  if v_configuration.machine_delivery_policy = 'INSTALLATION_REQUIRED'::public.machine_delivery_policy
    and p_delivery_type <> 'INSTALLATION'::public.quote_delivery_type then
    raise exception 'Installation is required for the selected machine.';
  end if;

  if v_configuration.machine_delivery_policy = 'SHIPPING_ONLY'::public.machine_delivery_policy
    and p_delivery_type <> 'SHIPPING'::public.quote_delivery_type then
    raise exception 'Shipping is required for the selected machine.';
  end if;

  if nullif(upper(btrim(coalesce(p_coupon_code, ''))), '') is not null then
    select *
      into v_coupon
    from public.resolve_coupon_discount(
      v_configuration.machine_id,
      v_configuration.subtotal,
      p_coupon_code
    );
    v_discount := v_coupon.discount_amount;
    v_coupon_code := v_coupon.coupon_code;
    v_coupon_name := v_coupon.coupon_name;
    v_coupon_type := v_coupon.coupon_discount_type;
    v_coupon_value := v_coupon.coupon_discount_value;
  end if;

  v_total_with_tax := round(v_configuration.subtotal - v_discount, 2);
  v_subtotal_before_tax := round(v_total_with_tax / 1.16, 2);
  v_tax_amount := round(v_total_with_tax - v_subtotal_before_tax, 2);

  if v_configuration.machine_variant_id is not null then
    select machine_variant.description
      into v_variant_description
    from public.machine_variants as machine_variant
    where machine_variant.id = v_configuration.machine_variant_id;
  end if;

  v_image_url := nullif(btrim(coalesce(p_machine_image_url_snapshot, '')), '');
  if v_image_url is not null and v_image_url !~ '^/machines/[a-z0-9-]+\.(png|jpe?g)$' then
    raise exception 'The machine image snapshot is not valid.';
  end if;

  if v_image_url is null then
    select machine.image_url
      into v_image_url
    from public.machines as machine
    where machine.id = v_configuration.machine_id;
  end if;

  insert into public.customers as customer (name, company, whatsapp, email, created_by)
  values (v_customer_name, v_customer_company, v_customer_whatsapp, v_customer_email, v_creator_id)
  returning customer.id into v_customer_id;

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
      insert into public.quotes as created_quote (
        folio,
        customer_id,
        seller_id,
        created_by_user_id,
        salesperson_id,
        salesperson_name_snapshot,
        status,
        machine_id,
        machine_name_snapshot,
        machine_slug_snapshot,
        machine_base_price_snapshot,
        machine_number_of_bases_snapshot,
        machine_image_url_snapshot,
        machine_variant_id,
        machine_variant_type_snapshot,
        machine_variant_name_snapshot,
        machine_variant_price_snapshot,
        machine_variant_description_snapshot,
        delivery_type,
        delivery_note,
        subtotal,
        discount_amount,
        total,
        subtotal_before_tax_snapshot,
        tax_rate_snapshot,
        tax_amount_snapshot,
        coupon_code_snapshot,
        coupon_name_snapshot,
        coupon_discount_type_snapshot,
        coupon_discount_value_snapshot,
        client_generated_id
      ) values (
        v_folio,
        v_customer_id,
        v_creator_id,
        v_creator_id,
        v_salesperson_id,
        v_salesperson_name,
        'CREATED',
        v_configuration.machine_id,
        v_configuration.machine_name,
        v_configuration.machine_slug,
        v_configuration.machine_base_price,
        v_configuration.machine_number_of_bases,
        v_image_url,
        v_configuration.machine_variant_id,
        v_configuration.machine_variant_type,
        v_configuration.machine_variant_name,
        case
          when v_configuration.machine_variant_id is null then null
          else v_configuration.machine_base_price
        end,
        v_variant_description,
        p_delivery_type,
        case p_delivery_type
          when 'LATER' then 'Por definir'
          else 'Por cotizar'
        end,
        v_configuration.subtotal,
        v_discount,
        v_total_with_tax,
        v_subtotal_before_tax,
        0.1600,
        v_tax_amount,
        v_coupon_code,
        v_coupon_name,
        v_coupon_type,
        v_coupon_value,
        p_client_generated_id
      ) returning created_quote.id into v_quote_id;
      exit;
    exception when unique_violation then
      if p_client_generated_id is not null then
        select existing_quote.id,
               existing_quote.folio,
               existing_quote.total,
               existing_quote.created_by_user_id
          into v_existing
        from public.quotes as existing_quote
        where existing_quote.client_generated_id = p_client_generated_id;

        if found and v_existing.created_by_user_id = v_creator_id then
          return query
          select v_existing.id, v_existing.folio, v_existing.total;
          return;
        end if;
      end if;

      if p_client_generated_folio is not null or v_attempt = 5 then
        raise;
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

  return query
  select v_quote_id, v_folio, v_total_with_tax;
end;
$$;

revoke all on function public.create_quote(
  uuid, jsonb, text, text, text, text, public.quote_delivery_type, text,
  uuid, text, text, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.create_quote(
  uuid, jsonb, text, text, text, text, public.quote_delivery_type, text,
  uuid, text, text, uuid, uuid
) to authenticated;

commit;
