BEGIN;
alter table public.orders drop constraint orders_deposit_percent_check,drop constraint orders_balance_percent_check;
alter table public.orders add constraint network_payment_split check(deposit_percent>0 and balance_percent>0 and deposit_percent+balance_percent=100);
alter table public.order_payment_milestones drop constraint order_payment_milestones_percentage_check;
alter table public.order_payment_milestones add constraint network_payment_percentage check(percentage>0 and percentage<100),
 add column expected_amount numeric(14,2) generated always as(amount) stored,add column submitted_amount numeric(14,2) check(submitted_amount>0),add column reference text check(length(reference)<=150),add column submitted_by_user_id uuid references auth.users(id);
alter table public.opportunities add column customer_confirmed_at timestamptz,add column customer_confirmed_by uuid references auth.users(id);
alter table public.opportunity_activities drop constraint opportunity_activities_activity_type_check;
alter table public.opportunity_activities add constraint opportunity_activities_activity_type_check check(activity_type in ('NOTE','CALL','WHATSAPP','EMAIL','STAGE_CHANGE','QUOTE_LINKED','TASK_CREATED','ORDER_CREATED','OTHER','CUSTOMER_CONFIRMED_PURCHASE'));
alter function public.network_opportunity(uuid,text,uuid,jsonb) rename to network_opportunity_legacy;
revoke all on function public.network_opportunity_legacy(uuid,text,uuid,jsonb) from public,anon,authenticated;
create function public.network_opportunity(p_org uuid,p_action text,p_id uuid default null,p_data jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare o public.opportunities%rowtype;q public.quotes%rowtype;
begin
 perform public.network_assert(p_org);
 if p_action='create' and nullif(p_data->>'salesperson_id','') is not null and exists(select 1 from public.salespeople where id=(p_data->>'salesperson_id')::uuid and organization_id is not null and organization_id<>p_org) then raise exception 'Vendedor de otra organización';end if;
 if p_action='stage' and p_data->>'stage'='WON' then raise exception 'Usa Cliente confirmó compra para cerrar la venta';end if;
 if p_action='link_quote' then
  select * into q from public.quotes where id=(p_data->>'quote_id')::uuid;
  if q.organization_id is not null and q.organization_id<>p_org then raise exception 'Cotización de otra organización';end if;
 end if;
 if p_action='confirm_purchase' then
  select * into o from public.opportunities where id=p_id and organization_id=p_org for update;
  if o.stage='WON' and o.customer_confirmed_at is not null then return p_id;end if;
  if o.id is null or o.stage<>'NEGOTIATION' or o.linked_quote_id is null or p_data->>'confirmed'<>'yes' then raise exception 'Confirma la compra en una oportunidad en negociación con cotización';end if;
  perform public.network_opportunity_legacy(p_org,'stage',p_id,jsonb_build_object('stage','WON'));
  update public.opportunities set customer_confirmed_at=now(),customer_confirmed_by=auth.uid() where id=p_id;
  insert into public.opportunity_activities(organization_id,opportunity_id,activity_type,body,created_by_user_id) values(p_org,p_id,'CUSTOMER_CONFIRMED_PURCHASE','Compra confirmada por el cliente y registrada por el vendedor',auth.uid());
  perform public.network_audit(p_org,'customer.confirmed','opportunity',p_id);return p_id;
 end if;
 return public.network_opportunity_legacy(p_org,p_action,p_id,p_data);
end;$$;
alter function public.network_create_order(uuid) rename to network_create_order_legacy;
revoke all on function public.network_create_order_legacy(uuid) from public,anon,authenticated;
create function public.network_create_order(p_opportunity uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.opportunities%rowtype;v_hq uuid;
begin
 select * into o from public.opportunities where id=p_opportunity for update;perform public.network_assert(o.organization_id);
 select id into v_hq from public.organizations where slug='nahuitech';
 if o.organization_id<>v_hq and not exists(select 1 from public.dealer_supplier_relationships where dealer_organization_id=o.organization_id and supplier_organization_id=v_hq and authorized and status='ACTIVE') then raise exception 'Distribuidor no autorizado por el proveedor';end if;
 if exists(select 1 from public.machines m where m.supplier_organization_id is distinct from v_hq and (m.id=nullif(o.quote_snapshot->'quote'->>'machine_id','')::uuid or m.id in(select (j->>'machine_id')::uuid from jsonb_array_elements(coalesce(o.quote_snapshot->'items','[]')) j))) then raise exception 'Este flujo solo acepta equipos del proveedor Nahuitech; no mezcles proveedores';end if;
 -- Legacy WON opportunities remain convertible; new WON transitions require confirmation.
 return public.network_create_order_legacy(p_opportunity);
end;$$;

create table public.order_events(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,organization_id uuid not null references public.organizations(id),
 event_type text not null,actor_user_id uuid references auth.users(id),actor_name_snapshot text,organization_name_snapshot text,note text,created_at timestamptz not null default now()
);
create index network_order_events on public.order_events(order_id,created_at);
alter table public.order_events enable row level security;revoke all on public.order_events from public,anon,authenticated;grant select on public.order_events to authenticated;
create policy network_order_event_read on public.order_events for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id));
create function public.network_order_event(p_order uuid,p_event text,p_note text default null) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;actor uuid;g uuid;v_time timestamptz:=clock_timestamp();v_title text;
begin
 select * into o from public.orders where id=p_order;actor:=coalesce(auth.uid(),o.created_by_user_id);
 if p_event='CUSTOMER_CONFIRMED_PURCHASE' then select customer_confirmed_by,customer_confirmed_at into actor,v_time from public.opportunities where id=o.opportunity_id;end if;
 select label into v_title from (values ('NEW_ORDER','Pedido creado'),('CUSTOMER_CONFIRMED_PURCHASE','Venta confirmada'),('ORDER_APPROVED','Pedido revisado'),('PURCHASE_ORDER_RECEIVED','OC recibida'),('DEPOSIT_SUBMITTED','Anticipo enviado'),('DEPOSIT_VERIFIED','Anticipo validado'),('DEPOSIT_REJECTED','Anticipo rechazado'),('RELEASED_TO_PRODUCTION','Pedido liberado a producción'),('PRODUCTION_STARTED','Producción iniciada'),('BALANCE_REQUESTED','Liquidación solicitada'),('BALANCE_SUBMITTED','Saldo enviado'),('BALANCE_VERIFIED','Saldo validado'),('BALANCE_REJECTED','Saldo rechazado'),('PRODUCTION_COMPLETED','Producción terminada'),('READY_TO_SHIP','Listo para envío'),('SHIPPED','Enviado'),('DELIVERED','Entregado')) x(kind,label) where kind=p_event;
 select organization_id into g from public.organization_memberships where user_id=actor and active and organization_id in(o.organization_id,o.manufacturer_organization_id) order by (organization_id=o.manufacturer_organization_id) desc limit 1;
 g:=coalesce(g,o.organization_id);
 insert into public.order_events(order_id,organization_id,event_type,actor_user_id,actor_name_snapshot,organization_name_snapshot,note,created_at)
 values(o.id,g,p_event,actor,(select full_name from public.profiles where id=actor),(select coalesce(display_name,name) from public.organizations where id=g),left(p_note,2000),v_time);
 perform public.network_notify(o.organization_id,p_event,coalesce(v_title,replace(p_event,'_',' ')),o.folio,o.id);
 if o.manufacturer_organization_id<>o.organization_id then perform public.network_notify(o.manufacturer_organization_id,p_event,coalesce(v_title,replace(p_event,'_',' ')),o.folio,o.id);end if;
