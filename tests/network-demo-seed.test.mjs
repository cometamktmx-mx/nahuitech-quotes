import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {PGlite} from '../tmp/sql-validation/node_modules/@electric-sql/pglite/dist/index.js';
import {buildStagingBaseline} from '../scripts/lib/staging-baseline.mjs';
import {demoEmails,assertDemoUser,unwrap} from '../scripts/lib/sales-network-staging.mjs';

test('real seed script twice on local PostgreSQL leaves ETM unactivated and commercial quotes intact',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant select on storage.objects to authenticated;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
 await db.exec(buildStagingBaseline().sql);
 for(const f of readdirSync('supabase/migrations').filter(f=>/^2026101800003[1-6]_/.test(f)).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 const query=async(s,args=[]) => (await db.query(s,args)).rows;
 const scalar=async(s,args=[])=>Object.values((await query(s,args))[0])[0];
 const users=new Map();let manifest=null;const calls=[];
 const adminQuery=async(sql,args=[])=>{await db.exec('reset role');return query(sql,args);};
 const identifier=value=>{assert.match(value,/^[a-z_]+$/);return value;};
 const createClient=(_url,key,options={})=>{
  let user=null;
  return {
   auth:{admin:{createUser:async data=>{
    const u={id:randomUUID(),...data};users.set(u.id,u);await adminQuery('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[u.id,u.email,JSON.stringify(u.user_metadata)]);return {data:{user:u}};
   },getUserById:async id=>({data:{user:users.get(id)}})},signInWithPassword:async({email})=>{user=[...users.values()].find(u=>u.email===email);assert.ok(user);return {data:{user}};}},
   rpc:async(name,args)=>{
    assert.ok(user);calls.push({user:user.email,name});await db.exec('reset role');await query("select set_config('request.jwt.claim.sub',$1,false)",[user.id]);await query("select set_config('request.headers',$1,false)",[JSON.stringify(options.global?.headers??{})]);await db.exec('set role authenticated');
    const sql=`select * from public.${identifier(name)}(${Object.keys(args).map((k,i)=>`${identifier(k)}=>$${i+1}`).join(',')})`;
    return {data:await query(sql,Object.values(args).map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v))};
   },
   from(table){
    assert.equal(key,'secret');identifier(table);let operation='select',filters=[],payload,conflict,single=false,order='',selection='';
    const q={select(s='*'){selection=s;return q;},insert(v){operation='insert';payload=v;return q;},update(v){operation='update';payload=v;return q;},upsert(v,o){operation='upsert';payload=v;conflict=o;return q;},eq(k,v){filters.push([identifier(k),'=',v]);return q;},is(k,v){assert.equal(v,null);filters.push([identifier(k),'is',v]);return q;},order(k){order=' order by '+identifier(k);return q;},single(){single=true;return q;},then(resolve,reject){
     const values=[];const bind=v=>{values.push(v!==null&&typeof v==='object'?JSON.stringify(v):v);return '$'+values.length;};let sql;
     if(operation==='select')sql=selection.includes('addons!inner')?'select * from (select ma.*,jsonb_build_object(\'required\',a.required) addons from public.machine_addons ma join public.addons a on a.id=ma.addon_id) x':`select * from public.${table}`;
     else if(operation==='update')sql=`update public.${table} set `+Object.entries(payload).map(([k,v])=>`${identifier(k)}=${bind(v)}`).join(',');
     else {
      const rows=Array.isArray(payload)?payload:[payload],keys=Object.keys(rows[0]);keys.forEach(identifier);
      sql=`insert into public.${table} (${keys.join(',')}) values `+rows.map(row=>'('+keys.map(k=>bind(row[k])).join(',')+')').join(',');
      if(conflict)sql+=` on conflict (${conflict.onConflict.split(',').map(identifier).join(',')}) `+(conflict.ignoreDuplicates?'do nothing':'do update set '+keys.map(k=>`${k}=excluded.${k}`).join(','));
     }
     if(filters.length)sql+=' where '+filters.map(([k,op,v])=>op==='is'?`${k} is null`:`${k}=${bind(v)}`).join(' and ');
     sql+=operation==='select'?order:' returning *';
     return adminQuery(sql,values).then(rows=>({data:single?rows[0]:rows})).then(resolve,reject);
    }};return q;
   }
  };
 };
 // Execute the actual CLI body with an in-process PostgreSQL transport. No network.
 const source=readFileSync('scripts/seed-sales-network-demo.mjs','utf8').replace(/^import .*;\r?$/gm,'');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const seed=new AsyncFunction('createClient','randomUUID','randomBytes','createHash','stagingTarget','demoEmails','assertDemoUser','readManifest','saveManifest','unwrap','process','console',source);
 for(let round=0;round<2;round++){
  await seed(createClient,randomUUID,randomBytes,createHash,()=>({url:'https://local.invalid',secret:'secret',host:'local.invalid',ref:'test'}),demoEmails,assertDemoUser,()=>manifest,(_ref,m)=>{manifest=structuredClone(m);},unwrap,{argv:[],env:{SALES_NETWORK_DEMO_PASSWORD:'local-test-password',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'publishable'}},{log(){}});
  await db.exec('reset role');const dealer=manifest.users.dealer;
  assert.equal(await scalar('select count(*) from public.organization_memberships where user_id=$1',[dealer]),0);
  assert.equal(await scalar('select count(*) from public.network_devices where user_id=$1',[dealer]),0);
  assert.equal(await scalar('select full_name from public.profiles where id=$1',[manifest.users.hq]),'NAHUITECH HQ');
  assert.equal(await scalar('select network_role from public.organization_memberships where user_id=$1',[manifest.users.hq]),'NETWORK_OWNER');
  assert.equal(await scalar('select count(*) from public.opportunities'),3);assert.equal(await scalar('select count(*) from public.quotes'),2);
  assert.equal(await scalar('select count(*) from public.sales_tasks'),3);assert.equal(await scalar('select count(*) from public.sales_goals'),1);
  assert.equal(await scalar('select count(*) from public.network_announcements'),1);
  assert.equal(await scalar("select count(*) from public.opportunities o join public.quotes q on q.id=o.linked_quote_id where o.quote_snapshot->'quote'->>'total'=q.total::text"),2);
  assert.equal(await scalar('select use_count from public.dealer_activation_codes where id=$1',[manifest.activation_code_id]),0);
 }
 assert.ok(calls.filter(c=>c.user===demoEmails.dealer).every(c=>c.name==='create_quote'));
 }finally{await db.close();}
});
