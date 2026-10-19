BEGIN;
-- Additive corrections: keep 00031-00035 byte-for-byte unchanged.
alter table public.opportunities add column customer_name_snapshot text;
update public.opportunities o set customer_name_snapshot=c.name from public.customers c where c.id=o.customer_id;
alter table public.order_documents add column uploaded_by_name_snapshot text;
update public.order_documents d set uploaded_by_name_snapshot=p.full_name from public.profiles p where p.id=d.uploaded_by_user_id;
create function public.network_capture_display_names() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='opportunities' then
  if tg_op='INSERT' or new.customer_id is distinct from old.customer_id then
   new.customer_name_snapshot:=(select name from public.customers where id=new.customer_id);
  end if;
 else new.uploaded_by_name_snapshot:=(select full_name from public.profiles where id=new.uploaded_by_user_id);end if;
 return new;
end; $$;
revoke all on function public.network_capture_display_names() from public,anon,authenticated;
create trigger network_customer_display before insert or update on public.opportunities for each row execute function public.network_capture_display_names();
create trigger network_document_author before insert on public.order_documents for each row execute function public.network_capture_display_names();
-- Repair only network display metadata; never mutate historical commercial quotes.
update public.opportunities o set quote_snapshot=jsonb_set(o.quote_snapshot,'{customer}',jsonb_build_object('id',c.id,'name',c.name,'company',c.company)) from public.customers c where o.customer_id=c.id and o.quote_snapshot is not null and not (o.quote_snapshot ? 'customer');
update public.orders o set quote_snapshot=jsonb_set(o.quote_snapshot,'{customer}',jsonb_build_object('id',c.id,'name',c.name,'company',c.company)) from public.customers c where o.customer_id=c.id and not (o.quote_snapshot ? 'customer');
alter table public.opportunities add constraint network_lost_other_note check(stage<>'LOST' or (lost_reason is not null and (lost_reason<>'OTHER' or coalesce(length(trim(lost_notes)),0)>0)));
create index network_task_priority_due on public.sales_tasks(organization_id,priority_rank,due_at) where status in ('OPEN','IN_PROGRESS');
create index network_devices_user_public on public.network_devices(user_id,device_public_id);

