begin;

-- Existing authenticated sellers remain usable. Each receives a distinct
-- commercial salesperson record, avoiding assumptions based on display names.
with candidates as (
  select
    p.id as profile_id,
    gen_random_uuid() as salesperson_id,
    p.full_name,
    p.active
  from public.profiles as p
  where p.role = 'seller'::public.profile_role
    and p.salesperson_id is null
), inserted as (
  insert into public.salespeople (id, full_name, active, sort_order)
  select salesperson_id, full_name, active, 0
  from candidates
  returning id
)
update public.profiles as p
set salesperson_id = candidates.salesperson_id
from candidates
where p.id = candidates.profile_id
  and exists (
    select 1
    from inserted
    where inserted.id = candidates.salesperson_id
  );

update public.quotes as q
set salesperson_name_snapshot = p.full_name
from public.profiles as p
where q.seller_id = p.id
  and q.salesperson_name_snapshot is null;

update public.quotes as q
set salesperson_id = p.salesperson_id
from public.profiles as p
where q.seller_id = p.id
  and q.salesperson_id is null
  and p.salesperson_id is not null;

create function public.current_salesperson_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.salesperson_id
  from public.profiles as p
  where p.id = (select auth.uid())
    and p.role = 'seller'::public.profile_role
    and p.active
  limit 1;
$$;

revoke all on function public.current_salesperson_id() from public;
grant execute on function public.current_salesperson_id() to authenticated;

drop policy if exists "Quote creators and admins can view customers" on public.customers;
drop policy if exists "Responsible sellers creators and admins can view quotes" on public.quotes;
drop policy if exists "Quote viewers can view quote add-ons" on public.quote_addons;
drop policy if exists "Expo accounts can view active sellers" on public.profiles;
drop policy if exists "Sellers can read their own WhatsApp message states and admins can read all" on public.whatsapp_messages;
drop policy if exists "Authorized users can read their quote PDFs" on storage.objects;

create policy "Commercial quote viewers can view customers"
on public.customers
for select
to authenticated
using (
  created_by = (select auth.uid())
  or (select public.is_admin())
  or exists (
    select 1
    from public.quotes as q
    where q.customer_id = customers.id
      and (
        q.seller_id = (select auth.uid())
        or q.created_by_user_id = (select auth.uid())
        or q.salesperson_id = (select public.current_salesperson_id())
      )
  )
);

create policy "Commercial quote viewers can view quotes"
on public.quotes
for select
to authenticated
using (
  seller_id = (select auth.uid())
  or created_by_user_id = (select auth.uid())
  or salesperson_id = (select public.current_salesperson_id())
  or (select public.is_admin())
);

create policy "Commercial quote viewers can view quote add-ons"
on public.quote_addons
for select
to authenticated
using (
  exists (
    select 1
    from public.quotes as q
    where q.id = quote_addons.quote_id
      and (
        q.seller_id = (select auth.uid())
        or q.created_by_user_id = (select auth.uid())
        or q.salesperson_id = (select public.current_salesperson_id())
        or (select public.is_admin())
      )
  )
);

create policy "Commercial quote viewers can read WhatsApp states"
on public.whatsapp_messages
for select
to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1
    from public.quotes as q
    where q.id = whatsapp_messages.quote_id
      and (
        q.seller_id = (select auth.uid())
        or q.created_by_user_id = (select auth.uid())
        or q.salesperson_id = (select public.current_salesperson_id())
      )
  )
);

create policy "Commercial quote viewers can read quote PDFs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'quote-pdfs'
  and exists (
    select 1
    from public.quotes as q
    where q.id::text = (storage.foldername(name))[2]
      and (
        q.seller_id = (select auth.uid())
        or q.created_by_user_id = (select auth.uid())
        or q.salesperson_id = (select public.current_salesperson_id())
        or (select public.is_admin())
      )
  )
);

