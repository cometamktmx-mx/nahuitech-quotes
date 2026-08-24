begin;

create type public.quote_status as enum ('DRAFT', 'CREATED', 'SENT', 'CANCELLED');

create type public.quote_delivery_type as enum (
  'SHIPPING',
  'INSTALLATION',
  'LATER'
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  whatsapp text not null,
  email text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_not_blank check (char_length(btrim(name)) > 0),
  constraint customers_whatsapp_not_blank check (char_length(btrim(whatsapp)) > 0)
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique,
  customer_id uuid not null references public.customers (id),
  seller_id uuid not null references auth.users (id),
  status public.quote_status not null default 'DRAFT',
  machine_id uuid references public.machines (id) on delete set null,
  machine_name_snapshot text not null,
  machine_slug_snapshot text not null,
  machine_base_price_snapshot numeric(12, 2) not null,
  machine_number_of_bases_snapshot integer,
  delivery_type public.quote_delivery_type not null,
  delivery_note text,
  subtotal numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null,
  coupon_code_snapshot text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotes_folio_format check (folio ~ '^NH-[0-9]{6}-[A-F0-9]{6}$'),
  constraint quotes_machine_name_not_blank check (char_length(btrim(machine_name_snapshot)) > 0),
  constraint quotes_machine_slug_not_blank check (char_length(btrim(machine_slug_snapshot)) > 0),
  constraint quotes_machine_base_price_non_negative check (machine_base_price_snapshot >= 0),
  constraint quotes_machine_bases_positive check (
    machine_number_of_bases_snapshot is null
    or machine_number_of_bases_snapshot > 0
  ),
  constraint quotes_subtotal_non_negative check (subtotal >= 0),
  constraint quotes_discount_non_negative check (discount_amount >= 0),
  constraint quotes_discount_not_greater_than_subtotal check (discount_amount <= subtotal),
  constraint quotes_total_non_negative check (total >= 0),
  constraint quotes_total_matches_parts check (total = subtotal - discount_amount)
);

create table public.quote_addons (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  addon_id uuid references public.addons (id) on delete set null,
  addon_name_snapshot text not null,
  calculation_type_snapshot public.addon_calculation_type not null,
  unit_price_snapshot numeric(12, 2) not null,
  quantity integer not null,
  line_total numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  constraint quote_addons_name_not_blank check (char_length(btrim(addon_name_snapshot)) > 0),
  constraint quote_addons_unit_price_non_negative check (unit_price_snapshot >= 0),
  constraint quote_addons_quantity_positive check (quantity > 0),
  constraint quote_addons_line_total_non_negative check (line_total >= 0),
  constraint quote_addons_line_total_matches_snapshot check (
    line_total = unit_price_snapshot * quantity
  ),
  constraint quote_addons_quote_addon_unique unique (quote_id, addon_id)
);

create index customers_created_by_created_at_idx
  on public.customers (created_by, created_at desc);

create index quotes_seller_created_at_idx
  on public.quotes (seller_id, created_at desc);

create index quotes_created_at_idx
  on public.quotes (created_at desc);

create index quotes_customer_id_idx
  on public.quotes (customer_id);

create index quote_addons_quote_id_idx
  on public.quote_addons (quote_id);

create trigger set_customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

create trigger set_quotes_updated_at
before update on public.quotes
for each row execute function public.set_updated_at();

alter table public.customers enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_addons enable row level security;

revoke all on table public.customers, public.quotes, public.quote_addons from public;
revoke all on table public.customers, public.quotes, public.quote_addons from anon, authenticated;

grant select on table public.customers, public.quotes, public.quote_addons to authenticated;
grant usage on type public.quote_status, public.quote_delivery_type to authenticated;

create policy "Sellers can view their own customers and admins can view all customers"
on public.customers
for select
to authenticated
using (
  created_by = (select auth.uid())
  or (select public.is_admin())
);

create policy "Sellers can view their own quotes and admins can view all quotes"
on public.quotes
for select
to authenticated
using (
  seller_id = (select auth.uid())
  or (select public.is_admin())
);

create policy "Sellers can view their own quote add-ons and admins can view all quote add-ons"
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
        or (select public.is_admin())
      )
  )
);

comment on table public.quotes is
  'Historical quote snapshots. Prices and names are not reconstructed from the live catalog.';

comment on column public.quotes.delivery_note is
  'Human-readable delivery state such as Por cotizar. It is not a monetary amount.';

comment on column public.quotes.coupon_code_snapshot is
  'Reserved for a future coupon module. Quotes created by create_quote always use no coupon and zero discount.';

create function public.create_quote(
  p_machine_id uuid,
  p_addon_ids uuid[],
  p_customer_name text,
  p_customer_company text,
  p_customer_whatsapp text,
  p_customer_email text,
  p_delivery_type public.quote_delivery_type
)
returns table (quote_id uuid, folio text, total numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := (select auth.uid());
  v_seller_role public.profile_role;
  v_machine public.machines%rowtype;
  v_customer_id uuid;
  v_quote_id uuid;
  v_folio text;
  v_customer_name text;
  v_customer_company text;
  v_customer_whatsapp text;
  v_customer_email text;
  v_delivery_note text;
  v_selected_addon_ids uuid[];
  v_unique_addon_ids uuid[];
  v_valid_addon_count integer;
  v_addon_subtotal numeric(12, 2);
  v_subtotal numeric(12, 2);
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

  v_subtotal := v_machine.base_price + v_addon_subtotal;
  v_total := v_subtotal;
  v_delivery_note := case p_delivery_type
    when 'SHIPPING' then 'Por cotizar'
    when 'INSTALLATION' then 'Por cotizar'
    when 'LATER' then 'Definir después'
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
        notes
      )
      values (
        v_folio,
        v_customer_id,
        v_seller_id,
        'CREATED',
        v_machine.id,
        v_machine.name,
        v_machine.slug,
        v_machine.base_price,
        v_machine.number_of_bases,
        p_delivery_type,
        v_delivery_note,
        v_subtotal,
        0,
        v_total,
        null,
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
      when a.calculation_type = 'PER_BASE' then v_machine.number_of_bases
      else 1
    end,
    a.unit_price * case
      when a.calculation_type = 'PER_BASE' then v_machine.number_of_bases
      else 1
    end
  from public.machine_addons as ma
  join public.addons as a on a.id = ma.addon_id
  where ma.machine_id = v_machine.id
    and ma.active
    and a.active
    and a.id = any(v_selected_addon_ids);

  return query
  select v_quote_id, v_folio, v_total;
end;
$$;

revoke all on function public.create_quote(
  uuid,
  uuid[],
  text,
  text,
  text,
  text,
  public.quote_delivery_type
) from public;

grant execute on function public.create_quote(
  uuid,
  uuid[],
  text,
  text,
  text,
  text,
  public.quote_delivery_type
) to authenticated;

commit;
