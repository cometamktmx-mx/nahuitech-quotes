BEGIN;
alter table public.organizations drop constraint organizations_organization_type_check;
alter table public.organizations add constraint organizations_organization_type_check check(organization_type in ('MANUFACTURER','SUPPLIER','DEALER'));
alter table public.organizations
 add column legal_name text,add column favicon_url text,add column secondary_color text,add column accent_color text,
 add column commercial_phone text,add column commercial_whatsapp text,add column commercial_email text,add column website text,
 add column finance_contact_name text,add column finance_phone text,add column finance_email text,
 add column logistics_contact_name text,add column logistics_phone text,add column logistics_email text,
 add column address text,add column tax_id text,add column quote_footer_text text,add column authorized_distributor_label text,
 add constraint network_secondary_color check(secondary_color is null or secondary_color ~ '^#[a-fA-F0-9]{6}$'),
 add constraint network_accent_color check(accent_color is null or accent_color ~ '^#[a-fA-F0-9]{6}$');
create table public.dealer_supplier_relationships(
 id uuid primary key default gen_random_uuid(),dealer_organization_id uuid not null references public.organizations(id),supplier_organization_id uuid not null references public.organizations(id),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','INACTIVE')),authorized boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(dealer_organization_id,supplier_organization_id),check(dealer_organization_id<>supplier_organization_id)
);
create index network_relationship_supplier on public.dealer_supplier_relationships(supplier_organization_id,status);
insert into public.dealer_supplier_relationships(dealer_organization_id,supplier_organization_id,authorized)
select id,parent_organization_id,true from public.organizations where organization_type='DEALER' and parent_organization_id is not null on conflict do nothing;
alter table public.machines add column supplier_organization_id uuid references public.organizations(id);
update public.machines set supplier_organization_id=(select id from public.organizations where slug='nahuitech') where supplier_organization_id is null;
create index machines_supplier on public.machines(supplier_organization_id);
create table public.organization_branches(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),name text not null check(length(trim(name)) between 1 and 150),
 code text,address text,phone text,active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,code),unique(id,organization_id)
);
create index network_branches_org on public.organization_branches(organization_id,active);
alter table public.salespeople add column organization_id uuid references public.organizations(id),add column branch_id uuid,
 add column whatsapp text,add column job_title text,add column avatar_url text,
 add foreign key(branch_id,organization_id) references public.organization_branches(id,organization_id);
create index network_salespeople_org on public.salespeople(organization_id,active);
-- Do not assign legacy sellers to an organization by guessing.
create function public.network_manage_organization(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.network_access(p_org) and public.can_manage_org(p_org);
$$;
create function public.network_branding(p_org uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare k text;v text;
begin
 if not public.network_manage_organization(p_org) then raise exception 'Administración de organización requerida';end if;
 for k,v in select key,value from jsonb_each_text(p_data) loop
  if k=any(array['display_name','legal_name','logo_url','favicon_url','primary_color','secondary_color','accent_color','commercial_phone','commercial_whatsapp','commercial_email','website','finance_contact_name','finance_phone','finance_email','logistics_contact_name','logistics_phone','logistics_email','address','tax_id','quote_footer_text','authorized_distributor_label']) then
   v:=nullif(trim(v),'');if length(v)>2000 then raise exception 'Texto demasiado largo';end if;
   if k in ('logo_url','favicon_url','website') and v is not null and v !~ '^https://' then raise exception 'Usa una URL HTTPS';end if;
   execute format('update public.organizations set %I=$1 where id=$2',k) using v,p_org;
  end if;
 end loop;
 perform public.network_audit(p_org,'organization.branding','organization',p_org);
end;$$;
create function public.network_team(p_org uuid,p_kind text,p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v_branch uuid;
begin
 if not public.network_manage_organization(p_org) then raise exception 'Administración de organización requerida';end if;
 if p_kind='branch' then
  if p_id is null then insert into public.organization_branches(organization_id,name) values(p_org,p_data->>'name') returning id into p_id;end if;
  update public.organization_branches set name=p_data->>'name',code=nullif(p_data->>'code',''),address=nullif(p_data->>'address',''),phone=nullif(p_data->>'phone',''),active=coalesce((p_data->>'active')::boolean,true) where id=p_id and organization_id=p_org;
 elsif p_kind='seller' then
  if nullif(trim(p_data->>'full_name'),'') is null then raise exception 'Indica el nombre del vendedor';end if;
  if length(coalesce(p_data->>'full_name',''))>200 or length(p_data::text)>12000 then raise exception 'Datos de vendedor demasiado largos';end if;
  if nullif(p_data->>'avatar_url','') is not null and p_data->>'avatar_url' !~ '^https://' then raise exception 'Avatar requiere HTTPS';end if;
  v_branch:=nullif(p_data->>'branch_id','')::uuid;
  if v_branch is not null and not exists(select 1 from public.organization_branches where id=v_branch and organization_id=p_org and active) then raise exception 'Sucursal no autorizada';end if;
  if p_id is null then insert into public.salespeople(organization_id,full_name) values(p_org,p_data->>'full_name') returning id into p_id;end if;
  update public.salespeople set full_name=p_data->>'full_name',phone=nullif(p_data->>'phone',''),whatsapp=nullif(p_data->>'whatsapp',''),email=nullif(p_data->>'email',''),job_title=nullif(p_data->>'job_title',''),avatar_url=nullif(p_data->>'avatar_url',''),branch_id=v_branch,active=coalesce((p_data->>'active')::boolean,true) where id=p_id and organization_id=p_org;
 else raise exception 'Operación no válida';end if;
 if not found then raise exception 'Registro no autorizado';end if;
 perform public.network_audit(p_org,'team.'||p_kind,'team',p_id);return p_id;
end;$$;
do $$ declare t text;begin foreach t in array array['organization_branches','dealer_supplier_relationships'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);
 execute format('create trigger network_updated before update on public.%I for each row execute function public.set_updated_at()',t);
end loop;end $$;
create policy network_branch_read on public.organization_branches for select to authenticated using(public.network_access(organization_id));
create policy network_relationship_read on public.dealer_supplier_relationships for select to authenticated using(public.network_access(dealer_organization_id) or public.network_access(supplier_organization_id));
-- New scoped sellers are never returned to another dealer, even through legacy policies.
create policy network_seller_scope on public.salespeople as restrictive for all to authenticated using(organization_id is null or public.network_access(organization_id)) with check(organization_id is null or public.network_manage_organization(organization_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('network-branding','network-branding',true,2097152,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
-- Public logos only; writes go through a server action with org authorization.
do $$ declare f regprocedure;begin foreach f in array array['public.network_manage_organization(uuid)'::regprocedure,'public.network_branding(uuid,jsonb)'::regprocedure,'public.network_team(uuid,text,uuid,jsonb)'::regprocedure] loop
 execute format('revoke all on function %s from public,anon',f);execute format('grant execute on function %s to authenticated',f);end loop;end $$;
COMMIT;
