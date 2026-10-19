BEGIN;
alter table public.quotes add column organization_id uuid references public.organizations(id),add column branch_id uuid references public.organization_branches(id),
 add column organization_name_snapshot text,add column organization_logo_url_snapshot text,
 add column branch_name_snapshot text,add column salesperson_phone_snapshot text,add column salesperson_email_snapshot text,add column organization_branding_snapshot jsonb;
create index network_quotes_org_date on public.quotes(organization_id,created_at);
create function public.network_quote_attribution() returns trigger language plpgsql security definer set search_path='' as $$
declare g public.organizations%rowtype;s public.salespeople%rowtype;v_org uuid;
begin
 if tg_op='UPDATE' then
  if row(new.organization_id,new.branch_id,new.created_by_user_id,new.organization_name_snapshot,new.organization_logo_url_snapshot,new.branch_name_snapshot,new.salesperson_phone_snapshot,new.salesperson_email_snapshot,new.organization_branding_snapshot)
   is distinct from row(old.organization_id,old.branch_id,old.created_by_user_id,old.organization_name_snapshot,old.organization_logo_url_snapshot,old.branch_name_snapshot,old.salesperson_phone_snapshot,old.salesperson_email_snapshot,old.organization_branding_snapshot) then raise exception 'La atribución histórica no se modifica';end if;return new;
 end if;
 new.created_by_user_id:=coalesce(new.created_by_user_id,new.seller_id);
 select * into s from public.salespeople where id=new.salesperson_id;
 new.salesperson_phone_snapshot:=s.phone;new.salesperson_email_snapshot:=s.email;
 begin v_org:=nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-network-org','')::uuid;exception when invalid_text_representation then v_org:=null;end;
 if v_org is null then return new;end if;
 -- A selection cookie alone is never authority, and legacy/offline calls still work.
 if not public.is_org_member(v_org) or not public.network_access(v_org) then return new;end if;
 if s.organization_id is not null and s.organization_id<>v_org then raise exception 'Vendedor de otra organización';end if;
 select * into g from public.organizations where id=v_org;
 new.organization_id:=g.id;new.organization_name_snapshot:=coalesce(g.display_name,g.name);new.organization_logo_url_snapshot:=g.logo_url;
 if s.organization_id=g.id then new.branch_id:=s.branch_id;select name into new.branch_name_snapshot from public.organization_branches where id=s.branch_id;end if;
 new.organization_branding_snapshot:=jsonb_build_object('name',new.organization_name_snapshot,'logo_url',g.logo_url,'label',g.authorized_distributor_label,'footer',g.quote_footer_text,'type',g.organization_type);
 return new;
end;$$;
create trigger network_quote_attribution before insert or update on public.quotes for each row execute function public.network_quote_attribution();
revoke all on function public.network_quote_attribution() from public,anon,authenticated;

alter table public.orders add column dealer_organization_id uuid references public.organizations(id),add column supplier_organization_id uuid references public.organizations(id),add column branch_id uuid references public.organization_branches(id),
 add column dealer_name_snapshot text,add column dealer_logo_snapshot text,add column branch_name_snapshot text,
 add column salesperson_name_snapshot text,add column salesperson_phone_snapshot text,add column salesperson_email_snapshot text,
 add column customer_name_snapshot text,add column customer_company_snapshot text,add column customer_phone_snapshot text,add column customer_email_snapshot text,add column supplier_name_snapshot text;
update public.orders set dealer_organization_id=organization_id,supplier_organization_id=manufacturer_organization_id,
 salesperson_name_snapshot=quote_snapshot->'quote'->>'salesperson_name_snapshot',customer_name_snapshot=quote_snapshot->'customer'->>'name',customer_company_snapshot=quote_snapshot->'customer'->>'company';
alter table public.orders add constraint network_order_parties check(dealer_organization_id=organization_id and supplier_organization_id=manufacturer_organization_id);
create index network_orders_supplier on public.orders(supplier_organization_id,status,created_at);
create table public.order_items(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,machine_id uuid references public.machines(id),
 machine_name_snapshot text not null,variant_snapshot jsonb,image_url_snapshot text,quantity integer not null check(quantity>0),configuration_snapshot jsonb not null,
 sell_out_unit_price_snapshot numeric(14,2),sell_out_line_total_snapshot numeric(14,2),sort_order integer not null,
 created_at timestamptz not null default now(),unique(order_id,sort_order)
);
create function public.network_order_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype;g public.organizations%rowtype;s public.salespeople%rowtype;c public.customers%rowtype;
begin
 select * into q from public.quotes where id=new.quote_id;
 select * into g from public.organizations where id=new.organization_id;
 select * into s from public.salespeople where id=new.salesperson_id;
 select * into c from public.customers where id=new.customer_id;
 new.dealer_organization_id:=new.organization_id;new.supplier_organization_id:=new.manufacturer_organization_id;
 new.branch_id:=q.branch_id;new.branch_name_snapshot:=q.branch_name_snapshot;
 new.dealer_name_snapshot:=coalesce(q.organization_name_snapshot,g.display_name,g.name);new.dealer_logo_snapshot:=coalesce(q.organization_logo_url_snapshot,g.logo_url);
 new.salesperson_name_snapshot:=q.salesperson_name_snapshot;new.salesperson_phone_snapshot:=coalesce(q.salesperson_phone_snapshot,s.phone);new.salesperson_email_snapshot:=coalesce(q.salesperson_email_snapshot,s.email);
 new.customer_name_snapshot:=c.name;new.customer_company_snapshot:=c.company;new.customer_phone_snapshot:=c.whatsapp;new.customer_email_snapshot:=c.email;
 select coalesce(display_name,name) into new.supplier_name_snapshot from public.organizations where id=new.manufacturer_organization_id;
 return new;
