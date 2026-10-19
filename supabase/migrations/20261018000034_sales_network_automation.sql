BEGIN;
-- Central rule. Keep this DB function as the single source of truth until Rules Engine.
create function public.network_balance_request_days() returns integer language sql immutable as $$ select 10; $$;
comment on function public.network_balance_request_days() is 'BALANCE_REQUEST_DAYS_BEFORE_COMPLETION = 10';
create function public.refresh_sales_network_tasks(p_org uuid) returns void language plpgsql security definer set search_path='' as $$
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
 where o.organization_id=p_org and o.status in ('IN_PRODUCTION','AWAITING_BALANCE') and o.estimated_completion_date<=current_date+public.network_balance_request_days() and m.status<>'VERIFIED'
 on conflict(automation_key) do nothing;
 insert into public.network_notifications(organization_id,type,title,body,source_type,source_id,dedupe_key)
 select organization_id,'BALANCE_DUE','Solicitar liquidación',description,'order',order_id,'balance:'||order_id from public.sales_tasks where organization_id=p_org and task_type='REQUEST_BALANCE' and created_by_system
 on conflict(dedupe_key) do nothing;
 -- Close obsolete reminders instead of leaving misleading work on the dashboard.
 update public.sales_tasks t set status='DONE',completed_at=now() where t.organization_id=p_org and t.created_by_system and t.status in ('OPEN','IN_PROGRESS') and (
 (t.task_type='ORDER_REVIEW' and exists(select 1 from public.orders o where o.opportunity_id=t.opportunity_id)) or
 (t.task_type in ('FOLLOW_UP','CALL','QUOTE_EXPIRING') and exists(select 1 from public.opportunities o where o.id=t.opportunity_id and o.stage in ('WON','LOST'))) or
 (t.task_type in ('REQUEST_DEPOSIT','REQUEST_BALANCE') and exists(select 1 from public.order_payment_milestones m where m.order_id=t.order_id and m.status='VERIFIED' and m.milestone_type=case when t.task_type='REQUEST_DEPOSIT' then 'DEPOSIT' else 'BALANCE' end)));
end; $$;

create function public.network_dashboard(p_org uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_org is null then if not public.is_network_owner() or not public.network_device_valid() then raise exception 'Solo HQ';end if;
 else perform public.network_assert(p_org);end if;
 select jsonb_build_object(
 'pipeline',coalesce(sum(estimated_value) filter(where stage in ('NEW','QUOTED','NEGOTIATION')),0),
 'quoted_month',coalesce(sum((quote_snapshot->'quote'->>'total')::numeric) filter(where (quote_snapshot->'quote'->>'created_at')::timestamptz>=date_trunc('month',now())),0),
 'opportunities',count(*) filter(where stage in ('NEW','QUOTED','NEGOTIATION')),
 'won',coalesce(sum(estimated_value) filter(where stage='WON'),0)) into result from public.opportunities where p_org is null or organization_id=p_org;
 return result||jsonb_build_object(
 'orders',(select count(*) from public.orders where (p_org is null or organization_id=p_org) and status not in ('DELIVERED','CANCELLED')),
 'tasks',(select count(*) from public.sales_tasks where (p_org is null or organization_id=p_org) and status in ('OPEN','IN_PROGRESS')),
 'deposits',(select coalesce(sum(m.amount),0) from public.order_payment_milestones m join public.orders o on o.id=m.order_id where (p_org is null or o.organization_id=p_org) and m.milestone_type='DEPOSIT' and m.status<>'VERIFIED' and o.status<>'CANCELLED'),
 'balances',(select coalesce(sum(m.amount),0) from public.order_payment_milestones m join public.orders o on o.id=m.order_id where (p_org is null or o.organization_id=p_org) and m.milestone_type='BALANCE' and m.status<>'VERIFIED' and o.status<>'CANCELLED'));
end; $$;
create function public.network_read_notification(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid;begin select organization_id into v_org from public.network_notifications where id=p_id;perform public.network_assert(v_org);
 update public.network_notifications set read_at=now() where id=p_id;end; $$;
create function public.network_revoke_device(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid;begin select organization_id into v_org from public.network_devices where id=p_id;perform public.network_assert(v_org);
 if not public.can_manage_org(v_org) then raise exception 'Permiso de administración requerido';end if;
 update public.network_devices set revoked_at=now() where id=p_id;
 perform public.network_audit(v_org,'device.revoked','device',p_id);end; $$;
create function public.network_touch_device() returns void language sql security definer set search_path='' as $$
 update public.network_devices set last_seen_at=now() where user_id=auth.uid() and revoked_at is null and last_seen_at<now()-interval '15 minutes'
 and device_public_id::text=(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-network-device');
$$;
create function public.network_refresh_all_tasks() returns void language plpgsql security definer set search_path='' as $$
declare g record;begin
 if not public.is_network_owner() or not public.network_device_valid() then raise exception 'Solo HQ';end if;
 for g in select id from public.organizations where status='ACTIVE' loop perform public.refresh_sales_network_tasks(g.id);end loop;
end; $$;
create function public.network_dealer_summary() returns table(organization_id uuid,name text,opportunities bigint,won bigint) language plpgsql security definer set search_path='' as $$
begin
 if not public.is_network_owner() or not public.network_device_valid() then raise exception 'Solo HQ';end if;
 return query select g.id,g.name,count(o.id),count(o.id) filter(where o.stage='WON') from public.organizations g left join public.opportunities o on o.organization_id=g.id group by g.id,g.name order by g.name;
end; $$;
create function public.network_device_directory(p_org uuid default null) returns table(id uuid,organization_name text,user_name text,device_name text,last_seen_at timestamptz,revoked_at timestamptz) language plpgsql security definer set search_path='' as $$
begin
 if p_org is null then
 if not public.is_network_owner() or not public.network_device_valid() then raise exception 'Solo HQ';end if;
 else perform public.network_assert(p_org);if not public.can_manage_org(p_org) then raise exception 'Permiso de administración requerido';end if;end if;
 return query select d.id,o.name,p.full_name,d.device_name,d.last_seen_at,d.revoked_at from public.network_devices d join public.organizations o on o.id=d.organization_id join public.profiles p on p.id=d.user_id where p_org is null or d.organization_id=p_org order by d.last_seen_at desc limit 200;
end; $$;
do $$ declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('network_balance_request_days','refresh_sales_network_tasks','network_dashboard','network_read_notification','network_revoke_device','network_touch_device','network_dealer_summary','network_refresh_all_tasks','network_device_directory') loop
 execute format('revoke all on function %s from public,anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
COMMIT;
