BEGIN;
create sequence public.network_order_folio_seq;
create table public.orders (
 id uuid primary key default gen_random_uuid(),folio text not null unique default ('NH-ORDER-'||lpad(nextval('public.network_order_folio_seq')::text,8,'0')),
 organization_id uuid not null references public.organizations(id),manufacturer_organization_id uuid not null references public.organizations(id),
 opportunity_id uuid not null unique,quote_id uuid not null references public.quotes(id),customer_id uuid references public.customers(id),salesperson_id uuid references public.salespeople(id),
 status text not null default 'PENDING_HQ_REVIEW' check(status in ('PENDING_HQ_REVIEW','AWAITING_DEPOSIT','DEPOSIT_SUBMITTED','RELEASED_TO_PRODUCTION','IN_PRODUCTION','AWAITING_BALANCE','BALANCE_SUBMITTED','READY_TO_SHIP','SHIPPED','DELIVERED','CANCELLED')),
 customer_quote_total_snapshot numeric(14,2),quote_snapshot jsonb not null,dealer_order_total numeric(14,2) check(dealer_order_total>0 and dealer_order_total<1000000000000),
 deposit_percent numeric(5,2) not null default 50 check(deposit_percent=50),balance_percent numeric(5,2) not null default 50 check(balance_percent=50),
 estimated_completion_date date,released_to_production_at timestamptz,production_started_at timestamptz,production_completed_at timestamptz,ready_to_ship_at timestamptz,shipped_at timestamptz,delivered_at timestamptz,
 created_by_user_id uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(opportunity_id,organization_id) references public.opportunities(id,organization_id),unique(id,organization_id)
);
create index network_orders_org_status on public.orders(organization_id,status,estimated_completion_date);
alter table public.sales_tasks add foreign key(order_id,organization_id) references public.orders(id,organization_id);
create table public.order_payment_milestones (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),milestone_type text not null check(milestone_type in ('DEPOSIT','BALANCE')),
 percentage numeric(5,2) not null check(percentage=50),amount numeric(14,2) not null check(amount>=0 and amount<1000000000000),status text not null default 'PENDING' check(status in ('PENDING','SUBMITTED','VERIFIED','REJECTED')),
 due_at timestamptz,submitted_at timestamptz,verified_at timestamptz,verified_by_user_id uuid references auth.users(id),rejected_at timestamptz,rejection_reason text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(order_id,milestone_type)
);
create index network_payments_pending on public.order_payment_milestones(status,order_id);
create table public.order_documents (
 id uuid primary key default gen_random_uuid(),order_id uuid not null,organization_id uuid not null references public.organizations(id),
 document_type text not null check(document_type in ('PURCHASE_ORDER','DEPOSIT_PROOF','BALANCE_PROOF','INVOICE','SHIPPING','OTHER')),
 storage_path text not null unique,original_filename text not null check(length(original_filename)<=250),mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
 size_bytes bigint not null check(size_bytes between 1 and 8388608),uploaded_by_user_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(order_id,organization_id) references public.orders(id,organization_id)
);
create index network_documents_order on public.order_documents(organization_id,order_id,document_type);
create table public.network_notifications (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),user_id uuid references auth.users(id),role_scope text,
 type text not null,title text not null,body text not null,source_type text,source_id uuid,read_at timestamptz,created_at timestamptz not null default now(),dedupe_key text unique
);
create index network_notifications_org on public.network_notifications(organization_id,read_at,created_at);
create function public.network_notify(p_org uuid,p_type text,p_title text,p_body text,p_id uuid,p_key text default null) returns void language sql security definer set search_path='' as $$
 insert into public.network_notifications(organization_id,type,title,body,source_type,source_id,dedupe_key) values(p_org,p_type,p_title,p_body,'order',p_id,p_key) on conflict(dedupe_key) do nothing;
$$;
revoke all on function public.network_notify(uuid,text,text,text,uuid,text) from public,anon,authenticated;

do $$ declare t text; begin foreach t in array array['orders','order_documents','network_notifications'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);
 execute format('create policy network_read on public.%I for select to authenticated using(public.network_access(organization_id))',t);
 end loop;
 foreach t in array array['orders','order_payment_milestones'] loop execute format('create trigger network_updated before update on public.%I for each row execute function public.set_updated_at()',t);end loop;
end $$;
alter table public.order_payment_milestones enable row level security;
revoke all on public.order_payment_milestones from anon,authenticated;
grant select on public.order_payment_milestones to authenticated;
create policy network_payment_read on public.order_payment_milestones for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and public.network_access(o.organization_id)));

