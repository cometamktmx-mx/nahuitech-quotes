begin;

create type public.machine_variant_type as enum ('AUTOMATIC', 'SEMI_AUTOMATIC');

create table public.machine_variants (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  variant_type public.machine_variant_type not null,
  display_name text not null,
  price numeric(12, 2),
  active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machine_variants_machine_type_unique unique (machine_id, variant_type),
  constraint machine_variants_display_name_not_blank check (char_length(btrim(display_name)) > 0),
  constraint machine_variants_price_positive_when_present check (price is null or price > 0),
  constraint machine_variants_active_requires_price check (not active or price is not null),
  constraint machine_variants_sort_order_non_negative check (sort_order >= 0)
);

create index machine_variants_active_machine_sort_idx
  on public.machine_variants(machine_id, sort_order)
  where active;

create trigger set_machine_variants_updated_at
before update on public.machine_variants
for each row execute function public.set_updated_at();

alter table public.machine_variants enable row level security;
revoke all on table public.machine_variants from public, anon, authenticated;
grant select, insert, update, delete on table public.machine_variants to authenticated;
grant usage on type public.machine_variant_type to authenticated;

create function public.is_expo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'expo'::public.profile_role
      and active
  );
$$;

revoke all on function public.is_expo() from public;
grant execute on function public.is_expo() to authenticated;

create policy "Admins can manage machine variants"
on public.machine_variants
for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "Seller flow can view machine variants"
on public.machine_variants
for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and active
      and role in ('seller'::public.profile_role, 'expo'::public.profile_role)
  )
);

create policy "Expo accounts can view active sellers"
on public.profiles
for select
to authenticated
using (
  (select public.is_expo())
  and role = 'seller'::public.profile_role
  and active
);

alter table public.quotes
  add column created_by_user_id uuid references auth.users(id),
  add column machine_variant_id uuid references public.machine_variants(id) on delete set null,
  add column machine_variant_type_snapshot public.machine_variant_type,
  add column machine_variant_name_snapshot text,
  add column machine_variant_price_snapshot numeric(12, 2);

update public.quotes
set created_by_user_id = seller_id
where created_by_user_id is null;

alter table public.quotes
  alter column created_by_user_id set not null,
  add constraint quotes_variant_snapshot_complete check (
    (machine_variant_id is null
      and machine_variant_type_snapshot is null
      and machine_variant_name_snapshot is null
      and machine_variant_price_snapshot is null)
    or
    (machine_variant_id is not null
      and machine_variant_type_snapshot is not null
      and machine_variant_name_snapshot is not null
      and char_length(btrim(machine_variant_name_snapshot)) > 0
      and machine_variant_price_snapshot is not null
      and machine_variant_price_snapshot > 0)
  );

create index quotes_created_by_user_created_at_idx
  on public.quotes(created_by_user_id, created_at desc);

comment on column public.quotes.seller_id is
  'The active seller responsible for the commercial interaction.';
comment on column public.quotes.created_by_user_id is
  'The authenticated user that technically created the quote; it can be an expo terminal account.';

drop policy if exists "Sellers can view their own customers and admins can view all customers" on public.customers;
drop policy if exists "Sellers can view their own quotes and admins can view all quotes" on public.quotes;
drop policy if exists "Sellers can view their own quote add-ons and admins can view all quote add-ons" on public.quote_addons;

create policy "Quote creators and admins can view customers"
on public.customers for select to authenticated
using (
  created_by = (select auth.uid())
  or (select public.is_admin())
  or exists (
    select 1 from public.quotes as quote
    where quote.customer_id = customers.id
      and quote.seller_id = (select auth.uid())
  )
);

create policy "Responsible sellers creators and admins can view quotes"
on public.quotes for select to authenticated
using (
  seller_id = (select auth.uid())
  or created_by_user_id = (select auth.uid())
  or (select public.is_admin())
);

