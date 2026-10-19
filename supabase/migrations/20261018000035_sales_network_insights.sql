BEGIN;
alter table public.organizations add column display_name text;
alter table public.organizations add constraint network_brand_color check(primary_color is null or primary_color ~ '^#[a-fA-F0-9]{6}$');
create table public.sales_goals (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),salesperson_id uuid references public.salespeople(id),user_id uuid references auth.users(id),
 period_start date not null,period_end date not null,target_amount numeric(14,2) not null check(target_amount>0 and target_amount<1000000000000),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(period_end>period_start),check(salesperson_id is null or user_id is null)
);
create unique index network_goals_scope on public.sales_goals(organization_id,period_start,period_end) where salesperson_id is null and user_id is null;
create index network_goals_org on public.sales_goals(organization_id,period_start,period_end);
create table public.network_announcements (
 id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id),audience text not null default 'ALL' check(audience in ('ALL','DEALERS','HQ')),
 announcement_type text not null check(announcement_type in ('NEWS','PRODUCT_LAUNCH','PROMOTION','IMPORTANT')),title text not null check(length(trim(title)) between 1 and 200),body text not null check(length(body) between 1 and 10000),
 published_at timestamptz not null default now(),expires_at timestamptz,created_by_user_id uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(expires_at is null or expires_at>published_at)
);
create index network_news_audience on public.network_announcements(organization_id,audience,published_at);
create table public.organization_modules (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),module_key text not null check(module_key in ('SALES','ORDERS','ANALYTICS','NEWS')),
 enabled boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,module_key)
);
insert into public.organization_modules(organization_id,module_key) select o.id,m from public.organizations o cross join unnest(array['SALES','ORDERS','ANALYTICS','NEWS']) m on conflict do nothing;
do $$ declare t text;begin foreach t in array array['sales_goals','network_announcements','organization_modules'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);
 execute format('create trigger network_updated before update on public.%I for each row execute function public.set_updated_at()',t);
 end loop;end $$;
create policy network_goals_read on public.sales_goals for select to authenticated using(public.network_access(organization_id));
create policy network_modules_read on public.organization_modules for select to authenticated using(public.network_access(organization_id));
create policy network_news_read on public.network_announcements for select to authenticated using(
 public.network_device_valid() and ((public.is_network_owner()) or ((organization_id is null or public.network_access(organization_id)) and audience in ('ALL','DEALERS') and published_at<=now() and (expires_at is null or expires_at>now())))
);

create function public.network_settings(p_org uuid,p_action text,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.network_assert(p_org);if not public.is_network_owner() then raise exception 'Solo HQ';end if;
 if p_action='goal' then
 insert into public.sales_goals(organization_id,period_start,period_end,target_amount) values(p_org,(p_data->>'period_start')::date,(p_data->>'period_end')::date,(p_data->>'target_amount')::numeric)
 on conflict(organization_id,period_start,period_end) where salesperson_id is null and user_id is null do update set target_amount=excluded.target_amount;
 elsif p_action='module' then
 insert into public.organization_modules(organization_id,module_key,enabled) values(p_org,p_data->>'module_key',(p_data->>'enabled')::boolean) on conflict(organization_id,module_key) do update set enabled=excluded.enabled;
 elsif p_action='branding' then
 if nullif(p_data->>'logo_url','') is not null and p_data->>'logo_url' !~ '^https://' then raise exception 'Logo requiere HTTPS';end if;
 update public.organizations set display_name=nullif(left(trim(p_data->>'display_name'),150),''),primary_color=nullif(p_data->>'primary_color',''),logo_url=nullif(p_data->>'logo_url','') where id=p_org;
 elsif p_action='announcement' then
 insert into public.network_announcements(organization_id,audience,announcement_type,title,body,expires_at,created_by_user_id)
 values(case when p_data->>'scope'='ALL' then null else p_org end,coalesce(p_data->>'audience','ALL'),p_data->>'announcement_type',p_data->>'title',p_data->>'body',nullif(p_data->>'expires_at','')::timestamptz,auth.uid());
 else raise exception 'Configuración no válida';end if;
 perform public.network_audit(p_org,'settings.'||p_action,'organization',p_org);
end; $$;

create function public.network_insights(p_org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_month timestamptz:=date_trunc('month',now());v_result jsonb;
begin
 perform public.network_assert(p_org);
 select jsonb_build_object(
 'stages',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select stage,count(*) count,coalesce(sum(estimated_value),0) value from public.opportunities where organization_id=p_org group by stage) x),
 'lost',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select lost_reason,count(*) count from public.opportunities where organization_id=p_org and stage='LOST' group by lost_reason order by count(*) desc) x),
 'products',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select coalesce(nullif(product_interest,''),'Sin especificar') product,count(*) count,coalesce(sum(estimated_value),0) value from public.opportunities where organization_id=p_org group by product_interest order by count(*) desc limit 20) x),
 'orders',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select status,count(*) count,coalesce(sum(dealer_order_total),0) value from public.orders where organization_id=p_org group by status) x),
 'leaders',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select coalesce(s.full_name,'Sin vendedor comercial') name,
 count(*) filter(where o.stage='WON' and o.won_at>=v_month) won,
 coalesce(sum((o.quote_snapshot->'quote'->>'total')::numeric) filter(where o.stage='WON' and o.won_at>=v_month),0) value,
 count(*) filter(where (o.quote_snapshot->'quote'->>'created_at')::timestamptz>=v_month) quotes
 from public.opportunities o left join public.salespeople s on s.id=o.salesperson_id where o.organization_id=p_org group by o.salesperson_id,s.full_name order by value desc limit 20) x),
 'goals',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select g.id,g.target_amount,g.period_start,g.period_end,
 coalesce((select sum((o.quote_snapshot->'quote'->>'total')::numeric) from public.opportunities o where o.organization_id=p_org and o.stage='WON' and o.won_at>=g.period_start and o.won_at<g.period_end and (g.salesperson_id is null or o.salesperson_id=g.salesperson_id) and (g.user_id is null or o.owner_user_id=g.user_id)),0) achieved
 from public.sales_goals g where g.organization_id=p_org and current_date>=g.period_start and current_date<g.period_end) x),
 'machines',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select machine,sum(quantity) quantity from (
 select i->>'machine_name_snapshot' machine,(i->>'quantity')::integer quantity from public.opportunities o cross join lateral jsonb_array_elements(coalesce(o.quote_snapshot->'items','[]')) i where o.organization_id=p_org
 union all select o.quote_snapshot->'quote'->>'machine_name_snapshot',1 from public.opportunities o where o.organization_id=p_org and o.linked_quote_id is not null and jsonb_array_length(coalesce(o.quote_snapshot->'items','[]'))=0
 ) items group by machine order by sum(quantity) desc limit 20) x),
 'lost_products',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select coalesce(product_interest,'Sin especificar') product,lost_reason,count(*) count from public.opportunities where organization_id=p_org and stage='LOST' group by product_interest,lost_reason order by count(*) desc limit 30) x),
 'overdue_tasks',(select count(*) from public.sales_tasks where organization_id=p_org and status in ('OPEN','IN_PROGRESS') and due_at<now()),
 'active_sellers',(select count(*) from public.organization_memberships where organization_id=p_org and active and network_role='SELLER')
 ) into v_result;return v_result;
end; $$;
revoke all on function public.network_settings(uuid,text,jsonb),public.network_insights(uuid) from public,anon;
grant execute on function public.network_settings(uuid,text,jsonb),public.network_insights(uuid) to authenticated;
COMMIT;
