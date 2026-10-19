BEGIN;
create table public.opportunities (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), customer_id uuid references public.customers(id),
 salesperson_id uuid references public.salespeople(id), owner_user_id uuid references auth.users(id), title text not null check(length(trim(title)) between 1 and 200),
 stage text not null default 'NEW' check(stage in ('NEW','QUOTED','NEGOTIATION','WON','LOST')),
 estimated_value numeric(14,2) check(estimated_value>=0 and estimated_value<1000000000000), product_interest text, linked_quote_id uuid unique references public.quotes(id),
 quote_snapshot jsonb, last_activity_at timestamptz not null default now(), next_action_at timestamptz,
 lost_reason text check(lost_reason in ('PRICE','FINANCING','COMPETITOR','DELIVERY_TIME','NO_RESPONSE','PROJECT_CANCELLED','OTHER')), lost_notes text,
 won_at timestamptz,lost_at timestamptz,created_by_user_id uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(stage<>'LOST' or (lost_reason is not null and (lost_reason<>'OTHER' or length(trim(lost_notes))>0))), unique(id,organization_id)
);
create index network_opportunities_org_stage on public.opportunities(organization_id,stage,created_at);
create index network_opportunities_owner on public.opportunities(owner_user_id);
create table public.opportunity_activities (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),opportunity_id uuid not null,
 activity_type text not null check(activity_type in ('NOTE','CALL','WHATSAPP','EMAIL','STAGE_CHANGE','QUOTE_LINKED','TASK_CREATED','ORDER_CREATED','OTHER')),
 body text not null check(length(trim(body)) between 1 and 4000),created_by_user_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(opportunity_id,organization_id) references public.opportunities(id,organization_id)
);
create index network_activities_opportunity on public.opportunity_activities(organization_id,opportunity_id,created_at);
create table public.sales_tasks (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),opportunity_id uuid,order_id uuid,
 customer_id uuid references public.customers(id),assigned_user_id uuid references auth.users(id),salesperson_id uuid references public.salespeople(id),
 task_type text not null check(task_type in ('FOLLOW_UP','CALL','QUOTE_EXPIRING','REQUEST_DEPOSIT','REQUEST_BALANCE','ORDER_REVIEW','CUSTOM')),
 title text not null check(length(trim(title)) between 1 and 200),description text,priority text not null default 'MEDIUM' check(priority in ('LOW','MEDIUM','HIGH','URGENT')),
 status text not null default 'OPEN' check(status in ('OPEN','IN_PROGRESS','DONE','CANCELLED')),due_at timestamptz not null,completed_at timestamptz,
 automation_key text unique,created_by_system boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 priority_rank integer generated always as (case priority when 'URGENT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end) stored,
 foreign key(opportunity_id,organization_id) references public.opportunities(id,organization_id)
);
create index network_tasks_org_due on public.sales_tasks(organization_id,status,due_at);
create table public.network_audit_log (
 id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id),actor_user_id uuid not null references auth.users(id),
 action text not null,entity_type text not null,entity_id uuid not null,metadata jsonb not null default '{}',created_at timestamptz not null default now()
);
create index network_audit_entity on public.network_audit_log(organization_id,entity_id,created_at);
create function public.network_audit(p_org uuid,p_action text,p_type text,p_id uuid,p_meta jsonb default '{}') returns void language sql security definer set search_path='' as $$
 insert into public.network_audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(p_org,auth.uid(),p_action,p_type,p_id,p_meta);
$$;
revoke all on function public.network_audit(uuid,text,text,uuid,jsonb) from public,anon,authenticated;