create or replace function public.network_opportunity(p_org uuid,p_action text,p_id uuid default null,p_data jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare o public.opportunities%rowtype; q public.quotes%rowtype; v_stage text; v_customer uuid; v_sales uuid; v_items jsonb;
begin
 perform public.network_assert(p_org);
 if p_action='create' then
  v_customer:=nullif(p_data->>'customer_id','')::uuid; v_sales:=nullif(p_data->>'salesperson_id','')::uuid;
  if v_customer is null and nullif(trim(p_data->>'customer_name'),'') is not null then
   if coalesce(p_data->>'customer_whatsapp','') !~ '^[0-9]{7,15}$' then raise exception 'El WhatsApp del cliente debe tener entre 7 y 15 dígitos';end if;
   insert into public.customers(name,company,whatsapp,email,created_by)
   values(trim(p_data->>'customer_name'),nullif(trim(p_data->>'customer_company'),''),p_data->>'customer_whatsapp',nullif(trim(p_data->>'customer_email'),''),auth.uid()) returning id into v_customer;
  end if;
  if v_customer is not null and not exists(select 1 from public.customers where id=v_customer and created_by=auth.uid()) then raise exception 'Cliente no autorizado'; end if;
  if v_sales is not null and not exists(select 1 from public.salespeople where id=v_sales and active) then raise exception 'Vendedor no válido'; end if;
  insert into public.opportunities(organization_id,title,customer_id,salesperson_id,owner_user_id,estimated_value,product_interest,next_action_at,created_by_user_id)
  values(p_org,p_data->>'title',v_customer,v_sales,auth.uid(),nullif(p_data->>'estimated_value','')::numeric,p_data->>'product_interest',nullif(p_data->>'next_action_at','')::timestamptz,auth.uid()) returning id into p_id;
 else
  select * into o from public.opportunities where id=p_id and organization_id=p_org for update;
  if o.id is null then raise exception 'Oportunidad no disponible'; end if;
  if p_action='stage' then
   v_stage:=p_data->>'stage';
   if v_stage=o.stage then return p_id;end if;
   if v_stage='QUOTED' and o.linked_quote_id is null then raise exception 'Vincula una cotización para pasar a Cotizada';end if;
   if v_stage='WON' and o.linked_quote_id is null then raise exception 'Vincula la cotización antes de marcar la venta ganada';end if;
   if o.stage in ('WON','LOST') and v_stage<>o.stage then raise exception 'Una oportunidad cerrada no puede cambiar de etapa en Beta'; end if;
   if v_stage='LOST' and (nullif(p_data->>'lost_reason','') is null or (p_data->>'lost_reason'='OTHER' and nullif(trim(p_data->>'lost_notes'),'') is null)) then raise exception 'Selecciona motivo de pérdida y nota para Otro'; end if;
   update public.opportunities set stage=v_stage,lost_reason=case when v_stage='LOST' then p_data->>'lost_reason' end,lost_notes=case when v_stage='LOST' then p_data->>'lost_notes' end,won_at=case when v_stage='WON' then now() end,lost_at=case when v_stage='LOST' then now() end,last_activity_at=now() where id=p_id;
   insert into public.opportunity_activities(organization_id,opportunity_id,activity_type,body,created_by_user_id) values(p_org,p_id,'STAGE_CHANGE',o.stage||' → '||v_stage,auth.uid());
  elsif p_action='activity' then
   insert into public.opportunity_activities(organization_id,opportunity_id,activity_type,body,created_by_user_id) values(p_org,p_id,case when p_data->>'activity_type' in ('NOTE','CALL','WHATSAPP','EMAIL','OTHER') then p_data->>'activity_type' else 'NOTE' end,p_data->>'body',auth.uid());
   update public.opportunities set last_activity_at=now(),next_action_at=case when p_data->>'clear_next_action'='on' then null else coalesce(nullif(p_data->>'next_action_at','')::timestamptz,next_action_at) end where id=p_id;
  elsif p_action='link_quote' then
   if exists(select 1 from public.opportunities x where x.linked_quote_id=(p_data->>'quote_id')::uuid and x.organization_id<>p_org) then raise exception 'Esta cotización ya pertenece a otra organización';end if;
   if o.linked_quote_id=(p_data->>'quote_id')::uuid then return p_id;end if;
   if o.stage in ('WON','LOST') then raise exception 'Vincula antes de cerrar la oportunidad'; end if;
   select * into q from public.quotes where id=(p_data->>'quote_id')::uuid and seller_id=auth.uid() and status<>'CANCELLED' for update;
   if exists(select 1 from public.opportunities x where x.linked_quote_id=q.id and x.id<>p_id) then raise exception 'La cotización ya está vinculada a otra oportunidad';end if;
   if q.id is null then raise exception 'Solo puedes vincular una cotización propia vigente'; end if;
   if o.linked_quote_id is not null and o.linked_quote_id<>q.id then raise exception 'La cotización vinculada no se reemplaza'; end if;
   select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order),'[]') into v_items from public.quote_items i where i.quote_id=q.id;
   update public.opportunities set linked_quote_id=q.id,customer_id=q.customer_id,salesperson_id=q.salesperson_id,estimated_value=q.total,stage='QUOTED',last_activity_at=now(),
   quote_snapshot=jsonb_build_object('quote',to_jsonb(q),'customer',(select jsonb_build_object('id',c.id,'name',c.name,'company',c.company) from public.customers c where c.id=q.customer_id),'items',v_items,'addons',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.quote_addons a where a.quote_id=q.id)) where id=p_id;
   insert into public.opportunity_activities(organization_id,opportunity_id,activity_type,body,created_by_user_id) values(p_org,p_id,'QUOTE_LINKED',q.folio,auth.uid());
  else raise exception 'Acción no válida'; end if;
 end if;
 perform public.network_audit(p_org,'opportunity.'||p_action,'opportunity',p_id,jsonb_build_object('stage',p_data->>'stage'));
 return p_id;
end; $$;

