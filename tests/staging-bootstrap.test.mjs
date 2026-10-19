import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {PGlite} from '../tmp/sql-validation/node_modules/@electric-sql/pglite/dist/index.js';
import {buildStagingBaseline,sqlSource,hash} from '../scripts/lib/staging-baseline.mjs';
const system=`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,storage to authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;grant select on storage.objects to authenticated;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`;
test('corrupt UTF-8 reproduces laser-guide NULL, original history does not need a production laser row',async()=>{
 const db=new PGlite();try{
  await db.exec(system);
  for(const f of buildStagingBaseline().files.filter(f=>f<'20260824000010'))await db.exec(Buffer.from(sqlSource(f),'utf8').toString('latin1'));
  await assert.rejects(db.exec(Buffer.from(sqlSource('20260824000010_catalog_rules_data.sql'),'utf8').toString('latin1')),e=>e.code==='23502'&&e.detail.includes('laser-guide, null'));
  await db.exec('rollback');assert.equal((await db.query("select lower('Ã')='Ã' as comparison")).rows[0].comparison,false);
 }finally{await db.close();}
});
test('generated UTF-8 bootstrap on empty PostgreSQL, catalog, five commercial RPCs and Network',async t=>{
 assert.equal(spawnSync(process.execPath,['scripts/prepare-sales-network-staging.mjs']).status,0);
 const bytes=readFileSync('tmp/sales-network-staging-plan/baseline-combined.sql');const sql=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 assert.notDeepEqual([...bytes.subarray(0,3)],[239,187,191]);assert.ok(sql.includes("'Kit de Láser con Guía'"));assert.ok(!sql.includes('GuÃ'));
 assert.equal(sql,buildStagingBaseline().sql);const manifest=JSON.parse(readFileSync('tmp/sales-network-staging-plan/manifest.json','utf8'));assert.equal(hash(sql),manifest.artifacts['baseline-combined.sql']);
 const db=new PGlite();try{
  await db.exec(system);await db.exec(sql);
  const rows=async(s,args=[]) => (await db.query(s,args)).rows;
  const fingerprintSql=`select 'addons' as kind,name as key,jsonb_build_object('price',unit_price,'type',calculation_type,'order',display_order,'active',active) as value from public.addons
union all select 'machines',slug,jsonb_build_object('price',base_price,'active',active) from public.machines
union all select 'variants',m.slug||':'||v.variant_type,jsonb_build_object('price',v.price,'active',v.active) from public.machine_variants v join public.machines m on m.id=v.machine_id
union all select 'compatibility',m.slug||':'||a.name,jsonb_build_object('override',ma.unit_price_override,'description',ma.description_override,'active',ma.active) from public.machine_addons ma join public.machines m on m.id=ma.machine_id join public.addons a on a.id=ma.addon_id
order by kind,key`;
  const catalogFingerprint=await rows(fingerprintSql);
  await t.test('two fresh databases yield the same logical catalog, quantity rules and display order',async()=>{
   const second=new PGlite();try{await second.exec(system);await second.exec(sql);assert.deepEqual((await second.query(fingerprintSql)).rows,catalogFingerprint);}finally{await second.close();}
  });
  await t.test('catalog: machines, addons, compatibility, official prices, variants, quantity and order',async()=>{
   assert.equal((await rows('select * from public.machines where active')).length,10);
   assert.equal((await rows('select * from public.addons where active')).length,9);
   assert.equal((await rows('select * from public.machine_addons where active')).length,36);
   assert.equal((await rows('select * from public.machine_variants where active')).length,9);
   const addons=await rows('select id,name,calculation_type,unit_price,display_order from public.addons order by display_order');
   assert.deepEqual(addons.map(a=>a.name),buildStagingBaseline().displayOrder);
   for(const [i,a] of addons.entries())assert.equal(a.display_order,i+1);
   const laser=addons.find(a=>a.name==='Kit de Láser con Guía');assert.match(laser.id,/^[0-9a-f-]{36}$/);assert.equal(laser.calculation_type,'FIXED');assert.equal(Number(laser.unit_price),4000);
   for(const id of Object.values(buildStagingBaseline().identities))assert.equal(addons.find(a=>a.id===id).calculation_type,'QUANTITY');
   const compatible=await rows('select m.slug from public.machine_addons ma join public.machines m on m.id=ma.machine_id where ma.addon_id=$1 order by m.slug',[laser.id]);
   assert.deepEqual(compatible.map(m=>m.slug),['hyro-set-basic-4','hyro-set-compact-4','hyro-set-omen','hyro-set-pro-6','hyro-set-pro-8']);
   const expected={'hyro-set-omen':250000,'hyro-set-pro-8':212000,'hyro-set-pro-6':159000,'hyro-set-compact-4':106000,'hyro-set-basic-4':59990,'hyro-set-tri-basic':45990,'hyro-set-intro':100000,'nahui-pre-set-dtf':34990,'nahui-flash-on':69990,'nahui-cure-uv':164990};
   for(const m of await rows('select slug,base_price from public.machines'))assert.equal(Number(m.base_price),expected[m.slug],m.slug);
   const variants=await rows("select m.slug,v.variant_type,v.price from public.machine_variants v join public.machines m on m.id=v.machine_id where v.active order by m.slug,v.variant_type");
   const variantPrices={'hyro-set-omen:AUTOMATIC':250000,'hyro-set-omen:SEMI_AUTOMATIC':127000,'hyro-set-pro-8:AUTOMATIC':212000,'hyro-set-pro-8:SEMI_AUTOMATIC':181000,'hyro-set-pro-6:AUTOMATIC':159000,'hyro-set-pro-6:SEMI_AUTOMATIC':136000,'hyro-set-compact-4:AUTOMATIC':106000,'hyro-set-compact-4:SEMI_AUTOMATIC':90000,'hyro-set-basic-4:SEMI_AUTOMATIC':59990};
   for(const v of variants)assert.equal(Number(v.price),variantPrices[`${v.slug}:${v.variant_type}`]);
   const ome=await rows("select ma.unit_price_override from public.machine_addons ma join public.machines m on ma.machine_id=m.id join public.addons a on a.id=ma.addon_id where m.slug='hyro-set-omen' and a.name='Sistema de Doble Tiempo'");assert.equal(Number(ome[0].unit_price_override),28990);
  });
  await db.exec("insert into public.coupons(name,code,discount_type,discount_value) values('Bootstrap test','BOOTSTRAP-10','PERCENTAGE',10)");
  const advisor=randomUUID(),admin=randomUUID();await db.query('insert into public.salespeople(id,full_name) values($1,\'Staging advisor\')',[advisor]);
  await db.query('insert into auth.users(id,email) values($1,\'staging-test@example.invalid\')',[admin]);await db.query("update public.profiles set role='admin' where id=$1",[admin]);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
  const machine=(await rows("select id from public.machines where slug='nahui-flash-on'"))[0].id;
  const items=JSON.stringify([{machine_id:machine,addon_quantities:{},quantity:2,delivery_type:'LATER'}]);await db.exec('set role authenticated');
  for(const [name,query,args,total] of [
   ['preview 3 args',"select * from public.preview_quote_coupon($1::uuid,'{}'::jsonb,'BOOTSTRAP-10'::text)",[machine],62991],
   ['preview 4 args',"select * from public.preview_quote_coupon($1::uuid,'{}'::jsonb,'BOOTSTRAP-10'::text,null::uuid)",[machine],62991],
   ['preview multi',"select * from public.preview_multi_quote_coupon($1::jsonb,null::text)",[items],139980],
   ['create quote',"select * from public.create_quote($1::uuid,'{}'::jsonb,'Demo','','5555555555','','LATER'::public.quote_delivery_type,null::text,null::uuid,null::text,null::text,null::uuid,$2::uuid)",[machine,advisor],69990],
   ['create multi',"select * from public.create_multi_quote($1::jsonb,'Demo','','5555555555','','LATER'::public.quote_delivery_type,null::text,null::uuid,null::text,$2::uuid)",[items,advisor],139980]
  ])await t.test(name,async()=>assert.equal(Number((await rows(query,args))[0].total),total));
  await db.exec('reset role');
  await t.test('refuses running again on populated commercial schema',async()=>{await assert.rejects(db.exec(sql),/empty commercial schema/);await db.exec('rollback');});
  await t.test('00031–00036 apply unchanged after artifact; RLS and HQ backfill available',async()=>{
   await db.exec(readFileSync('tmp/sales-network-staging-plan/network-combined.sql','utf8'));
   assert.equal((await rows("select network_role from public.organization_memberships where user_id=$1",[admin]))[0].network_role,'NETWORK_OWNER');
   assert.equal((await rows('select * from public.organizations')).length,4);
  });
 }finally{await db.close();}
});
