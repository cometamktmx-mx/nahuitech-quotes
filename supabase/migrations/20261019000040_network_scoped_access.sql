BEGIN;
-- Nahuitech HQ authority is scoped to its network, not every future manufacturer.
create or replace function public.is_network_owner() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id join public.profiles p on p.id=m.user_id
 where m.user_id=auth.uid() and m.active and p.active and o.status='ACTIVE' and o.slug='nahuitech' and o.organization_type='MANUFACTURER' and m.network_role in ('NETWORK_OWNER','ORG_ADMIN'));
$$;
create or replace function public.network_access(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.network_device_valid() and (
 (public.is_network_owner() and (exists(select 1 from public.organizations where id=p_org and slug='nahuitech') or exists(select 1 from public.dealer_supplier_relationships r join public.organizations s on s.id=r.supplier_organization_id where r.dealer_organization_id=p_org and r.authorized and r.status='ACTIVE' and s.slug='nahuitech')))
 or (public.is_org_member(p_org) and exists(select 1 from public.network_devices d where d.organization_id=p_org and d.user_id=auth.uid() and d.revoked_at is null and d.device_public_id::text=(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-network-device'))));
$$;
create function public.network_order_access(p_order uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o where o.id=p_order and (
  (public.is_org_member(o.organization_id) and public.network_access(o.organization_id)) or
  (public.is_org_member(o.manufacturer_organization_id) and public.network_access(o.manufacturer_organization_id))));
$$;
drop policy network_org_read on public.organizations;
create policy network_org_scoped on public.organizations for select to authenticated using(public.is_org_member(id) or (public.is_network_owner() and public.network_access(id)));
drop policy network_read on public.orders;
create policy network_order_scoped on public.orders for select to authenticated using(public.network_order_access(id));
drop policy network_read on public.order_documents;
create policy network_order_document_scoped on public.order_documents for select to authenticated using(public.network_order_access(order_id));
drop policy network_payment_read on public.order_payment_milestones;
create policy network_payment_scoped on public.order_payment_milestones for select to authenticated using(public.network_order_access(order_id));
drop policy network_document_read on storage.objects;
create policy network_document_read on storage.objects for select to authenticated using(bucket_id='sales-network-documents' and exists(select 1 from public.order_documents d where d.storage_path=name and public.network_order_access(d.order_id)));
create policy network_attributed_quote_scope on public.quotes as restrictive for select to authenticated using(organization_id is null or public.network_access(organization_id));
-- Reject a caller's new supplier membership from gaining network-wide overview RPCs.
revoke all on function public.network_order_access(uuid) from public,anon;grant execute on function public.network_order_access(uuid) to authenticated;
create or replace function public.network_dashboard(p_org uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_org is null then if not public.is_network_owner() or not public.network_device_valid() then raise exception 'Solo HQ';end if;
 else perform public.network_assert(p_org);end if;
 select jsonb_build_object(
 'pipeline',coalesce(sum(estimated_value) filter(where stage in ('NEW','QUOTED','NEGOTIATION')),0),
 'quoted_month',coalesce(sum((quote_snapshot->'quote'->>'total')::numeric) filter(where (quote_snapshot->'quote'->>'created_at')::timestamptz>=date_trunc('month',now())),0),
 'opportunities',count(*) filter(where stage in ('NEW','QUOTED','NEGOTIATION')),
 'won',coalesce(sum(estimated_value) filter(where stage='WON'),0)) into result from public.opportunities where (p_org is null or organization_id=p_org) and public.network_access(organization_id);
 return result||jsonb_build_object(
 'orders',(select count(*) from public.orders where (p_org is null or organization_id=p_org) and public.network_order_access(id) and status not in ('DELIVERED','CANCELLED')),
 'tasks',(select count(*) from public.sales_tasks where (p_org is null or coalesce(audience_organization_id,organization_id)=p_org) and public.network_access(organization_id) and status in ('OPEN','IN_PROGRESS')),
 'deposits',(select coalesce(sum(m.amount),0) from public.order_payment_milestones m join public.orders o on o.id=m.order_id where (p_org is null or o.organization_id=p_org) and public.network_order_access(o.id) and m.milestone_type='DEPOSIT' and m.status<>'VERIFIED' and o.status<>'CANCELLED'),
 'balances',(select coalesce(sum(m.amount),0) from public.order_payment_milestones m join public.orders o on o.id=m.order_id where (p_org is null or o.organization_id=p_org) and public.network_order_access(o.id) and m.milestone_type='BALANCE' and m.status<>'VERIFIED' and o.status<>'CANCELLED'));
end; $$;
create or replace function public.network_refresh_all_tasks() returns void language plpgsql security definer set search_path='' as $$
declare g record;begin
 if not public.is_network_owner() or not public.network_device_valid() then raise exception 'Solo HQ';end if;
 for g in select id from public.organizations where status='ACTIVE' and public.network_access(id) loop perform public.refresh_sales_network_tasks(g.id);end loop;
end; $$;
create or replace function public.network_dealer_summary() returns table(organization_id uuid,name text,opportunities bigint,won bigint) language plpgsql security definer set search_path='' as $$
begin
 if not public.is_network_owner() or not public.network_device_valid() then raise exception 'Solo HQ';end if;
 return query select g.id,g.name,count(o.id),count(o.id) filter(where o.stage='WON') from public.organizations g left join public.opportunities o on o.organization_id=g.id where public.network_access(g.id) group by g.id,g.name order by g.name;
end; $$;
create or replace function public.network_device_directory(p_org uuid default null) returns table(id uuid,organization_name text,user_name text,device_name text,last_seen_at timestamptz,revoked_at timestamptz) language plpgsql security definer set search_path='' as $$
begin
 if p_org is null then
 if not public.is_network_owner() or not public.network_device_valid() then raise exception 'Solo HQ';end if;
 else perform public.network_assert(p_org);if not public.can_manage_org(p_org) then raise exception 'Permiso de administración requerido';end if;end if;
 return query select d.id,o.name,p.full_name,d.device_name,d.last_seen_at,d.revoked_at from public.network_devices d join public.organizations o on o.id=d.organization_id join public.profiles p on p.id=d.user_id where (p_org is null or d.organization_id=p_org) and public.network_access(d.organization_id) order by d.last_seen_at desc limit 200;
end; $$;
-- Operational reminders close only when the underlying transaction advances.
alter function public.network_task(uuid,uuid,jsonb) rename to network_task_legacy;
revoke all on function public.network_task_legacy(uuid,uuid,jsonb) from public,anon,authenticated;
create function public.network_task(p_org uuid,p_id uuid default null,p_data jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform public.network_assert(p_org);
 if exists(select 1 from public.sales_tasks where id=p_id and automation_key like 'operation:%') then raise exception 'Esta tarea se completa al avanzar el pedido';end if;
 return public.network_task_legacy(p_org,p_id,p_data);
end;$$;
revoke all on function public.network_task(uuid,uuid,jsonb) from public,anon;
grant execute on function public.network_task(uuid,uuid,jsonb) to authenticated;
COMMIT;