end;$$;
alter table public.sales_tasks add column audience_organization_id uuid references public.organizations(id),add column responsibility text check(responsibility in ('COMMERCIAL','FINANCE','PRODUCTION','LOGISTICS')),add column contact_snapshot jsonb;
create index network_task_audience on public.sales_tasks(audience_organization_id,status,due_at);
create function public.network_order_tasks(p_order uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;g public.organizations%rowtype;v_key text;v_title text;v_role text;v_audience uuid;
begin
 select * into o from public.orders where id=p_order;
 select x.key,x.title,x.role,x.audience into v_key,v_title,v_role,v_audience from (values
 ('PENDING_HQ_REVIEW','review','Revisar pedido','COMMERCIAL',o.manufacturer_organization_id),
 ('AWAITING_DEPOSIT','deposit','Enviar OC y anticipo','FINANCE',o.organization_id),
 ('DEPOSIT_SUBMITTED','verify-deposit','Validar anticipo','FINANCE',o.manufacturer_organization_id),
 ('RELEASED_TO_PRODUCTION','production','Iniciar producción','PRODUCTION',o.manufacturer_organization_id),
 ('BALANCE_SUBMITTED','verify-balance','Validar saldo','FINANCE',o.manufacturer_organization_id),
 ('READY_TO_SHIP','shipping','Preparar envío','LOGISTICS',o.manufacturer_organization_id),
 ('SHIPPED','delivery','Confirmar entrega','LOGISTICS',o.organization_id)
 ) x(status,key,title,role,audience) where x.status=o.status;
 if o.status in ('IN_PRODUCTION','AWAITING_BALANCE') and o.estimated_completion_date<=(now() at time zone 'America/Mexico_City')::date+public.network_balance_request_days() and exists(select 1 from public.order_payment_milestones where order_id=o.id and milestone_type='BALANCE' and status in ('PENDING','REJECTED')) then
  v_key:='balance';v_title:='Solicitar liquidación';v_role:='FINANCE';v_audience:=o.organization_id;
 end if;
 if o.status='AWAITING_DEPOSIT' and exists(select 1 from public.order_payment_milestones where order_id=o.id and milestone_type='DEPOSIT' and status='VERIFIED') then v_title:='Enviar orden de compra';end if;
 update public.sales_tasks set status='DONE',completed_at=now() where order_id=o.id and automation_key like 'operation:%' and status in ('OPEN','IN_PROGRESS') and automation_key is distinct from 'operation:'||coalesce(v_key,'')||':'||o.id;
 if v_key is not null then
  select * into g from public.organizations where id=v_audience;
  insert into public.sales_tasks(organization_id,order_id,task_type,title,priority,status,due_at,automation_key,created_by_system,audience_organization_id,responsibility,contact_snapshot)
  values(o.organization_id,o.id,case when v_key='balance' then 'REQUEST_BALANCE' else 'CUSTOM' end,v_title,'HIGH','OPEN',now(),'operation:'||v_key||':'||o.id,true,v_audience,v_role,
   case when v_role='FINANCE' then jsonb_build_object('name',g.finance_contact_name,'phone',g.finance_phone,'email',g.finance_email) when v_role='LOGISTICS' then jsonb_build_object('name',g.logistics_contact_name,'phone',g.logistics_phone,'email',g.logistics_email) else jsonb_build_object('name',g.display_name,'phone',g.commercial_phone,'email',g.commercial_email) end)
  on conflict(automation_key) do update set title=excluded.title,status=case when sales_tasks.status in ('DONE','CANCELLED') then 'OPEN' else sales_tasks.status end,completed_at=null,contact_snapshot=excluded.contact_snapshot;
 end if;
end;$$;
create function public.network_order_transition_event() returns trigger language plpgsql security definer set search_path='' as $$
declare ev text;
begin
 if tg_op='INSERT' then
  perform public.network_order_event(new.id,'NEW_ORDER');
  if exists(select 1 from public.opportunities where id=new.opportunity_id and customer_confirmed_at is not null) then perform public.network_order_event(new.id,'CUSTOMER_CONFIRMED_PURCHASE');end if;
 elsif new.status is distinct from old.status then
  ev:=case new.status when 'AWAITING_DEPOSIT' then case when old.status='PENDING_HQ_REVIEW' then 'ORDER_APPROVED' else null end when 'DEPOSIT_SUBMITTED' then 'DEPOSIT_SUBMITTED' when 'RELEASED_TO_PRODUCTION' then 'RELEASED_TO_PRODUCTION' when 'IN_PRODUCTION' then case when old.production_started_at is null or old.status='RELEASED_TO_PRODUCTION' then 'PRODUCTION_STARTED' end when 'BALANCE_SUBMITTED' then 'BALANCE_SUBMITTED' when 'READY_TO_SHIP' then 'READY_TO_SHIP' when 'SHIPPED' then 'SHIPPED' when 'DELIVERED' then 'DELIVERED' end;
  if ev is not null then perform public.network_order_event(new.id,ev);end if;
 end if;
 if tg_op='UPDATE' and new.production_completed_at is distinct from old.production_completed_at and new.production_completed_at is not null then perform public.network_order_event(new.id,'PRODUCTION_COMPLETED');end if;
 perform public.network_order_tasks(new.id);return new;
end;$$;
create trigger network_order_events after insert or update on public.orders for each row execute function public.network_order_transition_event();
create function public.network_document_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.document_type='PURCHASE_ORDER' then
  perform public.network_order_event(new.order_id,'PURCHASE_ORDER_RECEIVED');
  update public.orders set status='RELEASED_TO_PRODUCTION',released_to_production_at=now() where id=new.order_id and status='AWAITING_DEPOSIT' and exists(select 1 from public.order_payment_milestones where order_id=new.order_id and milestone_type='DEPOSIT' and status='VERIFIED');
 end if;return new;
end;$$;
create trigger network_document_event after insert on public.order_documents for each row execute function public.network_document_event();
create function public.network_payment_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status and new.status in ('VERIFIED','REJECTED') then perform public.network_order_event(new.order_id,new.milestone_type||'_'||new.status,new.rejection_reason);end if;return new;
end;$$;
create trigger network_payment_event after update on public.order_payment_milestones for each row execute function public.network_payment_event();
-- RPC upload finalization owns metadata and submission atomically.
revoke execute on function public.network_attach_document(uuid,text,text,text,text,bigint) from authenticated;
create function public.network_submit_document(p_order uuid,p_type text,p_path text,p_name text,p_mime text,p_size bigint,p_amount text default null,p_reference text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_kind text;
begin
 if p_type in ('DEPOSIT_PROOF','BALANCE_PROOF') and (coalesce(p_amount,'') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' or p_amount::numeric<=0) then raise exception 'Captura el importe enviado';end if;
 v_id:=public.network_attach_document(p_order,p_type,p_path,p_name,p_mime,p_size);
 if p_type in ('DEPOSIT_PROOF','BALANCE_PROOF') then
  v_kind:=case when p_type='DEPOSIT_PROOF' then 'DEPOSIT' else 'BALANCE' end;
  update public.order_payment_milestones set submitted_amount=p_amount::numeric,reference=nullif(trim(p_reference),''),submitted_by_user_id=auth.uid() where order_id=p_order and milestone_type=v_kind;
 end if;return v_id;
end;$$;
create or replace function public.network_order_action(p_id uuid,p_action text,p_data jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;m public.order_payment_milestones%rowtype;v_total numeric(14,2);v_next text;v_type text;v_date date;v_percent numeric;
begin
 select * into o from public.orders where id=p_id for update;
 if o.id is null then raise exception 'Pedido no disponible';end if;
 perform public.network_assert(o.organization_id);
 if not public.is_network_owner() then raise exception 'Solo HQ puede autorizar pedidos, pagos y producción';end if;
 if not exists(select 1 from public.organizations where id=o.manufacturer_organization_id and slug='nahuitech') then raise exception 'Pedido de otro proveedor';end if;
 v_next:=o.status;
 if p_action='approve' then
  if o.status<>'PENDING_HQ_REVIEW' then raise exception 'El pedido ya fue revisado';end if;
  if coalesce(p_data->>'dealer_order_total','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then raise exception 'Captura un monto positivo con máximo dos decimales';end if;
  if coalesce(p_data->>'estimated_completion_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Selecciona una fecha válida';end if;
  v_total:=(p_data->>'dealer_order_total')::numeric;v_date:=(p_data->>'estimated_completion_date')::date;
  if v_total is null or v_total<=0 or v_date is null or v_date<(now() at time zone 'America/Mexico_City')::date then raise exception 'Captura monto sell-in positivo y fecha válida';end if;
  v_percent:=coalesce(nullif(p_data->>'deposit_percent','')::numeric,50);
  if v_percent<=0 or v_percent>=100 or v_percent<>round(v_percent,2) or v_percent+coalesce(nullif(p_data->>'balance_percent','')::numeric,100-v_percent)<>100 then raise exception 'Los porcentajes deben sumar 100 y tener máximo dos decimales';end if;
  if round(v_total*v_percent/100,2)<=0 or round(v_total*v_percent/100,2)>=v_total then raise exception 'Ambos pagos deben ser mayores a cero';end if;
  update public.orders set dealer_order_total=v_total,estimated_completion_date=v_date,deposit_percent=v_percent,balance_percent=100-v_percent where id=p_id;
  insert into public.order_payment_milestones(order_id,milestone_type,percentage,amount) values(p_id,'DEPOSIT',v_percent,round(v_total*v_percent/100,2)),(p_id,'BALANCE',100-v_percent,v_total-round(v_total*v_percent/100,2));
  v_next:='AWAITING_DEPOSIT';
 elsif p_action in ('verify','reject') then
  v_type:=p_data->>'milestone_type';select * into m from public.order_payment_milestones where order_id=p_id and milestone_type=v_type for update;
  if m.id is null or m.status<>'SUBMITTED' or (v_type='DEPOSIT' and o.status<>'DEPOSIT_SUBMITTED') or (v_type='BALANCE' and o.status<>'BALANCE_SUBMITTED') then raise exception 'No hay comprobante pendiente de validar';end if;
  if p_action='reject' then
   if nullif(trim(p_data->>'reason'),'') is null then raise exception 'Indica motivo de rechazo';end if;
   update public.order_payment_milestones set status='REJECTED',rejected_at=now(),rejection_reason=left(p_data->>'reason',2000) where id=m.id;
   v_next:=case when v_type='DEPOSIT' then 'AWAITING_DEPOSIT' else 'AWAITING_BALANCE' end;
  else
   if coalesce(m.submitted_by_user_id,(select uploaded_by_user_id from public.order_documents where order_id=p_id and document_type=case when v_type='DEPOSIT' then 'DEPOSIT_PROOF' else 'BALANCE_PROOF' end order by created_at desc limit 1))=auth.uid() then raise exception 'No puedes validar tu propio comprobante';end if;
   if m.submitted_amount is not null and m.submitted_amount<>m.amount then raise exception 'El importe enviado no coincide con el esperado; rechaza para corregir';end if;
   update public.order_payment_milestones set status='VERIFIED',verified_at=now(),verified_by_user_id=auth.uid(),rejection_reason=null where id=m.id;
   if v_type='DEPOSIT' then
    if exists(select 1 from public.order_documents where order_id=p_id and document_type='PURCHASE_ORDER') then
     v_next:='RELEASED_TO_PRODUCTION';update public.orders set released_to_production_at=now() where id=p_id;
    else v_next:='AWAITING_DEPOSIT';end if;
   else
    v_next:=case when o.production_completed_at is not null then 'READY_TO_SHIP' else 'IN_PRODUCTION' end;
   end if;
   update public.sales_tasks set status='DONE',completed_at=now() where order_id=p_id and task_type=case when v_type='DEPOSIT' then 'REQUEST_DEPOSIT' else 'REQUEST_BALANCE' end and status in ('OPEN','IN_PROGRESS');
  end if;
 elsif p_action='start_production' then
  if o.status<>'RELEASED_TO_PRODUCTION' or not exists(select 1 from public.order_payment_milestones where order_id=p_id and milestone_type='DEPOSIT' and status='VERIFIED') then raise exception 'Se requiere anticipo verificado';end if;
  if not exists(select 1 from public.order_documents where order_id=p_id and document_type='PURCHASE_ORDER') then raise exception 'Falta orden de compra';end if;
  v_next:='IN_PRODUCTION';update public.orders set production_started_at=now() where id=p_id;
 elsif p_action='complete_production' then
  if o.production_started_at is null or o.production_completed_at is not null or o.status not in ('IN_PRODUCTION','AWAITING_BALANCE','BALANCE_SUBMITTED') then raise exception 'Producción no disponible para terminar';end if;
  update public.orders set production_completed_at=now() where id=p_id;
  v_next:=case when exists(select 1 from public.order_payment_milestones where order_id=p_id and milestone_type='BALANCE' and status='VERIFIED') then 'READY_TO_SHIP' when o.status='BALANCE_SUBMITTED' then 'BALANCE_SUBMITTED' else 'AWAITING_BALANCE' end;
 elsif p_action='date' then
  if coalesce(p_data->>'estimated_completion_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Selecciona una fecha válida';end if;
  v_date:=(p_data->>'estimated_completion_date')::date;
  if v_date is null or v_date<(now() at time zone 'America/Mexico_City')::date or o.status in ('SHIPPED','DELIVERED','CANCELLED') then raise exception 'Fecha o estado no válido';end if;
  update public.orders set estimated_completion_date=v_date where id=p_id;
 elsif p_action='ship' then
  if o.status<>'READY_TO_SHIP' then raise exception 'El pedido debe estar listo para envío';end if;
  v_next:='SHIPPED';update public.orders set shipped_at=now() where id=p_id;
 elsif p_action='deliver' then
  if o.status<>'SHIPPED' then raise exception 'El pedido debe estar enviado';end if;
  v_next:='DELIVERED';update public.orders set delivered_at=now() where id=p_id;
 else raise exception 'Acción no válida';end if;
 update public.orders set status=v_next,ready_to_ship_at=case when v_next='READY_TO_SHIP' then coalesce(ready_to_ship_at,now()) else ready_to_ship_at end where id=p_id;
 perform public.network_audit(o.organization_id,'order.'||p_action,'order',p_id,jsonb_build_object('from',o.status,'to',v_next,'milestone',v_type,'dealer_order_total',v_total,'estimated_completion_date',v_date,'reason',left(p_data->>'reason',2000)));
 perform public.network_notify(o.organization_id,'ORDER_UPDATED',case when v_next='READY_TO_SHIP' then 'Pedido listo para envío' when v_next='RELEASED_TO_PRODUCTION' then 'Anticipo validado · pedido liberado' when p_action='reject' then 'Comprobante rechazado' when p_action='verify' then 'Saldo validado' else 'Pedido actualizado' end,o.folio||' · '||v_next,p_id);
end; $$;

do $$ declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('network_opportunity','network_create_order','network_submit_document','network_order_event','network_order_tasks','network_order_transition_event','network_document_event','network_payment_event') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname in ('network_opportunity','network_create_order','network_submit_document') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
create or replace function public.refresh_sales_network_tasks(p_org uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_order record;
begin
 perform public.network_assert(p_org);
 insert into public.sales_tasks(organization_id,opportunity_id,assigned_user_id,task_type,title,priority,due_at,automation_key,created_by_system)
 select o.organization_id,o.id,o.owner_user_id,r.kind,r.title,r.priority,now(),r.key||':'||o.id,true
 from public.opportunities o cross join lateral (
  select 'FOLLOW_UP' kind,'Contactar cliente' title,'MEDIUM' priority,'follow-up' key where o.stage='QUOTED' and o.last_activity_at<=now()-interval '3 days'
  union all select 'CALL','Intentar programar llamada','MEDIUM','negotiation' where o.stage='NEGOTIATION' and (o.next_action_at is null or o.next_action_at<now()) and not exists(select 1 from public.sales_tasks t where t.opportunity_id=o.id and t.status in ('OPEN','IN_PROGRESS'))
  union all select 'QUOTE_EXPIRING','Cotización próxima a vencer','HIGH','quote-expiring' where o.stage in ('QUOTED','NEGOTIATION') and (o.quote_snapshot->'quote'->>'created_at')::timestamptz<=now()-interval '13 days'
  union all select 'ORDER_REVIEW','Convertir venta en pedido','HIGH','won-order' where o.stage='WON' and not exists(select 1 from public.orders x where x.opportunity_id=o.id)
 ) r where o.organization_id=p_org on conflict(automation_key) do nothing;
 -- Close obsolete reminders instead of leaving misleading work on the dashboard.
 update public.sales_tasks t set status='DONE',completed_at=now() where t.organization_id=p_org and t.created_by_system and t.status in ('OPEN','IN_PROGRESS') and (
 (t.task_type='ORDER_REVIEW' and exists(select 1 from public.orders o where o.opportunity_id=t.opportunity_id)) or
 (t.task_type in ('FOLLOW_UP','CALL','QUOTE_EXPIRING') and exists(select 1 from public.opportunities o where o.id=t.opportunity_id and o.stage in ('WON','LOST'))) or
 (t.task_type in ('REQUEST_DEPOSIT','REQUEST_BALANCE') and exists(select 1 from public.order_payment_milestones m where m.order_id=t.order_id and m.status='VERIFIED' and m.milestone_type=case when t.task_type='REQUEST_DEPOSIT' then 'DEPOSIT' else 'BALANCE' end)));
 for v_order in select id from public.orders where organization_id=p_org loop perform public.network_order_tasks(v_order.id);end loop;
end; $$;


create function public.network_task_contact() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.salespeople%rowtype;
begin
 if new.opportunity_id is not null then
  select s1.* into s from public.salespeople s1 join public.opportunities o on o.salesperson_id=s1.id where o.id=new.opportunity_id;
  new.responsibility:='COMMERCIAL';new.audience_organization_id:=new.organization_id;new.contact_snapshot:=jsonb_build_object('name',s.full_name,'phone',coalesce(s.whatsapp,s.phone),'email',s.email);
 end if;return new;
end;$$;
create trigger network_task_contact before insert on public.sales_tasks for each row execute function public.network_task_contact();
create function public.network_balance_event() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.task_type='REQUEST_BALANCE' and new.order_id is not null and new.created_by_system then perform public.network_order_event(new.order_id,'BALANCE_REQUESTED');end if;return new;end;$$;
create trigger network_balance_event after insert on public.sales_tasks for each row execute function public.network_balance_event();
revoke all on function public.network_task_contact(),public.network_balance_event() from public,anon,authenticated;
COMMIT;
