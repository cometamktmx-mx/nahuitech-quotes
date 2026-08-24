begin;

alter table public.quotes
  add column if not exists machine_image_url_snapshot text;

comment on column public.quotes.machine_image_url_snapshot is
  'Image reference used when the quote was created. Historical rows may remain null.';

drop function if exists public.create_quote(
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
);

create function public.create_quote(
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
  p_machine_image_url_snapshot text default null
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
  v_machine_image_url_snapshot text;
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

  v_machine_image_url_snapshot := nullif(
    btrim(coalesce(p_machine_image_url_snapshot, '')),
    ''
  );

  if v_machine_image_url_snapshot is not null
    and v_machine_image_url_snapshot !~ '^/machines/[a-z0-9-]+\.(png|jpe?g)$' then
    raise exception 'The machine image snapshot is not valid.';
  end if;

  if v_machine_image_url_snapshot is null then
    select machine.image_url
      into v_machine_image_url_snapshot
    from public.machines as machine
    where machine.id = v_configuration.machine_id;
  end if;

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
        machine_image_url_snapshot,
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
        v_machine_image_url_snapshot,
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
  text,
  text
) from public, anon, authenticated;

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
  text,
  text
) to authenticated;

commit;