create policy "Quote viewers can view quote add-ons"
on public.quote_addons for select to authenticated
using (
  exists (
    select 1 from public.quotes as quote
    where quote.id = quote_addons.quote_id
      and (
        quote.seller_id = (select auth.uid())
        or quote.created_by_user_id = (select auth.uid())
        or (select public.is_admin())
      )
  )
);

create function public.quote_variant_configuration(
  p_machine_id uuid,
  p_addon_quantities jsonb,
  p_machine_variant_id uuid default null
)
returns table (
  machine_id uuid,
  machine_name text,
  machine_slug text,
  machine_base_price numeric,
  machine_number_of_bases integer,
  machine_delivery_policy public.machine_delivery_policy,
  machine_variant_id uuid,
  machine_variant_type public.machine_variant_type,
  machine_variant_name text,
  subtotal numeric,
  addon_lines jsonb
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_configuration record;
  v_variant public.machine_variants%rowtype;
  v_has_variants boolean;
begin
  select * into v_configuration
  from public.quote_configuration(p_machine_id, p_addon_quantities);

  select exists (
    select 1 from public.machine_variants
    where machine_id = v_configuration.machine_id
  ) into v_has_variants;

  if not v_has_variants then
    if p_machine_variant_id is not null then
      raise exception 'The selected machine does not have variants.';
    end if;
    return query select
      v_configuration.machine_id, v_configuration.machine_name, v_configuration.machine_slug,
      v_configuration.machine_base_price, v_configuration.machine_number_of_bases,
      v_configuration.machine_delivery_policy, null::uuid, null::public.machine_variant_type,
      null::text, v_configuration.subtotal, v_configuration.addon_lines;
    return;
  end if;

  if p_machine_variant_id is null then
    raise exception 'A machine variant is required.';
  end if;

  select * into v_variant from public.machine_variants
  where id = p_machine_variant_id
    and machine_id = v_configuration.machine_id
    and active
    and price is not null
    and price > 0;

  if not found then
    raise exception 'The selected machine variant is not available.';
  end if;

  return query select
    v_configuration.machine_id, v_configuration.machine_name, v_configuration.machine_slug,
    v_variant.price, v_configuration.machine_number_of_bases,
    v_configuration.machine_delivery_policy, v_variant.id, v_variant.variant_type,
    v_variant.display_name,
    v_configuration.subtotal - v_configuration.machine_base_price + v_variant.price,
    v_configuration.addon_lines;
end;
$$;

create function public.preview_quote_coupon(
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
    and v_role is distinct from 'expo'::public.profile_role then
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

drop function if exists public.create_quote(uuid, jsonb, text, text, text, text, public.quote_delivery_type, text, uuid, text, text);

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
  p_seller_id uuid default null
)
returns table (quote_id uuid, folio text, total numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  v_creator_id uuid := (select auth.uid());
  v_creator_role public.profile_role;
  v_seller_id uuid;
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
  select role into v_creator_role from public.profiles where id = v_creator_id and active;
  if v_creator_role is distinct from 'seller'::public.profile_role
    and v_creator_role is distinct from 'expo'::public.profile_role then
    raise exception 'Only active seller flow accounts can create quotes.';
  end if;
  if v_creator_role = 'seller'::public.profile_role then
    if p_seller_id is not null and p_seller_id <> v_creator_id then
      raise exception 'An individual seller can only create their own quotes.';
    end if;
    v_seller_id := v_creator_id;
  else
    if p_seller_id is null then raise exception 'An expo account must select an active seller.'; end if;
    select id into v_seller_id from public.profiles
    where id = p_seller_id and role = 'seller'::public.profile_role and active;
    if not found then raise exception 'The selected seller is not available.'; end if;
  end if;
  if v_customer_name = '' or char_length(v_customer_whatsapp) not between 7 and 15 then
    raise exception 'Customer name and WhatsApp are required.';
  end if;
  if v_customer_email is not null and position('@' in v_customer_email) = 0 then
    raise exception 'Customer email is not valid.';
  end if;
  if p_client_generated_id is not null then
    select id, folio, total, created_by_user_id into v_existing from public.quotes
    where client_generated_id = p_client_generated_id;
    if found then
      if v_existing.created_by_user_id <> v_creator_id then raise exception 'The quote identifier belongs to another account.'; end if;
      return query select v_existing.id, v_existing.folio, v_existing.total; return;
    end if;
  end if;
  select * into v_configuration from public.quote_variant_configuration(
    p_machine_id, p_addon_quantities, p_machine_variant_id
  );
  if v_configuration.machine_delivery_policy = 'INSTALLATION_REQUIRED'::public.machine_delivery_policy
    and p_delivery_type <> 'INSTALLATION'::public.quote_delivery_type then raise exception 'Installation is required for the selected machine.'; end if;
  if v_configuration.machine_delivery_policy = 'SHIPPING_ONLY'::public.machine_delivery_policy
    and p_delivery_type <> 'SHIPPING'::public.quote_delivery_type then raise exception 'Shipping is required for the selected machine.'; end if;
  if nullif(upper(btrim(coalesce(p_coupon_code, ''))), '') is not null then
    select * into v_coupon from public.resolve_coupon_discount(v_configuration.machine_id, v_configuration.subtotal, p_coupon_code);
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
  if v_image_url is null then select image_url into v_image_url from public.machines where id = v_configuration.machine_id; end if;
  insert into public.customers(name, company, whatsapp, email, created_by)
  values(v_customer_name, v_customer_company, v_customer_whatsapp, v_customer_email, v_creator_id)
  returning id into v_customer_id;
  for v_attempt in 1..5 loop
    v_folio := coalesce(nullif(upper(btrim(p_client_generated_folio)), ''), format('NH-%s-%s', to_char(current_date, 'YYMMDD'), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))));
    begin
      insert into public.quotes(
        folio, customer_id, seller_id, created_by_user_id, status, machine_id,
        machine_name_snapshot, machine_slug_snapshot, machine_base_price_snapshot,
        machine_number_of_bases_snapshot, machine_image_url_snapshot,
        machine_variant_id, machine_variant_type_snapshot, machine_variant_name_snapshot, machine_variant_price_snapshot,
        delivery_type, delivery_note, subtotal, discount_amount, total,
        coupon_code_snapshot, coupon_name_snapshot, coupon_discount_type_snapshot, coupon_discount_value_snapshot, client_generated_id
      ) values (
        v_folio, v_customer_id, v_seller_id, v_creator_id, 'CREATED', v_configuration.machine_id,
        v_configuration.machine_name, v_configuration.machine_slug, v_configuration.machine_base_price,
        v_configuration.machine_number_of_bases, v_image_url,
        v_configuration.machine_variant_id, v_configuration.machine_variant_type, v_configuration.machine_variant_name,
        case when v_configuration.machine_variant_id is null then null else v_configuration.machine_base_price end,
        p_delivery_type, case p_delivery_type when 'LATER' then 'Por definir' else 'Por cotizar' end,
        v_configuration.subtotal, v_discount, v_configuration.subtotal - v_discount,
        v_coupon_code, v_coupon_name, v_coupon_type, v_coupon_value, p_client_generated_id
      ) returning id into v_quote_id;
      exit;
    exception when unique_violation then
      if p_client_generated_id is not null then
        select id, folio, total, created_by_user_id into v_existing from public.quotes where client_generated_id = p_client_generated_id;
        if found and v_existing.created_by_user_id = v_creator_id then return query select v_existing.id, v_existing.folio, v_existing.total; return; end if;
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

revoke all on function public.quote_variant_configuration(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.preview_quote_coupon(uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.create_quote(uuid, jsonb, text, text, text, text, public.quote_delivery_type, text, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.preview_quote_coupon(uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.create_quote(uuid, jsonb, text, text, text, text, public.quote_delivery_type, text, uuid, text, text, uuid, uuid) to authenticated;

commit;