create or replace function public.network_order_action(p_id uuid,p_action text,p_data jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;m public.order_payment_milestones%rowtype;v_total numeric(14,2);v_next text;v_type text;v_date date;
begin
 select * into o from public.orders where id=p_id for update;
 if o.id is null then raise exception 'Pedido no disponible';end if;
 perform public.network_assert(o.organization_id);
 if not public.is_network_owner() then raise exception 'Solo HQ puede autorizar pedidos, pagos y producción';end if;
 v_next:=o.status;
 if p_action='approve' then
  if o.status<>'PENDING_HQ_REVIEW' then raise exception 'El pedido ya fue revisado';end if;
  if coalesce(p_data->>'dealer_order_total','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then raise exception 'Captura un monto positivo con máximo dos decimales';end if;
  if coalesce(p_data->>'estimated_completion_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Selecciona una fecha válida';end if;
  v_total:=(p_data->>'dealer_order_total')::numeric;v_date:=(p_data->>'estimated_completion_date')::date;
  if v_total is null or v_total<=0 or v_date is null or v_date<(now() at time zone 'America/Mexico_City')::date then raise exception 'Captura monto sell-in positivo y fecha válida';end if;
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

create or replace function public.refresh_sales_network_tasks(p_org uuid) returns void language plpgsql security definer set search_path='' as $$
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
 insert into public.sales_tasks(organization_id,order_id,task_type,title,description,priority,due_at,automation_key,created_by_system)
 select o.organization_id,o.id,'REQUEST_BALANCE','Solicitar liquidación','El pedido '||o.folio||' está próximo a concluir. Solicita la liquidación pendiente al distribuidor.','HIGH',now(),'balance:'||o.id,true
 from public.orders o join public.order_payment_milestones m on m.order_id=o.id and m.milestone_type='BALANCE'
 where o.organization_id=p_org and o.status in ('IN_PRODUCTION','AWAITING_BALANCE') and o.estimated_completion_date<=(now() at time zone 'America/Mexico_City')::date+public.network_balance_request_days() and m.status in ('PENDING','REJECTED')
 on conflict(automation_key) do nothing;
 insert into public.network_notifications(organization_id,type,title,body,source_type,source_id,dedupe_key)
 select organization_id,'BALANCE_DUE','Solicitar liquidación',description,'order',order_id,'balance:'||order_id from public.sales_tasks t where organization_id=p_org and task_type='REQUEST_BALANCE' and created_by_system and status in ('OPEN','IN_PROGRESS') and exists(select 1 from public.order_payment_milestones m where m.order_id=t.order_id and m.milestone_type='BALANCE' and m.status in ('PENDING','REJECTED'))
 on conflict(dedupe_key) do nothing;
 -- Close obsolete reminders instead of leaving misleading work on the dashboard.
 update public.sales_tasks t set status='DONE',completed_at=now() where t.organization_id=p_org and t.created_by_system and t.status in ('OPEN','IN_PROGRESS') and (
 (t.task_type='ORDER_REVIEW' and exists(select 1 from public.orders o where o.opportunity_id=t.opportunity_id)) or
 (t.task_type in ('FOLLOW_UP','CALL','QUOTE_EXPIRING') and exists(select 1 from public.opportunities o where o.id=t.opportunity_id and o.stage in ('WON','LOST'))) or
 (t.task_type in ('REQUEST_DEPOSIT','REQUEST_BALANCE') and exists(select 1 from public.order_payment_milestones m where m.order_id=t.order_id and m.status='VERIFIED' and m.milestone_type=case when t.task_type='REQUEST_DEPOSIT' then 'DEPOSIT' else 'BALANCE' end)));
end; $$;

create function public.network_activate_result(p_hash text,p_device uuid,p_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.dealer_activation_codes%rowtype;u uuid:=auth.uid();
begin
 if u is null or not exists(select 1 from public.profiles where id=u and active) then raise exception 'Autenticación requerida';end if;
 perform pg_advisory_xact_lock(hashtext(u::text));
 if (select count(*) from public.network_activation_attempts where user_id=u and created_at>now()-interval '15 minutes')>=10 then return jsonb_build_object('status','RATE_LIMITED');end if;
 insert into public.network_activation_attempts(user_id) values(u);
 select * into c from public.dealer_activation_codes where code_hash=p_hash for update;
 if c.id is null or not c.active then return jsonb_build_object('status','INVALID');end if;
 if c.expires_at<=now() then return jsonb_build_object('status','EXPIRED');end if;
 if c.max_uses is not null and c.use_count>=c.max_uses then return jsonb_build_object('status','EXHAUSTED');end if;
 if not exists(select 1 from public.organizations where id=c.organization_id and status='ACTIVE') then return jsonb_build_object('status','UNAVAILABLE');end if;
 if exists(select 1 from public.organization_memberships where user_id=u and organization_id=c.organization_id and not active) then return jsonb_build_object('status','INACTIVE');end if;
 if exists(select 1 from public.network_devices where user_id=u and device_public_id=p_device and revoked_at is not null) then return jsonb_build_object('status','REVOKED');end if;
 insert into public.organization_memberships(organization_id,user_id,network_role) values(c.organization_id,u,'SELLER') on conflict(organization_id,user_id) do nothing;
 insert into public.network_devices(organization_id,user_id,device_public_id,device_name) values(c.organization_id,u,p_device,left(p_name,100)) on conflict(organization_id,user_id,device_public_id) do update set last_seen_at=now();
 update public.dealer_activation_codes set use_count=use_count+1 where id=c.id;
 return jsonb_build_object('status','OK','organization_id',c.organization_id);
end; $$;
revoke all on function public.network_activate_result(text,uuid,text) from public,anon;
grant execute on function public.network_activate_result(text,uuid,text) to authenticated;
create or replace function public.network_activate(p_hash text,p_device uuid,p_name text) returns uuid language plpgsql security definer set search_path='' as $$
begin return (public.network_activate_result(p_hash,p_device,p_name)->>'organization_id')::uuid;end; $$;
COMMIT;
