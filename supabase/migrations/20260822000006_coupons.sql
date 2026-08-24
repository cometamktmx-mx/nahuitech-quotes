begin;

create type public.coupon_discount_type as enum (
  'FIXED_AMOUNT',
  'PERCENTAGE'
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  description text,
  discount_type public.coupon_discount_type not null,
  discount_value numeric(12, 2) not null,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  event_name text,
  applies_to_all_machines boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_name_not_blank check (char_length(btrim(name)) > 0),
  constraint coupons_code_normalized check (code = upper(btrim(code))),
  constraint coupons_code_format check (code ~ '^[A-Z0-9-]+$'),
  constraint coupons_discount_value_positive check (discount_value > 0),
  constraint coupons_percentage_limit check (
    discount_type <> 'PERCENTAGE'::public.coupon_discount_type
    or discount_value <= 100
  ),
  constraint coupons_date_range check (
    starts_at is null
    or ends_at is null
    or starts_at <= ends_at
  )
);

create table public.coupon_machines (
  coupon_id uuid not null references public.coupons (id) on delete cascade,
  machine_id uuid not null references public.machines (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (coupon_id, machine_id)
);

alter table public.quotes
  add column coupon_name_snapshot text,
  add column coupon_discount_type_snapshot public.coupon_discount_type,
  add column coupon_discount_value_snapshot numeric(12, 2);

alter table public.quotes
  add constraint quotes_coupon_snapshot_complete check (
    (
      coupon_code_snapshot is null
      and coupon_name_snapshot is null
      and coupon_discount_type_snapshot is null
      and coupon_discount_value_snapshot is null
    )
    or (
      coupon_code_snapshot is not null
      and coupon_name_snapshot is not null
      and coupon_discount_type_snapshot is not null
      and coupon_discount_value_snapshot is not null
      and coupon_discount_value_snapshot > 0
    )
  );

create index coupons_active_code_idx on public.coupons (active, code);
create index coupon_machines_machine_id_idx on public.coupon_machines (machine_id);

create trigger set_coupons_updated_at
before update on public.coupons
for each row execute function public.set_updated_at();

comment on table public.coupons is
  'Expo promotions. Machine applicability is represented by coupon_machines when applies_to_all_machines is false.';

comment on column public.quotes.coupon_code_snapshot is
  'Historical coupon code. It is not resolved from the live coupon catalog.';

comment on column public.quotes.coupon_name_snapshot is
  'Historical promotion name. It is preserved if a coupon is edited or deleted later.';

alter table public.coupons enable row level security;
alter table public.coupon_machines enable row level security;

revoke all on table public.coupons, public.coupon_machines from public;
revoke all on table public.coupons, public.coupon_machines from anon, authenticated;

grant select, insert, update, delete on table public.coupons, public.coupon_machines to authenticated;
grant usage on type public.coupon_discount_type to authenticated;

create policy "Admin and seller coupon read"
on public.coupons
for select
to authenticated
using ((select public.is_admin()) or active);

create policy "Admin coupon insert"
on public.coupons
for insert
to authenticated
with check ((select public.is_admin()));

create policy "Admin coupon update"
on public.coupons
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "Admin coupon delete"
on public.coupons
for delete
to authenticated
using ((select public.is_admin()));

create policy "Admin and seller coupon machine read"
on public.coupon_machines
for select
to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1
    from public.coupons as c
    where c.id = coupon_machines.coupon_id
      and c.active
  )
);

create policy "Admin coupon machine insert"
on public.coupon_machines
for insert
to authenticated
with check ((select public.is_admin()));

create policy "Admin coupon machine update"
on public.coupon_machines
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "Admin coupon machine delete"
on public.coupon_machines
for delete
to authenticated
using ((select public.is_admin()));