drop function if exists public.create_quote(
  uuid, jsonb, text, text, text, text, public.quote_delivery_type, text,
  uuid, text, text, uuid, uuid
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
  p_machine_image_url_snapshot text default null,
  p_machine_variant_id uuid default null,
  p_salesperson_id uuid default null
)
returns table (quote_id uuid, folio text, total numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  v_creator_id uuid := (select auth.uid());
  v_creator_role public.profile_role;
  v_creator_name text;
  v_profile_salesperson_id uuid;
  v_salesperson_id uuid;
  v_salesperson_name text;
  v_configuration record;
  v_image_url text;
  v_customer_id uuid;
  v_quote_id uuid;
  v_folio text;
  v_attempt integer;
  v_existing record;
  v_discount numeric(12,2) := 0;
  v_coupon record;
  v_coupon_code text;
  v_coupon_name text;
  v_coupon_type public.coupon_discount_type;
  v_coupon_value numeric(12,2);
  v_customer_name text := btrim(coalesce(p_customer_name, ''));
  v_customer_company text := nullif(btrim(coalesce(p_customer_company, '')), '');
  v_customer_whatsapp text := regexp_replace(btrim(coalesce(p_customer_whatsapp, '')), '[^0-9]', '', 'g');
  v_customer_email text := nullif(lower(btrim(coalesce(p_customer_email, ''))), '');
begin
  select role, full_name, salesperson_id
  into v_creator_role, v_creator_name, v_profile_salesperson_id
  from public.profiles
  where id = v_creator_id and active;

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
      -- Legacy seller profiles remain functional until an admin links them.
      v_salesperson_name := v_creator_name;
    else
      select full_name into v_salesperson_name
      from public.salespeople
      where id = v_salesperson_id and active;
      if not found then
        raise exception 'The linked salesperson is not active.';
      end if;
    end if;
  else
    if p_salesperson_id is null then
      raise exception 'An expo account must select an active salesperson.';
    end if;

    select id, full_name into v_salesperson_id, v_salesperson_name
    from public.salespeople
    where id = p_salesperson_id and active;
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
    select id, folio, total, created_by_user_id into v_existing
    from public.quotes where client_generated_id = p_client_generated_id;
    if found then
      if v_existing.created_by_user_id <> v_creator_id then
        raise exception 'The quote identifier belongs to another account.';
      end if;
      return query select v_existing.id, v_existing.folio, v_existing.total;
      return;
    end if;
  end if;

  select * into v_configuration from public.quote_variant_configuration(
    p_machine_id, p_addon_quantities, p_machine_variant_id
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
    select * into v_coupon from public.resolve_coupon_discount(
      v_configuration.machine_id, v_configuration.subtotal, p_coupon_code
    );
    v_discount := v_coupon.discount_amount;
    v_coupon_code := v_coupon.coupon_code;
    v_coupon_name := v_coupon.coupon_name;
    v_coupon_type := v_coupon.coupon_discount_type;
    v_coupon_value := v_coupon.coupon_discount_value;
  end if;

  v_image_url := nullif(btrim(coalesce(p_machine_image_url_snapshot, '')), '');
  if v_image_url is not null and v_image_url !~ '^/machines/[a-z0-9-]+\.(png|jpe?g)$' then
    raise exception 'The machine image snapshot is not valid.';
  end if;
  if v_image_url is null then
    select image_url into v_image_url from public.machines where id = v_configuration.machine_id;
  end if;

  insert into public.customers(name, company, whatsapp, email, created_by)
  values(v_customer_name, v_customer_company, v_customer_whatsapp, v_customer_email, v_creator_id)
  returning id into v_customer_id;

  for v_attempt in 1..5 loop
    v_folio := coalesce(
      nullif(upper(btrim(p_client_generated_folio)), ''),
      format('NH-%s-%s', to_char(current_date, 'YYMMDD'), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)))
    );
    begin
      insert into public.quotes(
        folio, customer_id, seller_id, created_by_user_id, salesperson_id, salesperson_name_snapshot,
        status, machine_id, machine_name_snapshot, machine_slug_snapshot, machine_base_price_snapshot,
        machine_number_of_bases_snapshot, machine_image_url_snapshot,
        machine_variant_id, machine_variant_type_snapshot, machine_variant_name_snapshot, machine_variant_price_snapshot,
        delivery_type, delivery_note, subtotal, discount_amount, total,
        coupon_code_snapshot, coupon_name_snapshot, coupon_discount_type_snapshot, coupon_discount_value_snapshot, client_generated_id
      ) values (
        v_folio, v_customer_id, v_creator_id, v_creator_id, v_salesperson_id, v_salesperson_name,
        'CREATED', v_configuration.machine_id, v_configuration.machine_name, v_configuration.machine_slug,
        v_configuration.machine_base_price, v_configuration.machine_number_of_bases, v_image_url,
        v_configuration.machine_variant_id, v_configuration.machine_variant_type, v_configuration.machine_variant_name,
        case when v_configuration.machine_variant_id is null then null else v_configuration.machine_base_price end,
        p_delivery_type, case p_delivery_type when 'LATER' then 'Por definir' else 'Por cotizar' end,
        v_configuration.subtotal, v_discount, v_configuration.subtotal - v_discount,
        v_coupon_code, v_coupon_name, v_coupon_type, v_coupon_value, p_client_generated_id
      ) returning id into v_quote_id;
      exit;
    exception when unique_violation then
      if p_client_generated_id is not null then
        select id, folio, total, created_by_user_id into v_existing
        from public.quotes where client_generated_id = p_client_generated_id;
        if found and v_existing.created_by_user_id = v_creator_id then
          return query select v_existing.id, v_existing.folio, v_existing.total;
          return;
        end if;
      end if;
      if p_client_generated_folio is not null or v_attempt = 5 then raise; end if;
    end;
  end loop;

  insert into public.quote_addons(quote_id, addon_id, addon_name_snapshot, description_snapshot, calculation_type_snapshot, unit_price_snapshot, quantity, line_total)
  select v_quote_id, (line.value->>'addon_id')::uuid, line.value->>'name', nullif(line.value->>'description',''),
    (line.value->>'calculation_type')::public.addon_calculation_type, (line.value->>'unit_price')::numeric,
    (line.value->>'quantity')::integer, (line.value->>'line_total')::numeric
  from jsonb_array_elements(v_configuration.addon_lines) as line(value);

  return query select v_quote_id, v_folio, v_configuration.subtotal - v_discount;
end;
$$;

revoke all on function public.create_quote(uuid, jsonb, text, text, text, text, public.quote_delivery_type, text, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_quote(uuid, jsonb, text, text, text, text, public.quote_delivery_type, text, uuid, text, text, uuid, uuid) to authenticated;

commit;
