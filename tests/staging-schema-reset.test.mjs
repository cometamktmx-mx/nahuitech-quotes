import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '../tmp/sql-validation/node_modules/@electric-sql/pglite/dist/index.js';
import {buildSchemaReset} from '../scripts/lib/staging-schema-reset.mjs';
import {buildStagingBaseline,sqlSource} from '../scripts/lib/staging-baseline.mjs';
const ref='abcdefghijklmnopqrst',token='a'.repeat(64);
const reset=buildSchemaReset(ref,token);
const system=`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,storage to authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;grant select on storage.objects to authenticated;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
create table public.unrelated(id int);insert into public.unrelated values(42);
insert into storage.buckets(id,name) values('unrelated','unrelated');insert into storage.objects(bucket_id,name) values('unrelated','keep');`;
test('staging reset: partial bootstrap, repeat baseline + Network, guards, atomicity and preservation',async t=>{
 const db=new PGlite();try{
  await db.exec(system);
  const acl=async()=> (await db.query("select nspowner,nspacl from pg_namespace where nspname='public'")).rows;
  const before=await acl();
  const refused=async(sql,pattern)=>{await assert.rejects(db.exec(sql),pattern);await db.exec('rollback');};
  await t.test('missing manual marker refuses all writes',()=>refused(reset.sql,/Missing manual STAGING/));
  for(const f of buildStagingBaseline().files.filter(f=>f<'20260824000010'))await db.exec(sqlSource(f));
  await t.test('expired and wrong-project marker refuse',async()=>{
   await db.exec(reset.marker);await db.exec("update nahuitech_staging_reset.authorization set expires_at=now()-interval '1 second'");await refused(reset.sql,/expired/);
   await db.exec(reset.marker);await refused(buildSchemaReset('bbbbbbbbbbbbbbbbbbbb',token).sql,/expired/);
  });
  await t.test('existing users refuse reset',async()=>{
   await db.exec("insert into auth.users(id) values('11111111-1111-1111-1111-111111111111')");await refused(reset.sql,/Auth users exist/);
   await db.exec("delete from auth.users where id='11111111-1111-1111-1111-111111111111'");
  });
  await t.test('known Storage files refuse; unknown objects preserved',async()=>{
   await db.exec("insert into storage.objects(bucket_id,name) values('quote-pdfs','test')");await refused(reset.sql,/Storage files exist/);
   await db.exec("delete from storage.objects where bucket_id='quote-pdfs'");
  });
  await t.test('operational data refuses reset even with zero Auth users',async()=>{
   await db.exec("insert into public.coupons(name,code,discount_type,discount_value) values('Keep','KEEP','PERCENTAGE',10)");
   await refused(reset.sql,/application data exists in coupons/);
   await db.exec("delete from public.coupons where code='KEEP'");
  });
  await t.test('unknown dependent view aborts atomically',async()=>{
   await db.exec('create view public.keep_view as select id from public.machines');await refused(reset.sql,/Unknown dependency/);
   assert.equal((await db.query("select count(*) from pg_trigger where tgname='on_auth_user_created'")).rows[0].count,1);
   await db.exec('drop view public.keep_view');
  });
  for(let round=1;round<=2;round++)await t.test(`reset and complete installation round ${round}`,async()=>{
   await db.exec(reset.marker);await db.exec(reset.sql);
   assert.deepEqual(await acl(),before);
   assert.equal((await db.query('select id from public.unrelated')).rows[0].id,42);
   assert.equal((await db.query("select count(*) from storage.objects where bucket_id='unrelated'")).rows[0].count,1);
   for(const name of reset.inventory.tables)assert.equal((await db.query('select to_regclass($1) as object',['public.'+name])).rows[0].object,null);
   await refused(reset.sql,/expired/); // one-use marker
   await db.exec(buildStagingBaseline().sql);
   await db.exec(readFileSync('tmp/sales-network-staging-plan/network-combined.sql','utf8'));
   assert.equal((await db.query('select count(*) from public.organizations')).rows[0].count,4);
   assert.equal((await db.query('select count(*) from public.machines where active')).rows[0].count,10);
  });
 }finally{await db.close();}
});