create function public.quote_configuration(
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
  v_machine public.machines%rowtype;
  v_selected_addon_ids uuid[];
  v_unique_addon_ids uuid[];
  v_valid_addon_count integer;
  v_addon_subtotal numeric(12, 2);
begin
  select *
    into v_machine
  from public.machines as m
  where m.id = p_machine_id
    and m.active;

  if not found then
    raise exception 'The selected machine is not available.';
  end if;

  v_selected_addon_ids := coalesce(p_addon_ids, '{}'::uuid[]);

  if exists (
    select 1
    from unnest(v_selected_addon_ids) as selected(addon_id)
    where selected.addon_id is null
  ) then
    raise exception 'An add-on identifier is invalid.';
  end if;

  select coalesce(array_agg(distinct selected.addon_id), '{}'::uuid[])
    into v_unique_addon_ids
  from unnest(v_selected_addon_ids) as selected(addon_id);

  if cardinality(v_unique_addon_ids) <> cardinality(v_selected_addon_ids) then
    raise exception 'Selected add-ons cannot be duplicated.';
  end if;

  if not v_machine.supports_addons
    and cardinality(v_selected_addon_ids) > 0 then
    raise exception 'The selected machine does not support add-ons.';
  end if;

  select count(*)
    into v_valid_addon_count
  from public.machine_addons as ma
  join public.addons as a on a.id = ma.addon_id
  where ma.machine_id = v_machine.id
    and ma.active
    and a.active
    and a.id = any(v_selected_addon_ids);

  if v_valid_addon_count <> cardinality(v_selected_addon_ids) then
    raise exception 'One or more selected add-ons are not compatible with the machine.';
  end if;

  if exists (
    select 1
    from public.machine_addons as ma
    join public.addons as a on a.id = ma.addon_id
    where ma.machine_id = v_machine.id
      and ma.active
      and a.active
      and a.required
      and not (a.id = any(v_selected_addon_ids))
  ) then
    raise exception 'A required add-on is missing.';
  end if;

  if v_machine.number_of_bases is null and exists (
    select 1
    from public.machine_addons as ma
    join public.addons as a on a.id = ma.addon_id
    where ma.machine_id = v_machine.id
      and ma.active
      and a.active
      and a.id = any(v_selected_addon_ids)
      and a.calculation_type = 'PER_BASE'
  ) then
    raise exception 'A PER_BASE add-on requires a machine with number_of_bases.';
  end if;

  select coalesce(
    sum(
      a.unit_price * case
        when a.calculation_type = 'PER_BASE' then v_machine.number_of_bases
        else 1
      end
    ),
    0
  )
    into v_addon_subtotal
  from public.machine_addons as ma
  join public.addons as a on a.id = ma.addon_id
  where ma.machine_id = v_machine.id
    and ma.active
    and a.active
    and a.id = any(v_selected_addon_ids);

  return query
  select
    v_machine.id,
    v_machine.name,
    v_machine.slug,
    v_machine.base_price,
    v_machine.number_of_bases,
    v_machine.base_price + v_addon_subtotal;
end;
$$;

create function public.resolve_coupon_discount(
  p_machine_id uuid,
  p_subtotal numeric,
  p_coupon_code text
)
returns table (
  coupon_id uuid,
  coupon_code text,
  coupon_name text,
  coupon_discount_type public.coupon_discount_type,
  coupon_discount_value numeric,
  discount_amount numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coupon public.coupons%rowtype;
  v_code text := nullif(upper(btrim(coalesce(p_coupon_code, ''))), '');
begin
  if p_subtotal is null or p_subtotal < 0 then
    raise exception 'The quote subtotal is invalid.';
  end if;

  if v_code is null then
    raise exception 'A coupon code is required.';
  end if;

  select *
    into v_coupon
  from public.coupons as c
  where c.code = v_code;

  if not found then
    raise exception 'Coupon code was not found.';
  end if;

  if not v_coupon.active then
    raise exception 'Coupon is inactive.';
  end if;

  if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    raise exception 'Coupon is not active yet.';
  end if;

  if v_coupon.ends_at is not null and now() > v_coupon.ends_at then
    raise exception 'Coupon has expired.';
  end if;

  if not v_coupon.applies_to_all_machines and not exists (
    select 1
    from public.coupon_machines as cm
    where cm.coupon_id = v_coupon.id
      and cm.machine_id = p_machine_id
  ) then
    raise exception 'Coupon is not valid for the selected machine.';
  end if;

  return query
  select
    v_coupon.id,
    v_coupon.code,
    v_coupon.name,
    v_coupon.discount_type,
    v_coupon.discount_value,
    case v_coupon.discount_type
      when 'PERCENTAGE'::public.coupon_discount_type then round(
        p_subtotal * v_coupon.discount_value / 100,
        2
      )
      when 'FIXED_AMOUNT'::public.coupon_discount_type then least(
        v_coupon.discount_value,
        p_subtotal
      )
    end;
end;
$$;

create function public.preview_quote_coupon(
  p_machine_id uuid,
  p_addon_ids uuid[],
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

  select p.role
    into v_seller_role
  from public.profiles as p
  where p.id = v_seller_id
    and p.active;

  if v_seller_role is distinct from 'seller'::public.profile_role then
    raise exception 'Only active sellers can validate coupons.';
  end if;

  select *
    into v_configuration
  from public.quote_configuration(p_machine_id, p_addon_ids);

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

drop function public.create_quote(
  uuid,
  uuid[],
  text,
  text,
  text,
  text,
  public.quote_delivery_type
);

create function public.create_quote(
  p_machine_id uuid,
  p_addon_ids uuid[],
  p_customer_name text,
  p_customer_company text,
  p_customer_whatsapp text,
  p_customer_email text,
  p_delivery_type public.quote_delivery_type,
  p_coupon_code text
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
  v_selected_addon_ids uuid[];
  v_discount_amount numeric(12, 2) := 0;
  v_coupon_code_snapshot text;
  v_coupon_name_snapshot text;
  v_coupon_discount_type_snapshot public.coupon_discount_type;
  v_coupon_discount_value_snapshot numeric(12, 2);
  v_total numeric(12, 2);
  v_attempt integer;
begin
  if v_seller_id is null then
    raise exception 'Authentication is required to create a quote.';
  end if;

  select p.role
    into v_seller_role
  from public.profiles as p
  where p.id = v_seller_id
    and p.active;

  if v_seller_role is distinct from 'seller'::public.profile_role then
    raise exception 'Only active sellers can create quotes.';
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

  v_selected_addon_ids := coalesce(p_addon_ids, '{}'::uuid[]);

  select *
    into v_configuration
  from public.quote_configuration(p_machine_id, v_selected_addon_ids);

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
    when 'LATER' then 'Definir despuÃ©s'
  end;

  if p_delivery_type = 'LATER' then
    v_delivery_note := 'Definir despues';
  end if;

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
    v_folio := format(
      'NH-%s-%s',
      to_char(current_date, 'YYMMDD'),
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
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
        notes
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
        null
      )
      returning id into v_quote_id;

      exit;
    exception
      when unique_violation then
        if v_attempt = 5 then
          raise exception 'Could not generate a unique quote folio.';
        end if;
    end;
  end loop;

  insert into public.quote_addons (
    quote_id,
    addon_id,
    addon_name_snapshot,
    calculation_type_snapshot,
    unit_price_snapshot,
    quantity,
    line_total
  )
  select
    v_quote_id,
    a.id,
    a.name,
    a.calculation_type,
    a.unit_price,
    case
      when a.calculation_type = 'PER_BASE' then v_configuration.machine_number_of_bases
      else 1
    end,
    a.unit_price * case
      when a.calculation_type = 'PER_BASE' then v_configuration.machine_number_of_bases
      else 1
    end
  from public.machine_addons as ma
  join public.addons as a on a.id = ma.addon_id
  where ma.machine_id = v_configuration.machine_id
    and ma.active
    and a.active
    and a.id = any(v_selected_addon_ids);

  return query select v_quote_id, v_folio, v_total;
end;
$$;

revoke all on function public.quote_configuration(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.resolve_coupon_discount(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.preview_quote_coupon(uuid, uuid[], text) from public, anon, authenticated;
revoke all on function public.create_quote(uuid, uuid[], text, text, text, text, public.quote_delivery_type, text) from public, anon, authenticated;

grant execute on function public.preview_quote_coupon(uuid, uuid[], text) to authenticated;
grant execute on function public.create_quote(uuid, uuid[], text, text, text, text, public.quote_delivery_type, text) to authenticated;

commit;