create function public.network_create_order(p_opportunity uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.opportunities%rowtype; v_id uuid; v_hq uuid;
begin
 select * into o from public.opportunities where id=p_opportunity for update;
 perform public.network_assert(o.organization_id);
 if o.id is null or o.stage<>'WON' or o.linked_quote_id is null or o.quote_snapshot is null then raise exception 'Se requiere oportunidad ganada con cotización vinculada'; end if;
 select id into v_id from public.orders where opportunity_id=o.id;
 if v_id is not null then return v_id; end if;
 select id into v_hq from public.organizations where slug='nahuitech' and organization_type='MANUFACTURER';
 insert into public.orders(organization_id,manufacturer_organization_id,opportunity_id,quote_id,customer_id,salesperson_id,customer_quote_total_snapshot,quote_snapshot,created_by_user_id)
 values(o.organization_id,v_hq,o.id,o.linked_quote_id,o.customer_id,o.salesperson_id,(o.quote_snapshot->'quote'->>'total')::numeric,o.quote_snapshot,auth.uid()) returning id into v_id;
 insert into public.opportunity_activities(organization_id,opportunity_id,activity_type,body,created_by_user_id) values(o.organization_id,o.id,'ORDER_CREATED','Pedido enviado a Nahuitech',auth.uid());
 perform public.network_audit(o.organization_id,'order.created','order',v_id);
 perform public.network_notify(v_hq,'ORDER_REVIEW','Nuevo pedido para revisión','Un distribuidor solicitó un pedido.',v_id);
 return v_id;
end; $$;

-- Locked transitions, monetary math and audit events commit atomically.
create function public.network_order_action(p_id uuid,p_action text,p_data jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;m public.order_payment_milestones%rowtype;v_total numeric(14,2);v_next text;v_type text;v_date date;
begin
 select * into o from public.orders where id=p_id for update;
 if o.id is null then raise exception 'Pedido no disponible';end if;
 perform public.network_assert(o.organization_id);
 if not public.is_network_owner() then raise exception 'Solo HQ puede autorizar pedidos, pagos y producción';end if;
 v_next:=o.status;
 if p_action='approve' then
  if o.status<>'PENDING_HQ_REVIEW' then raise exception 'El pedido ya fue revisado';end if;
  v_total:=(p_data->>'dealer_order_total')::numeric;v_date:=(p_data->>'estimated_completion_date')::date;
  if v_total is null or v_total<=0 or v_date is null or v_date<current_date then raise exception 'Captura monto sell-in positivo y fecha válida';end if;
  update public.orders set dealer_order_total=v_total,estimated_completion_date=v_date where id=p_id;
  insert into public.order_payment_milestones(order_id,milestone_type,percentage,amount) values(p_id,'DEPOSIT',50,round(v_total/2,2)),(p_id,'BALANCE',50,v_total-round(v_total/2,2));
  v_next:='AWAITING_DEPOSIT';
  insert into public.sales_tasks(organization_id,order_id,title,task_type,priority,due_at,automation_key,created_by_system)
  values(o.organization_id,p_id,'Solicitar anticipo','REQUEST_DEPOSIT','HIGH',now(),'deposit:'||p_id,true) on conflict(automation_key) do nothing;
 elsif p_action in ('verify','reject') then
  v_type:=p_data->>'milestone_type';select * into m from public.order_payment_milestones where order_id=p_id and milestone_type=v_type for update;
  if m.id is null or m.status<>'SUBMITTED' or (v_type='DEPOSIT' and o.status<>'DEPOSIT_SUBMITTED') or (v_type='BALANCE' and o.status<>'BALANCE_SUBMITTED') then raise exception 'No hay comprobante pendiente de validar';end if;
  if p_action='reject' then
   if nullif(trim(p_data->>'reason'),'') is null then raise exception 'Indica motivo de rechazo';end if;
   update public.order_payment_milestones set status='REJECTED',rejected_at=now(),rejection_reason=left(p_data->>'reason',2000) where id=m.id;
   v_next:=case when v_type='DEPOSIT' then 'AWAITING_DEPOSIT' else 'AWAITING_BALANCE' end;
  else
   update public.order_payment_milestones set status='VERIFIED',verified_at=now(),verified_by_user_id=auth.uid(),rejection_reason=null where id=m.id;
   if v_type='DEPOSIT' then
    v_next:='RELEASED_TO_PRODUCTION';update public.orders set released_to_production_at=now() where id=p_id;
   else
    v_next:=case when o.production_completed_at is not null then 'READY_TO_SHIP' else 'IN_PRODUCTION' end;
   end if;
   update public.sales_tasks set status='DONE',completed_at=now() where order_id=p_id and task_type=case when v_type='DEPOSIT' then 'REQUEST_DEPOSIT' else 'REQUEST_BALANCE' end and status in ('OPEN','IN_PROGRESS');
  end if;
 elsif p_action='start_production' then
  if o.status<>'RELEASED_TO_PRODUCTION' or not exists(select 1 from public.order_payment_milestones where order_id=p_id and milestone_type='DEPOSIT' and status='VERIFIED') then raise exception 'Se requiere anticipo verificado';end if;
  v_next:='IN_PRODUCTION';update public.orders set production_started_at=now() where id=p_id;
 elsif p_action='complete_production' then
  if o.production_started_at is null or o.production_completed_at is not null or o.status not in ('IN_PRODUCTION','AWAITING_BALANCE','BALANCE_SUBMITTED') then raise exception 'Producción no disponible para terminar';end if;
  update public.orders set production_completed_at=now() where id=p_id;
  v_next:=case when exists(select 1 from public.order_payment_milestones where order_id=p_id and milestone_type='BALANCE' and status='VERIFIED') then 'READY_TO_SHIP' when o.status='BALANCE_SUBMITTED' then 'BALANCE_SUBMITTED' else 'AWAITING_BALANCE' end;
 elsif p_action='date' then
  v_date:=(p_data->>'estimated_completion_date')::date;
  if v_date is null or v_date<current_date or o.status in ('SHIPPED','DELIVERED','CANCELLED') then raise exception 'Fecha o estado no válido';end if;
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

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('sales-network-documents','sales-network-documents',false,8388608,array['application/pdf','image/png','image/jpeg']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- No direct client writes: uploads are checked by the server and finalized by RPC.
create policy network_document_read on storage.objects for select to authenticated using(bucket_id='sales-network-documents' and exists(select 1 from public.order_documents d where d.storage_path=name and public.network_access(d.organization_id)));

create function public.network_attach_document(p_order uuid,p_type text,p_path text,p_name text,p_mime text,p_size bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;v_id uuid;v_type text;v_next text;
begin
 select * into o from public.orders where id=p_order for update;perform public.network_assert(o.organization_id);
 if o.id is null or o.status in ('CANCELLED','DELIVERED') then raise exception 'Pedido no disponible';end if;
 if p_type not in ('PURCHASE_ORDER','DEPOSIT_PROOF','BALANCE_PROOF') and not public.is_network_owner() then raise exception 'Tipo de documento reservado a HQ';end if;
 if p_path not like o.organization_id::text||'/'||o.id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='sales-network-documents' and name=p_path) then raise exception 'Archivo privado no encontrado';end if;
 if p_type='DEPOSIT_PROOF' then
  if o.status<>'AWAITING_DEPOSIT' then raise exception 'El anticipo no está pendiente';end if;
  v_type:='DEPOSIT';v_next:='DEPOSIT_SUBMITTED';
 elsif p_type='BALANCE_PROOF' then
  if o.status not in ('IN_PRODUCTION','AWAITING_BALANCE') then raise exception 'El saldo no está pendiente';end if;
  v_type:='BALANCE';v_next:='BALANCE_SUBMITTED';
 end if;
 if v_type is not null then
  update public.order_payment_milestones set status='SUBMITTED',submitted_at=now(),rejection_reason=null where order_id=p_order and milestone_type=v_type and status in ('PENDING','REJECTED');
  if not found then raise exception 'Milestone no disponible';end if;
  update public.orders set status=v_next where id=p_order;
 end if;
 insert into public.order_documents(order_id,organization_id,document_type,storage_path,original_filename,mime_type,size_bytes,uploaded_by_user_id)
 values(p_order,o.organization_id,p_type,p_path,p_name,p_mime,p_size,auth.uid()) returning id into v_id;
 perform public.network_audit(o.organization_id,case when v_type is not null then 'payment.submitted' else 'document.uploaded' end,'order',p_order,jsonb_build_object('document_id',v_id,'type',p_type));
 if v_type is not null then perform public.network_notify(o.manufacturer_organization_id,'PAYMENT_SUBMITTED','Comprobante pendiente de validar',o.folio||' · '||v_type,p_order);end if;
 return v_id;
end; $$;
do $$ declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('network_create_order','network_order_action','network_attach_document') loop
 execute format('revoke all on function %s from public,anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
COMMIT;