-- All active members collaborate inside their organization in Beta. No cross-dealer reads.
do $$ declare t text; begin foreach t in array array['opportunities','opportunity_activities','sales_tasks','network_audit_log'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy network_read on public.%I for select to authenticated using(public.network_access(organization_id))',t);
 end loop;
 foreach t in array array['opportunities','sales_tasks'] loop execute format('create trigger network_updated before update on public.%I for each row execute function public.set_updated_at()',t); end loop;
end $$;

create function public.network_opportunity(p_org uuid,p_action text,p_id uuid default null,p_data jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare o public.opportunities%rowtype; q public.quotes%rowtype; v_stage text; v_customer uuid; v_sales uuid; v_items jsonb;
begin
 perform public.network_assert(p_org);
 if p_action='create' then
  v_customer:=nullif(p_data->>'customer_id','')::uuid; v_sales:=nullif(p_data->>'salesperson_id','')::uuid;
  if v_customer is not null and not exists(select 1 from public.customers where id=v_customer and created_by=auth.uid()) then raise exception 'Cliente no autorizado'; end if;
  if v_sales is not null and not exists(select 1 from public.salespeople where id=v_sales and active) then raise exception 'Vendedor no válido'; end if;
  insert into public.opportunities(organization_id,title,customer_id,salesperson_id,owner_user_id,estimated_value,product_interest,next_action_at,created_by_user_id)
  values(p_org,p_data->>'title',v_customer,v_sales,auth.uid(),nullif(p_data->>'estimated_value','')::numeric,p_data->>'product_interest',nullif(p_data->>'next_action_at','')::timestamptz,auth.uid()) returning id into p_id;
 else
  select * into o from public.opportunities where id=p_id and organization_id=p_org for update;
  if o.id is null then raise exception 'Oportunidad no disponible'; end if;
  if p_action='stage' then
   v_stage:=p_data->>'stage';
   if v_stage='WON' and o.linked_quote_id is null then raise exception 'Vincula la cotización antes de marcar la venta ganada';end if;
   if o.stage in ('WON','LOST') and v_stage<>o.stage then raise exception 'Una oportunidad cerrada no puede cambiar de etapa en Beta'; end if;
   if v_stage='LOST' and (nullif(p_data->>'lost_reason','') is null or (p_data->>'lost_reason'='OTHER' and nullif(trim(p_data->>'lost_notes'),'') is null)) then raise exception 'Selecciona motivo de pérdida y nota para Otro'; end if;
   update public.opportunities set stage=v_stage,lost_reason=case when v_stage='LOST' then p_data->>'lost_reason' end,lost_notes=case when v_stage='LOST' then p_data->>'lost_notes' end,won_at=case when v_stage='WON' then now() end,lost_at=case when v_stage='LOST' then now() end,last_activity_at=now() where id=p_id;
   insert into public.opportunity_activities(organization_id,opportunity_id,activity_type,body,created_by_user_id) values(p_org,p_id,'STAGE_CHANGE',o.stage||' → '||v_stage,auth.uid());
  elsif p_action='activity' then
   insert into public.opportunity_activities(organization_id,opportunity_id,activity_type,body,created_by_user_id) values(p_org,p_id,case when p_data->>'activity_type' in ('NOTE','CALL','WHATSAPP','EMAIL','OTHER') then p_data->>'activity_type' else 'NOTE' end,p_data->>'body',auth.uid());
   update public.opportunities set last_activity_at=now(),next_action_at=nullif(p_data->>'next_action_at','')::timestamptz where id=p_id;
  elsif p_action='link_quote' then
   if o.stage in ('WON','LOST') then raise exception 'Vincula antes de cerrar la oportunidad'; end if;
   select * into q from public.quotes where id=(p_data->>'quote_id')::uuid and seller_id=auth.uid() and status<>'CANCELLED';
   if q.id is null then raise exception 'Solo puedes vincular una cotización propia vigente'; end if;
   if o.linked_quote_id is not null and o.linked_quote_id<>q.id then raise exception 'La cotización vinculada no se reemplaza'; end if;
   select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order),'[]') into v_items from public.quote_items i where i.quote_id=q.id;
   update public.opportunities set linked_quote_id=q.id,customer_id=q.customer_id,salesperson_id=q.salesperson_id,estimated_value=q.total,stage='QUOTED',last_activity_at=now(),
   quote_snapshot=jsonb_build_object('quote',to_jsonb(q),'items',v_items,'addons',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.quote_addons a where a.quote_id=q.id)) where id=p_id;
   insert into public.opportunity_activities(organization_id,opportunity_id,activity_type,body,created_by_user_id) values(p_org,p_id,'QUOTE_LINKED',q.folio,auth.uid());
  else raise exception 'Acción no válida'; end if;
 end if;
 perform public.network_audit(p_org,'opportunity.'||p_action,'opportunity',p_id,jsonb_build_object('stage',p_data->>'stage'));
 return p_id;
end; $$;
revoke all on function public.network_opportunity(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.network_opportunity(uuid,text,uuid,jsonb) to authenticated;

create function public.network_task(p_org uuid,p_id uuid default null,p_data jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
begin perform public.network_assert(p_org);
 if p_id is null then
 insert into public.sales_tasks(organization_id,opportunity_id,title,description,task_type,priority,due_at,assigned_user_id)
 values(p_org,nullif(p_data->>'opportunity_id','')::uuid,p_data->>'title',p_data->>'description','CUSTOM',coalesce(p_data->>'priority','MEDIUM'),(p_data->>'due_at')::timestamptz,auth.uid()) returning id into p_id;
 else
 update public.sales_tasks set status=p_data->>'status',completed_at=case when p_data->>'status'='DONE' then now() end where id=p_id and organization_id=p_org;
 if not found then raise exception 'Tarea no disponible'; end if;
 end if; return p_id;
end; $$;
revoke all on function public.network_task(uuid,uuid,jsonb) from public,anon;
grant execute on function public.network_task(uuid,uuid,jsonb) to authenticated;
COMMIT;