end;$$;
create trigger network_order_snapshot before insert on public.orders for each row execute function public.network_order_snapshot();
create function public.network_snapshot_order_items(p_order uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;j jsonb;n integer:=0;
begin
 select * into o from public.orders where id=p_order;
 if jsonb_array_length(coalesce(o.quote_snapshot->'items','[]'))>0 then
  for j in select value from jsonb_array_elements(o.quote_snapshot->'items') loop
   insert into public.order_items(order_id,machine_id,machine_name_snapshot,variant_snapshot,image_url_snapshot,quantity,configuration_snapshot,sell_out_unit_price_snapshot,sell_out_line_total_snapshot,sort_order)
   values(o.id,(j->>'machine_id')::uuid,j->>'machine_name_snapshot',jsonb_build_object('name',j->>'machine_variant_name_snapshot','type',j->>'machine_variant_type_snapshot'),j->>'machine_image_url_snapshot',(j->>'quantity')::integer,
    jsonb_build_object('item',j,'addons',(select coalesce(jsonb_agg(a),'[]') from jsonb_array_elements(o.quote_snapshot->'addons') a where a->>'quote_item_id'=j->>'id')),round((j->>'line_gross_total')::numeric/(j->>'quantity')::integer,2),(j->>'line_gross_total')::numeric,n) on conflict do nothing;n:=n+1;
  end loop;
 else
  j:=o.quote_snapshot->'quote';
  insert into public.order_items(order_id,machine_id,machine_name_snapshot,variant_snapshot,image_url_snapshot,quantity,configuration_snapshot,sell_out_unit_price_snapshot,sell_out_line_total_snapshot,sort_order)
  values(o.id,nullif(j->>'machine_id','')::uuid,coalesce(j->>'machine_name_snapshot','Equipo histórico'),jsonb_build_object('name',j->>'machine_variant_name_snapshot'),j->>'machine_image_url_snapshot',1,o.quote_snapshot,(j->>'total')::numeric,(j->>'total')::numeric,0) on conflict do nothing;
 end if;
end;$$;
create function public.network_order_items_insert() returns trigger language plpgsql security definer set search_path='' as $$begin perform public.network_snapshot_order_items(new.id);return new;end;$$;
create trigger network_order_items after insert on public.orders for each row execute function public.network_order_items_insert();
select public.network_snapshot_order_items(id) from public.orders;
alter table public.order_items enable row level security;revoke all on public.order_items from public,anon,authenticated;grant select on public.order_items to authenticated;
create policy network_order_item_read on public.order_items for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id));
revoke all on function public.network_order_snapshot(),public.network_snapshot_order_items(uuid),public.network_order_items_insert() from public,anon,authenticated;

-- Network readers use an attributed RPC instead of expanding legacy quote/PDF policies.
create function public.network_quote_detail(p_quote uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype;o public.opportunities%rowtype;v_org uuid;
begin
 select * into q from public.quotes where id=p_quote;
 select * into o from public.opportunities where linked_quote_id=p_quote;
 v_org:=coalesce(q.organization_id,o.organization_id);
 if not public.network_access(v_org) and not exists(select 1 from public.orders x where x.quote_id=p_quote and public.network_order_access(x.id)) then raise exception 'Cotización no autorizada';end if;
 if q.id is null then raise exception 'Cotización no disponible';end if;
 return jsonb_build_object('quote',to_jsonb(q),'customer',(select jsonb_build_object('name',name,'company',company) from public.customers where id=q.customer_id),'organization',(select coalesce(display_name,name) from public.organizations where id=v_org),'organization_id',v_org,'opportunity_id',o.id,'stage',o.stage,'order_id',(select id from public.orders where opportunity_id=o.id),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by sort_order),'[]') from public.quote_items i where quote_id=q.id));
end;$$;
revoke all on function public.network_quote_detail(uuid) from public,anon;grant execute on function public.network_quote_detail(uuid) to authenticated;
COMMIT;
