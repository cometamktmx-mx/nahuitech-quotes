begin;

create table public.quote_items (
 id uuid primary key default gen_random_uuid(),
 quote_id uuid not null references public.quotes(id) on delete cascade,
 machine_id uuid references public.machines(id) on delete set null,
 machine_name_snapshot text not null,
 machine_slug_snapshot text not null,
 machine_image_url_snapshot text,
 machine_number_of_bases_snapshot integer,
 machine_variant_id uuid references public.machine_variants(id) on delete set null,
 machine_variant_type_snapshot public.machine_variant_type,
 machine_variant_name_snapshot text,
 machine_variant_price_snapshot numeric(12,2),
 machine_variant_description_snapshot text,
 quantity integer not null default 1 check (quantity between 1 and 10000),
 unit_gross_snapshot numeric(12,2) not null check(unit_gross_snapshot>=0),
 unit_net_snapshot numeric(12,2) not null,
 line_gross_total numeric(12,2) not null check(line_gross_total>=0),
 line_net_total numeric(12,2) not null,
 delivery_type public.quote_delivery_type not null,
 sort_order integer not null check(sort_order>=0),
 created_at timestamptz not null default now(),
 unique(quote_id,sort_order), unique(quote_id,id),
 check(unit_net_snapshot=round(unit_gross_snapshot/1.16,2)),
 check(line_net_total=round(line_gross_total/1.16,2))
);
comment on column public.quote_items.unit_gross_snapshot is 'Machine unit gross price, excluding add-ons.';
comment on column public.quote_items.line_gross_total is 'Quantity times configured machine including its add-ons, before quote coupon.';
alter table public.quote_addons add column quote_item_id uuid;
alter table public.quote_addons add constraint quote_addons_item_parent_fk
 foreign key(quote_id,quote_item_id) references public.quote_items(quote_id,id) on delete cascade;
alter table public.quote_addons drop constraint quote_addons_quote_addon_unique;
create unique index quote_addons_legacy_unique on public.quote_addons(quote_id,addon_id) where quote_item_id is null;
create unique index quote_addons_item_unique on public.quote_addons(quote_item_id,addon_id) where quote_item_id is not null;
create index quote_items_machine_idx on public.quote_items(machine_id);
alter table public.quote_items enable row level security;
revoke all on public.quote_items from public,anon,authenticated;
grant select on public.quote_items to authenticated;
create policy "Quote item visibility follows parent quote" on public.quote_items for select to authenticated
 using(exists(select 1 from public.quotes q where q.id=quote_items.quote_id
   and (q.seller_id=(select auth.uid()) or (select public.is_admin()))));

-- Internal calculator shared by preview and create. Reuses legacy validation
-- for active machines, variants, compatible/required add-ons and overrides.
create function public.multi_quote_configuration(p_items jsonb,p_coupon_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_item jsonb; v_config record; v_quantity integer; v_lines jsonb:='[]';
 v_subtotal numeric(12,2):=0; v_coupon record; v_discount numeric(12,2):=0;
 v_coupon_json jsonb:='{}'; v_delivery public.quote_delivery_type;
begin
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Items must be an array.'; end if;
 if jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then raise exception 'Quote requires 1 to 100 items.'; end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(v_item) is distinct from 'object' or
    coalesce(v_item->>'quantity','') !~ '^[1-9][0-9]*$' then raise exception 'Invalid item quantity.'; end if;
  v_quantity:=(v_item->>'quantity')::integer;
  if v_quantity>10000 then raise exception 'Invalid item quantity.'; end if;
  select * into v_config from public.quote_variant_configuration(
    (v_item->>'machine_id')::uuid, v_item->'addon_quantities',(v_item->>'machine_variant_id')::uuid);
  if v_config.machine_variant_id is not null and not exists(
   select 1 from public.machines m where m.id=v_config.machine_id
   and v_config.machine_variant_type=any(m.allowed_variant_types)
  ) then raise exception 'The selected machine variant is not available.'; end if;
  v_delivery:=coalesce((v_item->>'delivery_type')::public.quote_delivery_type,'LATER');
  -- Each equipment retains its delivery requirement; mixed shipping/installation is valid.
  if v_config.machine_delivery_policy='INSTALLATION_REQUIRED' then v_delivery:='INSTALLATION'; end if;
  if v_config.machine_delivery_policy='SHIPPING_ONLY' then v_delivery:='SHIPPING'; end if;
  v_subtotal:=v_subtotal+round(v_config.subtotal*v_quantity,2);
  v_lines:=v_lines||jsonb_build_array(to_jsonb(v_config)||jsonb_build_object(
   'quantity',v_quantity,'delivery_type',v_delivery,
   'image_url',(select m.image_url from public.machines m where m.id=v_config.machine_id),
   'description',(select v.description from public.machine_variants v where v.id=v_config.machine_variant_id)));
 end loop;
 if nullif(btrim(p_coupon_code),'') is not null then
  -- A restricted quote-wide coupon must cover EVERY machine. Discount is applied once.
  for v_item in select value from jsonb_array_elements(v_lines) loop
   select * into v_coupon from public.resolve_coupon_discount((v_item->>'machine_id')::uuid,v_subtotal,p_coupon_code);
  end loop;
  v_discount:=v_coupon.discount_amount;
  v_coupon_json:=to_jsonb(v_coupon);
 end if;
 return jsonb_build_object('items',v_lines,'subtotal',v_subtotal,'discount_amount',v_discount,
   'total',v_subtotal-v_discount,'coupon',v_coupon_json);
end $$;
revoke all on function public.multi_quote_configuration(jsonb,text) from public,anon,authenticated;

create function public.preview_multi_quote_coupon(p_items jsonb,p_coupon_code text)
returns table(subtotal numeric,discount_amount numeric,total numeric,coupon_code text,
 coupon_name text,coupon_discount_type public.coupon_discount_type,coupon_discount_value numeric)
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('seller','expo'))
 then raise exception 'Only active seller flow accounts can validate coupons.'; end if;
 v_result:=public.multi_quote_configuration(p_items,p_coupon_code);
 return query select (v_result->>'subtotal')::numeric,(v_result->>'discount_amount')::numeric,
 (v_result->>'total')::numeric,v_result#>>'{coupon,coupon_code}',v_result#>>'{coupon,coupon_name}',
 (v_result#>>'{coupon,coupon_discount_type}')::public.coupon_discount_type,(v_result#>>'{coupon,coupon_discount_value}')::numeric;
end $$;
revoke all on function public.preview_multi_quote_coupon(jsonb,text) from public,anon,authenticated;
grant execute on function public.preview_multi_quote_coupon(jsonb,text) to authenticated;

create function public.create_multi_quote(
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


revoke all on function public.create_multi_quote(jsonb,text,text,text,text,public.quote_delivery_type,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.create_multi_quote(jsonb,text,text,text,text,public.quote_delivery_type,text,uuid,text,uuid) to authenticated;
commit;
