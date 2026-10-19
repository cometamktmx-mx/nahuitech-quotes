import {readdirSync} from 'node:fs';
import {sqlSource} from './staging-baseline.mjs';

// Deliberately bounded to the reviewed history; future migrations require review.
export function resetInventory(){
 const files=readdirSync('supabase/migrations').filter(f=>/^\d+.*\.sql$/.test(f)&&f<'20261019000042').sort();
 const source=files.map(sqlSource).join('\n');
 const names=pattern=>[...new Set([...source.matchAll(pattern)].map(m=>m[1]))].sort();
 return {
  tables:names(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi),
  functions:[...new Set([...names(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)/gi),...names(/alter\s+function\s+public\.\w+\([^;]+?\)\s+rename\s+to\s+(\w+)/gi)])].sort(),
  types:names(/create\s+type\s+public\.(\w+)/gi),
  sequences:names(/create\s+sequence\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi),
  policies:names(/create\s+policy\s+("[^"]+"|\w+)\s+on\s+storage\.objects/gi).map(s=>s.replace(/^"|"$/g,'')),
 };
}
const literal=s=>`'${s.replaceAll("'","''")}'`;
const array=items=>`array[${items.map(literal).join(',')}]::text[]`;
export function buildSchemaReset(ref,token){
 if(!/^[a-z0-9]{20}$/.test(ref)||!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid reset identity.');
 const inv=resetInventory();
 const marker=`-- MANUAL STEP ONLY: first verify dashboard /project/${ref}, NOT production.
-- current_database() is NOT proof of project identity. Expires in 20 minutes.
begin;
create schema if not exists nahuitech_staging_reset;
revoke all on schema nahuitech_staging_reset from public,anon,authenticated,service_role;
create table if not exists nahuitech_staging_reset.authorization(ref text primary key, token text not null, expires_at timestamptz not null);
revoke all on nahuitech_staging_reset.authorization from public,anon,authenticated,service_role;
insert into nahuitech_staging_reset.authorization values(${literal(ref)},${literal(token)},now()+interval '20 minutes')
on conflict(ref) do update set token=excluded.token,expires_at=excluded.expires_at;
commit;
`;
 const verify=`select current_database(),nspname,pg_get_userbyid(nspowner) as owner,nspacl from pg_namespace where nspname='public';
select name as remaining_application_table from unnest(${array(inv.tables)}) name where to_regclass('public.'||name) is not null;
select p.oid::regprocedure as remaining_application_function from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(${array(inv.functions)});
select t.typname as remaining_application_type from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname=any(${array(inv.types)});
select c.relname as remaining_application_sequence from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S' and c.relname=any(${array(inv.sequences)});
select count(*) as auth_users_must_be_zero from auth.users;
select id,public from storage.buckets order by id;
select bucket_id,count(*) from storage.objects group by bucket_id;
`;
 const sql=`-- STAGING ONLY. Generated for ${ref}. No network performed by generator.
-- Requires separate manually installed, short-lived authorization. All changes atomic.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $reset$
declare r record; command text; leftovers integer; progress boolean; occupied boolean;
begin
 if current_database()<>'postgres' then raise exception 'Expected disposable Supabase postgres database';end if;
 if to_regclass('nahuitech_staging_reset.authorization') is null then raise exception 'Missing manual STAGING authorization';end if;
 if not exists(select 1 from nahuitech_staging_reset.authorization where ref=${literal(ref)} and token=${literal(token)} and expires_at>now() and expires_at<=now()+interval '20 minutes') then raise exception 'Wrong or expired STAGING authorization';end if;
 lock table auth.users in share mode;
 if exists(select 1 from auth.users) then raise exception 'Reset refused: Auth users exist. This reset is only for pre-demo empty staging';end if;
 for r in select unnest(${array(inv.tables.filter(t=>!['machines','addons','machine_addons','machine_variants','organizations','organization_modules','dealer_supplier_relationships'].includes(t)))}) as name loop
  if to_regclass('public.'||r.name) is not null then
   execute format('lock table public.%I in access exclusive mode',r.name);
   execute format('select exists(select 1 from public.%I)',r.name) into occupied;
   if occupied then raise exception 'Reset refused: application data exists in %',r.name;end if;
  end if;
 end loop;
 lock table storage.objects in share mode;
 if exists(select 1 from storage.objects where bucket_id in ('quote-pdfs','machine-images','sales-network-documents','network-branding')) then raise exception 'Reset refused: project Storage files exist. Use Storage API after manual review, never DELETE storage metadata';end if;
 -- Remove only the one auth hook owned by this application; preserve auth schema/users.
 if exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where t.tgrelid='auth.users'::regclass and t.tgname='on_auth_user_created' and (n.nspname<>'public' or p.proname<>'handle_new_user')) then raise exception 'Unknown auth trigger owner';end if;
 drop trigger if exists on_auth_user_created on auth.users;
 ${inv.policies.map(p=>`execute ${literal(`drop policy if exists "${p}" on storage.objects`)};`).join('\n ')}
 -- RESTRICT prevents deletion of unknown dependants, including managed-schema objects.
 -- Retry functions/tables because SQL dependencies can point in either direction.
 loop
  progress:=false;
  for r in select p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(${array(inv.functions)}) loop
   begin execute 'drop function '||r.signature||' restrict';progress:=true;exception when dependent_objects_still_exist then null;end;
  end loop;
  select string_agg(format('public.%I',c.relname),',') into command from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and c.relname=any(${array(inv.tables)});
  if command is not null then
   begin execute 'drop table '||command||' restrict';progress:=true;exception when dependent_objects_still_exist then null;end;
  end if;
  select count(*) into leftovers from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(${array(inv.functions)});
  select leftovers+count(*) into leftovers from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(${array(inv.tables)});
  exit when leftovers=0;
  if not progress then raise exception 'Unknown dependency prevents safe reset; entire transaction rolled back';end if;
 end loop;
 ${inv.sequences.map(s=>`drop sequence if exists public.${s} restrict;`).join('\n ')}
 ${inv.types.map(s=>`drop type if exists public.${s} restrict;`).join('\n ')}
 delete from nahuitech_staging_reset.authorization where ref=${literal(ref)};
end $reset$;
-- Public schema, owner, ACL, default privileges, extensions and empty buckets preserved.
notify pgrst,'reload schema';
commit;
${verify}`;
 return {marker,sql,verify,inventory:inv};
}
