BEGIN;

create table public.organizations (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 150),
 slug text not null unique, organization_type text not null check(organization_type in ('MANUFACTURER','DEALER')),
 parent_organization_id uuid references public.organizations(id), status text not null default 'ACTIVE' check(status in ('ACTIVE','INACTIVE')),
 logo_url text, primary_color text, custom_domain text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.organizations(name,slug,organization_type) values ('NAHUITECH','nahuitech','MANUFACTURER') on conflict(slug) do nothing;
insert into public.organizations(name,slug,organization_type,parent_organization_id)
select v.name,v.slug,'DEALER',o.id from (values ('ETM','etm'),('SISCO PRINT','sisco-print'),('CASA DÍAZ','casa-diaz')) v(name,slug), public.organizations o where o.slug='nahuitech'
on conflict(slug) do nothing;

create table public.organization_memberships (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), user_id uuid not null references auth.users(id),
 network_role text not null check(network_role in ('NETWORK_OWNER','ORG_ADMIN','MANAGER','SELLER')), active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,user_id)
);
create index network_memberships_user on public.organization_memberships(user_id,active);
insert into public.organization_memberships(organization_id,user_id,network_role)
select o.id,p.id,'NETWORK_OWNER' from public.organizations o,public.profiles p where o.slug='nahuitech' and p.role='admin' and p.active on conflict(organization_id,user_id) do nothing;

create table public.dealer_activation_codes (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), code_hash text not null unique check(code_hash ~ '^[a-f0-9]{64}$'),
 active boolean not null default true, expires_at timestamptz, max_uses integer check(max_uses>0), use_count integer not null default 0 check(use_count>=0),
 created_by_user_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index network_codes_org on public.dealer_activation_codes(organization_id);
create table public.network_activation_attempts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index network_attempts_user on public.network_activation_attempts(user_id,created_at);
create table public.network_devices (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), user_id uuid not null references auth.users(id),
 device_public_id uuid not null, device_name text, platform text, last_seen_at timestamptz not null default now(), activated_at timestamptz not null default now(),
 revoked_at timestamptz, created_at timestamptz not null default now(), unique(organization_id,user_id,device_public_id)
);
create index network_devices_org on public.network_devices(organization_id,revoked_at);

create function public.is_network_owner() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id join public.profiles p on p.id=m.user_id
 where m.user_id=auth.uid() and m.active and p.active and o.status='ACTIVE' and o.organization_type='MANUFACTURER' and m.network_role in ('NETWORK_OWNER','ORG_ADMIN'));
$$;
create function public.is_org_member(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_memberships m join public.profiles p on p.id=m.user_id join public.organizations o on o.id=m.organization_id
 where m.organization_id=p_org and m.user_id=auth.uid() and m.active and p.active and o.status='ACTIVE');
$$;
create function public.can_manage_org(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_network_owner() or exists(select 1 from public.organization_memberships m where m.organization_id=p_org and m.user_id=auth.uid() and m.active and m.network_role in ('ORG_ADMIN','MANAGER') and public.is_org_member(p_org));
$$;
create function public.network_device_valid() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.network_devices d where d.user_id=auth.uid() and d.revoked_at is null
 and d.device_public_id::text = (coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-network-device')
 and public.is_org_member(d.organization_id));
$$;
create function public.network_access(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.network_device_valid() and (public.is_network_owner() or (public.is_org_member(p_org) and exists(
 select 1 from public.network_devices d where d.organization_id=p_org and d.user_id=auth.uid() and d.revoked_at is null
 and d.device_public_id::text=(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-network-device'))));
$$;
create function public.network_assert(p_org uuid) returns void language plpgsql security definer set search_path='' as $$
begin if not public.network_access(p_org) then raise exception 'Acceso de red no autorizado o dispositivo revocado'; end if; end;
$$;

-- Hash is computed server-side from a randomly generated 256-bit code. No plaintext persists.
create function public.network_activate(p_hash text,p_device uuid,p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.dealer_activation_codes%rowtype; u uuid:=auth.uid();
begin
 if u is null or not exists(select 1 from public.profiles where id=u and active) then raise exception 'Autenticación requerida'; end if;
 perform pg_advisory_xact_lock(hashtext(u::text));
 if (select count(*) from public.network_activation_attempts where user_id=u and created_at>now()-interval '15 minutes')>=10 then return null; end if;
 insert into public.network_activation_attempts(user_id) values(u);
 select * into c from public.dealer_activation_codes where code_hash=p_hash and active and (expires_at is null or expires_at>now()) and (max_uses is null or use_count<max_uses) for update;
 if c.id is null or not exists(select 1 from public.organizations where id=c.organization_id and status='ACTIVE') then return null; end if;
 if exists(select 1 from public.organization_memberships where user_id=u and organization_id=c.organization_id and not active)
 or exists(select 1 from public.network_devices where user_id=u and device_public_id=p_device and revoked_at is not null) then return null; end if;
 insert into public.organization_memberships(organization_id,user_id,network_role) values(c.organization_id,u,'SELLER') on conflict(organization_id,user_id) do nothing;
 insert into public.network_devices(organization_id,user_id,device_public_id,device_name) values(c.organization_id,u,p_device,left(p_name,100))
 on conflict(organization_id,user_id,device_public_id) do update set last_seen_at=now();
 update public.dealer_activation_codes set use_count=use_count+1 where id=c.id;
 return c.organization_id;
end; $$;
create function public.network_register_device(p_org uuid,p_device uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_org_member(p_org) then raise exception 'Membresía requerida'; end if;
 if exists(select 1 from public.network_devices where user_id=auth.uid() and device_public_id=p_device and revoked_at is not null) then raise exception 'Dispositivo revocado'; end if;
 insert into public.network_devices(organization_id,user_id,device_public_id) values(p_org,auth.uid(),p_device)
 on conflict(organization_id,user_id,device_public_id) do update set last_seen_at=now();
end; $$;
create function public.network_issue_code(p_org uuid,p_hash text) returns void language plpgsql security definer set search_path='' as $$
begin perform public.network_assert(p_org); if not public.is_network_owner() then raise exception 'Solo HQ'; end if;
 insert into public.dealer_activation_codes(organization_id,code_hash,expires_at,max_uses,created_by_user_id) values(p_org,p_hash,now()+interval '7 days',20,auth.uid());
end; $$;

do $$ declare t text; begin
 foreach t in array array['organizations','organization_memberships','dealer_activation_codes','network_devices','network_activation_attempts'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
 foreach t in array array['organizations','organization_memberships'] loop
 execute format('create trigger network_updated before update on public.%I for each row execute function public.set_updated_at()',t);
 end loop;
end $$;
grant select on public.organizations,public.organization_memberships,public.network_devices to authenticated;
create policy network_org_read on public.organizations for select to authenticated using(public.is_network_owner() or public.is_org_member(id));
create policy network_members_read on public.organization_memberships for select to authenticated using(user_id=auth.uid() or public.network_access(organization_id));
create policy network_devices_read on public.network_devices for select to authenticated using(public.network_access(organization_id) and (user_id=auth.uid() or public.can_manage_org(organization_id)));
do $$ declare f record; begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('is_network_owner','is_org_member','can_manage_org','network_device_valid','network_access','network_assert','network_activate','network_register_device','network_issue_code') loop
 execute format('revoke all on function %s from public,anon',f.signature); execute format('grant execute on function %s to authenticated',f.signature);
end loop; end $$;
COMMIT;
