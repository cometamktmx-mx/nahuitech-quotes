begin;

-- Independent replacement for the rolled-back 00029 migration.
-- Exact signatures include BOTH preview_quote_coupon overloads.
-- Require existing functions so CREATE OR REPLACE preserves their owners and ACLs.
-- No DROP, GRANT, REVOKE, RLS, or application data changes.
do $preflight$
declare
  signature text;
begin
  foreach signature in array array[
    'public.preview_quote_coupon(uuid,jsonb,text)',
    'public.preview_quote_coupon(uuid,jsonb,text,uuid)',
    'public.preview_multi_quote_coupon(jsonb,text)',
    'public.create_quote(uuid,jsonb,text,text,text,text,public.quote_delivery_type,text,uuid,text,text,uuid,uuid)',
    'public.create_multi_quote(jsonb,text,text,text,text,public.quote_delivery_type,text,uuid,text,uuid)'
  ] loop
    if to_regprocedure(signature) is null then
      raise exception 'Required quote function is missing: %', signature;
    end if;
  end loop;
end;
$preflight$;

-- public.preview_quote_coupon(uuid,jsonb,text)
-- Implementation preserved from 20260824000010_catalog_rules_data.sql; only the role gate changes.
CREATE OR REPLACE FUNCTION public.preview_quote_coupon(
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

  if v_seller_role is distinct from 'seller'::public.profile_role
    and v_seller_role is distinct from 'expo'::public.profile_role
    and v_seller_role is distinct from 'admin'::public.profile_role then
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

-- public.preview_quote_coupon(uuid,jsonb,text,uuid)
-- Implementation preserved from 20260825000013_expo_access_and_machine_variants.sql; only the role gate changes.
CREATE OR REPLACE FUNCTION public.preview_quote_coupon(
  p_machine_id uuid,
  p_addon_quantities jsonb,
  p_coupon_code text,
  p_machine_variant_id uuid
)
returns table (
  subtotal numeric, discount_amount numeric, total numeric, coupon_code text,
  coupon_name text, coupon_discount_type public.coupon_discount_type,
  coupon_discount_value numeric
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role public.profile_role;
  v_configuration record;
  v_coupon record;
begin
  select role into v_role from public.profiles
  where id = v_user_id and active;
  if v_role is distinct from 'seller'::public.profile_role
    and v_role is distinct from 'expo'::public.profile_role
    and v_role is distinct from 'admin'::public.profile_role then
    raise exception 'Only active seller flow accounts can validate coupons.';
  end if;
  select * into v_configuration from public.quote_variant_configuration(
    p_machine_id, p_addon_quantities, p_machine_variant_id
  );
  select * into v_coupon from public.resolve_coupon_discount(
    v_configuration.machine_id, v_configuration.subtotal, p_coupon_code
  );
  return query select v_configuration.subtotal, v_coupon.discount_amount,
    v_configuration.subtotal - v_coupon.discount_amount, v_coupon.coupon_code,
    v_coupon.coupon_name, v_coupon.coupon_discount_type, v_coupon.coupon_discount_value;
end;
$$;

-- public.preview_multi_quote_coupon(jsonb,text)
-- Implementation preserved from 20260907000022_multi_machine_quotes.sql; only the role gate changes.
CREATE OR REPLACE FUNCTION public.preview_multi_quote_coupon(p_items jsonb,p_coupon_code text)
returns table(subtotal numeric,discount_amount numeric,total numeric,coupon_code text,
 coupon_name text,coupon_discount_type public.coupon_discount_type,coupon_discount_value numeric)
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('seller','expo','admin'))
 then raise exception 'Only active seller flow accounts can validate coupons.'; end if;
 v_result:=public.multi_quote_configuration(p_items,p_coupon_code);
 return query select (v_result->>'subtotal')::numeric,(v_result->>'discount_amount')::numeric,
 (v_result->>'total')::numeric,v_result#>>'{coupon,coupon_code}',v_result#>>'{coupon,coupon_name}',
 (v_result#>>'{coupon,coupon_discount_type}')::public.coupon_discount_type,(v_result#>>'{coupon,coupon_discount_value}')::numeric;
end $$;

-- public.create_quote(uuid,jsonb,text,text,text,text,public.quote_delivery_type,text,uuid,text,text,uuid,uuid)
-- Implementation preserved from 20260905000020_machine_images.sql; only the role gate changes.
CREATE OR REPLACE FUNCTION public.create_quote(
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
    and v_creator_role is distinct from 'expo'::public.profile_role
    and v_creator_role is distinct from 'admin'::public.profile_role then
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
  if v_image_url is not null
    and v_image_url !~ '^/machines/[a-z0-9-]+\.(png|jpe?g|webp)$'
    and not exists (
      select 1 from storage.objects as image_object
      where image_object.bucket_id = 'machine-images'
        and image_object.name like 'machines/' || p_machine_id::text || '/%'
        and v_image_url ~ '^https?://[^/]+/storage/v1/object/public/machine-images/machines/[0-9a-f-]+/[0-9a-f-]+\.jpg$'
        and split_part(v_image_url, '/storage/v1/object/public/machine-images/', 2) = image_object.name
    ) then
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

-- public.create_multi_quote(jsonb,text,text,text,text,public.quote_delivery_type,text,uuid,text,uuid)
-- Implementation preserved from 20260907000022_multi_machine_quotes.sql; only the role gate changes.
CREATE OR REPLACE FUNCTION public.create_multi_quote(
  p_items jsonb,
  p_customer_name text,
  p_customer_company text,
  p_customer_whatsapp text,
  p_customer_email text,
  p_delivery_type public.quote_delivery_type,
  p_coupon_code text,
  p_client_generated_id uuid default null,
  p_client_generated_folio text default null,
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
  v_multi jsonb; v_line jsonb; v_item_id uuid; v_sort integer:=0; v_quantity integer;
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
    and v_creator_role is distinct from 'expo'::public.profile_role
    and v_creator_role is distinct from 'admin'::public.profile_role then
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
    perform pg_advisory_xact_lock(hashtextextended(p_client_generated_id::text,0));
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

  v_multi:=public.multi_quote_configuration(p_items,p_coupon_code);
  select * into v_configuration from jsonb_to_record(v_multi->'items'->0) as c(
    machine_id uuid,machine_name text,machine_slug text,machine_base_price numeric,
    machine_number_of_bases integer,machine_variant_id uuid,machine_variant_type public.machine_variant_type,
    machine_variant_name text,delivery_type public.quote_delivery_type);
  v_image_url:=v_multi#>>'{items,0,image_url}';
  v_variant_description:=v_multi#>>'{items,0,description}';
  v_discount:=(v_multi->>'discount_amount')::numeric;
  v_coupon_code:=v_multi#>>'{coupon,coupon_code}';
  v_coupon_name:=v_multi#>>'{coupon,coupon_name}';
  v_coupon_type:=(v_multi#>>'{coupon,coupon_discount_type}')::public.coupon_discount_type;
  v_coupon_value:=(v_multi#>>'{coupon,coupon_discount_value}')::numeric;
  v_total_with_tax:=(v_multi->>'total')::numeric;
  v_subtotal_before_tax:=round(v_total_with_tax/1.16,2);
  v_tax_amount:=v_total_with_tax-v_subtotal_before_tax;

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
        (v_multi->>'subtotal')::numeric,
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
    perform pg_advisory_xact_lock(hashtextextended(p_client_generated_id::text,0));
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

  for v_line in select value from jsonb_array_elements(v_multi->'items') loop
    v_quantity:=(v_line->>'quantity')::integer;
    insert into public.quote_items(quote_id,machine_id,machine_name_snapshot,machine_slug_snapshot,
      machine_image_url_snapshot,machine_number_of_bases_snapshot,machine_variant_id,
      machine_variant_type_snapshot,machine_variant_name_snapshot,machine_variant_price_snapshot,
      machine_variant_description_snapshot,quantity,unit_gross_snapshot,unit_net_snapshot,
      line_gross_total,line_net_total,delivery_type,sort_order)
    values(v_quote_id,(v_line->>'machine_id')::uuid,v_line->>'machine_name',v_line->>'machine_slug',
      v_line->>'image_url',(v_line->>'machine_number_of_bases')::integer,(v_line->>'machine_variant_id')::uuid,
      (v_line->>'machine_variant_type')::public.machine_variant_type,v_line->>'machine_variant_name',
      case when v_line->>'machine_variant_id' is null then null else (v_line->>'machine_base_price')::numeric end,
      v_line->>'description',v_quantity,(v_line->>'machine_base_price')::numeric,
      round((v_line->>'machine_base_price')::numeric/1.16,2),
      (v_line->>'subtotal')::numeric*v_quantity,round((v_line->>'subtotal')::numeric*v_quantity/1.16,2),
      (v_line->>'delivery_type')::public.quote_delivery_type,v_sort)
    returning id into v_item_id;
    insert into public.quote_addons(quote_id,quote_item_id,addon_id,addon_name_snapshot,description_snapshot,
      calculation_type_snapshot,unit_price_snapshot,quantity,line_total)
    select v_quote_id,v_item_id,(a.value->>'addon_id')::uuid,a.value->>'name',a.value->>'description',
      (a.value->>'calculation_type')::public.addon_calculation_type,(a.value->>'unit_price')::numeric,
      (a.value->>'quantity')::integer*v_quantity,(a.value->>'line_total')::numeric*v_quantity
    from jsonb_array_elements(v_line->'addon_lines') a(value);
    v_sort:=v_sort+1;
  end loop;

  return query
  select v_quote_id, v_folio, v_total_with_tax;
end;
$$;

commit;
