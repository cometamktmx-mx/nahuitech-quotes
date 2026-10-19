BEGIN;
alter table public.order_items add column updated_at timestamptz not null default now();
create trigger network_order_item_updated before update on public.order_items for each row execute function public.set_updated_at();
alter table public.orders add column revision integer not null default 1 check(revision>0),
 add column shipping_carrier text check(length(shipping_carrier)<=150),add column tracking_number text check(length(tracking_number)<=150),
 add column shipping_document_id uuid references public.order_documents(id) on delete set null;
create table public.order_change_requests(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,
 request_type text not null check(request_type in ('CHANGE','CANCEL')),requested_by uuid not null references auth.users(id),reason text not null check(length(trim(reason)) between 1 and 2000),
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),
 old_snapshot jsonb not null,new_snapshot jsonb not null,price_delta numeric(14,2),order_revision integer not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),approved_at timestamptz,approved_by uuid references auth.users(id),review_reason text
);
create unique index network_one_pending_change on public.order_change_requests(order_id) where status='PENDING';
create index network_changes_order on public.order_change_requests(order_id,created_at);
create table public.order_reservations(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,
 reservation_type text not null check(reservation_type in ('INVENTORY','PRODUCTION_SLOT')),reference text check(length(reference)<=200),
 reserved_at timestamptz not null default now(),released_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index network_reservations_order on public.order_reservations(order_id);
create table public.installed_units(
 id uuid primary key default gen_random_uuid(),supplier_organization_id uuid not null references public.organizations(id),dealer_organization_id uuid not null references public.organizations(id),customer_id uuid references public.customers(id),
 order_id uuid not null references public.orders(id) on delete cascade,order_item_id uuid not null references public.order_items(id) on delete cascade,
 unit_index integer not null check(unit_index>0),machine_id uuid references public.machines(id),machine_name_snapshot text not null,
 serial_number text check(length(serial_number)<=150),delivered_at timestamptz not null,warranty_start_date date not null,warranty_end_date date,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(order_item_id,unit_index),check(warranty_end_date is null or warranty_end_date>=warranty_start_date)
);
create unique index network_unit_serial on public.installed_units(supplier_organization_id,serial_number) where serial_number is not null;
create index network_units_dealer on public.installed_units(dealer_organization_id,delivered_at);
create index network_units_supplier on public.installed_units(supplier_organization_id,delivered_at);
alter table public.opportunities add column installed_unit_id uuid references public.installed_units(id) on delete set null;
create index network_opportunity_unit on public.opportunities(installed_unit_id) where installed_unit_id is not null;
do $$ declare t text;begin
 foreach t in array array['order_change_requests','order_reservations','installed_units'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy network_post_sale_read on public.%I for select to authenticated using(public.network_order_access(order_id))',t);
 end loop;
end $$;

create function public.network_order_request(p_order uuid,p_kind text,p_reason text,p_item uuid default null,p_configuration text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;v_id uuid;v_items jsonb;
begin
 select * into o from public.orders where id=p_order for update;perform public.network_assert(o.organization_id);
 if o.id is null or o.status in ('SHIPPED','DELIVERED','CANCELLED') then raise exception 'Pedido no disponible para solicitudes';end if;
 if p_kind not in ('CHANGE','CANCEL') or nullif(trim(p_reason),'') is null then raise exception 'Indica tipo y motivo';end if;
 if p_kind='CHANGE' and (o.dealer_order_total is null or o.production_completed_at is not null) then raise exception 'Los cambios requieren pedido aprobado y producción sin terminar';end if;
 if p_kind='CHANGE' and (nullif(trim(p_configuration),'') is null or length(p_configuration)>4000 or not exists(select 1 from public.order_items where id=p_item and order_id=p_order)) then raise exception 'Selecciona un equipo y describe la nueva configuración';end if;
 select jsonb_agg(to_jsonb(i) order by sort_order) into v_items from public.order_items i where order_id=p_order;
 insert into public.order_change_requests(order_id,request_type,requested_by,reason,old_snapshot,new_snapshot,order_revision)
 values(p_order,p_kind,auth.uid(),trim(p_reason),jsonb_build_object('sell_in_total',o.dealer_order_total,'items',v_items,'status',o.status),jsonb_build_object('item_id',p_item,'configuration',p_configuration),o.revision) returning id into v_id;
 perform public.network_order_event(p_order,case when p_kind='CHANGE' then 'CHANGE_REQUESTED' else 'CANCELLATION_REQUESTED' end,p_reason);
 perform public.network_audit(o.organization_id,'order.request','order',p_order,jsonb_build_object('request_id',v_id,'type',p_kind));return v_id;
end;$$;
create function public.network_review_request(p_request uuid,p_approve boolean,p_data jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare r public.order_change_requests%rowtype;o public.orders%rowtype;v_order uuid;v_delta numeric;v_total numeric;v_deposit numeric;v_paid boolean;v_snapshot jsonb;
begin
 select order_id into v_order from public.order_change_requests where id=p_request;
 select * into o from public.orders where id=v_order for update;perform public.network_assert(o.organization_id);
 if not public.is_network_owner() or not exists(select 1 from public.organizations where id=o.supplier_organization_id and slug='nahuitech') then raise exception 'Solo HQ del proveedor puede revisar';end if;
 select * into r from public.order_change_requests where id=p_request for update;
 if r.id is null or r.status<>'PENDING' then raise exception 'Solicitud no pendiente';end if;
 if nullif(trim(p_data->>'reason'),'') is null then raise exception 'Indica motivo de la resolución';end if;
 if not p_approve then
  update public.order_change_requests set status='REJECTED',updated_at=now(),review_reason=left(p_data->>'reason',2000),approved_by=auth.uid() where id=r.id;
  perform public.network_order_event(o.id,'REQUEST_REJECTED',p_data->>'reason');
 else
  if o.revision<>r.order_revision or o.status in ('SHIPPED','DELIVERED','CANCELLED') then raise exception 'El pedido cambió; rechaza y solicita una revisión nueva';end if;
  if exists(select 1 from public.order_payment_milestones where order_id=o.id and status='SUBMITTED') then raise exception 'Resuelve primero los comprobantes pendientes';end if;
  select amount,status='VERIFIED' into v_deposit,v_paid from public.order_payment_milestones where order_id=o.id and milestone_type='DEPOSIT' for update;
  if r.request_type='CHANGE' then
   if o.production_completed_at is not null or exists(select 1 from public.order_payment_milestones where order_id=o.id and milestone_type='BALANCE' and status='VERIFIED') then raise exception 'No se cambia un pedido terminado o liquidado';end if;
   if coalesce(p_data->>'price_delta','') !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$' then raise exception 'Captura el ajuste sell-in con máximo dos decimales';end if;
   v_delta:=(p_data->>'price_delta')::numeric;v_total:=o.dealer_order_total+v_delta;
   if not coalesce(v_paid,false) then v_deposit:=round(v_total*o.deposit_percent/100,2);end if;
   if v_total<=0 or v_deposit<=0 or v_total<=v_deposit then raise exception 'El total debe superar el anticipo; devoluciones requieren revisión fuera de este flujo';end if;
   update public.order_items set configuration_snapshot=configuration_snapshot||jsonb_build_object('approved_change',jsonb_build_object('configuration',r.new_snapshot->>'configuration','request_id',r.id)) where id=(r.new_snapshot->>'item_id')::uuid and order_id=o.id;
   if not found then raise exception 'Equipo no disponible';end if;
   if not coalesce(v_paid,false) then update public.order_payment_milestones set amount=v_deposit where order_id=o.id and milestone_type='DEPOSIT';end if;
   update public.order_payment_milestones set amount=v_total-v_deposit where order_id=o.id and milestone_type='BALANCE';
   update public.orders set dealer_order_total=v_total,revision=revision+1 where id=o.id;
   select jsonb_build_object('sell_in_total',v_total,'items',jsonb_agg(to_jsonb(i) order by sort_order),'balance',v_total-v_deposit) into v_snapshot from public.order_items i where order_id=o.id;
  else
   if exists(select 1 from public.order_payment_milestones where order_id=o.id and status='VERIFIED') and coalesce(p_data->>'confirm_paid','')<>'yes' then raise exception 'Confirma la cancelación con pagos validados; no se registra devolución automática';end if;
   if o.production_started_at is not null and coalesce(p_data->>'confirm_production','')<>'yes' then raise exception 'Se requiere autorización explícita de cancelación con producción iniciada';end if;
   update public.orders set status='CANCELLED',revision=revision+1 where id=o.id;
   update public.sales_tasks set status='CANCELLED',completed_at=now() where order_id=o.id and status in ('OPEN','IN_PROGRESS');
   update public.order_reservations set released_at=coalesce(released_at,now()),updated_at=now() where order_id=o.id;
   v_snapshot:=jsonb_build_object('status','CANCELLED','financial_history_retained',true);
  end if;
  update public.order_change_requests set status='APPROVED',approved_at=now(),approved_by=auth.uid(),updated_at=now(),review_reason=left(p_data->>'reason',2000),price_delta=v_delta,new_snapshot=v_snapshot where id=r.id;
  perform public.network_order_event(o.id,case when r.request_type='CHANGE' then 'CHANGE_APPROVED' else 'CANCELLED' end,p_data->>'reason');
 end if;
 perform public.network_audit(o.organization_id,'order.request_review','order',o.id,jsonb_build_object('request_id',r.id,'approved',p_approve,'price_delta',v_delta));
end;$$;

alter function public.network_order_action(uuid,text,jsonb) rename to network_order_action_core;
revoke all on function public.network_order_action_core(uuid,text,jsonb) from public,anon,authenticated;
create function public.network_order_action(p_id uuid,p_action text,p_data jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;i public.order_items%rowtype;v_date date;v_end date;v_serial text;v_n integer;v_doc uuid;
begin
 select * into o from public.orders where id=p_id for update;perform public.network_assert(o.organization_id);
 if not public.is_network_owner() or not exists(select 1 from public.organizations where id=o.supplier_organization_id and slug='nahuitech') then raise exception 'Solo HQ del proveedor puede operar';end if;
 if p_action='reserve' then
  if o.status in ('CANCELLED','SHIPPED','DELIVERED') then raise exception 'Pedido no disponible para reservar';end if;
  insert into public.order_reservations(order_id,reservation_type,reference) values(p_id,p_data->>'reservation_type',nullif(trim(p_data->>'reference'),''));
  perform public.network_audit(o.organization_id,'order.reserved','order',p_id,jsonb_build_object('type',p_data->>'reservation_type'));return;
 elsif p_action='release_reservation' then
  update public.order_reservations set released_at=now(),updated_at=now() where id=(p_data->>'reservation_id')::uuid and order_id=p_id and released_at is null;
  if not found then raise exception 'Reserva no disponible';end if;
  perform public.network_audit(o.organization_id,'order.reservation_released','order',p_id);return;
 elsif p_action='ship' then
  v_doc:=nullif(p_data->>'shipping_document_id','')::uuid;
  if v_doc is not null and not exists(select 1 from public.order_documents where id=v_doc and order_id=p_id and document_type='SHIPPING') then raise exception 'Documento de envío no autorizado';end if;
  update public.orders set shipping_carrier=nullif(trim(p_data->>'shipping_carrier'),''),tracking_number=nullif(trim(p_data->>'tracking_number'),''),shipping_document_id=v_doc where id=p_id;
 elsif p_action='deliver' then
  if coalesce(p_data->>'delivery_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Indica fecha de entrega';end if;
  v_date:=(p_data->>'delivery_date')::date;v_end:=nullif(p_data->>'warranty_end_date','')::date;
  if v_date>(now() at time zone 'America/Mexico_City')::date or v_date<(o.shipped_at at time zone 'America/Mexico_City')::date or (v_end is not null and v_end<v_date) then raise exception 'Fecha de entrega o garantía no válida';end if;
 end if;
 perform public.network_order_action_core(p_id,p_action,p_data);
 if p_action='deliver' then
  update public.orders set delivered_at=v_date::timestamp at time zone 'America/Mexico_City' where id=p_id;
  for i in select * from public.order_items where order_id=p_id order by sort_order loop
   for v_n in 1..i.quantity loop
    v_serial:=nullif(trim(p_data->>('serial_'||i.id||'_'||v_n)),'');
    insert into public.installed_units(supplier_organization_id,dealer_organization_id,customer_id,order_id,order_item_id,unit_index,machine_id,machine_name_snapshot,serial_number,delivered_at,warranty_start_date,warranty_end_date)
    values(o.supplier_organization_id,o.organization_id,o.customer_id,o.id,i.id,v_n,i.machine_id,i.machine_name_snapshot,v_serial,v_date::timestamp at time zone 'America/Mexico_City',v_date,v_end);
   end loop;
  end loop;
  update public.order_reservations set released_at=coalesce(released_at,now()),updated_at=now() where order_id=p_id;
  perform public.network_audit(o.organization_id,'order.delivery_registered','order',p_id,jsonb_build_object('delivery_date',v_date));
 end if;
end;$$;
create function public.network_unit_opportunity(p_unit uuid,p_title text) returns uuid language plpgsql security definer set search_path='' as $$
declare u public.installed_units%rowtype;v_id uuid;
begin
 select * into u from public.installed_units where id=p_unit;perform public.network_assert(u.dealer_organization_id);
 v_id:=public.network_opportunity(u.dealer_organization_id,'create',null,jsonb_build_object('title',p_title));
 -- The unit is the authorized source of the customer, independent of its original seller.
 update public.opportunities set installed_unit_id=p_unit,customer_id=u.customer_id where id=v_id;
 perform public.network_audit(u.dealer_organization_id,'opportunity.unit_linked','opportunity',v_id,jsonb_build_object('installed_unit_id',p_unit));return v_id;
end;$$;
revoke all on function public.network_order_request(uuid,text,text,uuid,text),public.network_review_request(uuid,boolean,jsonb),public.network_order_action(uuid,text,jsonb),public.network_unit_opportunity(uuid,text) from public,anon,authenticated;
grant execute on function public.network_order_request(uuid,text,text,uuid,text),public.network_review_request(uuid,boolean,jsonb),public.network_order_action(uuid,text,jsonb),public.network_unit_opportunity(uuid,text) to authenticated;
COMMIT;
