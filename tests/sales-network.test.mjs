import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID,createHash } from 'node:crypto';
import { test } from 'node:test';
import {resetDemo} from '../scripts/lib/reset-sales-network-demo.mjs';
import {resetDemoActivation} from '../scripts/lib/reset-sales-network-demo-activation.mjs';
import {demoEmails} from '../scripts/lib/sales-network-staging.mjs';
import {buildStagingBaseline} from '../scripts/lib/staging-baseline.mjs';
import { PGlite } from '../tmp/sql-validation/node_modules/@electric-sql/pglite/dist/index.js';

test('Sales Network: isolated PostgreSQL integration, RLS and complete order lifecycle',async t=>{
 const db=new PGlite();
 const existingAdmin=randomUUID(),inactiveAdmin=randomUUID();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant select on storage.objects to authenticated;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
 await db.exec(buildStagingBaseline().sql);
 for(const file of readdirSync('supabase/migrations').filter(f=>/^2026101800003[1-6]_.*\.sql$/.test(f)).sort()){
  if(file.startsWith('20261018000031')){
   await db.query("insert into auth.users(id,email) values($1,'existing-admin@example.test'),($2,'inactive-admin@example.test')",[existingAdmin,inactiveAdmin]);
   await db.query("update public.profiles set role='admin',active=(id=$1) where id in ($1,$2)",[existingAdmin,inactiveAdmin]);
  }
  try{await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));}catch(e){throw new Error(`${file}: ${e.message}`,{cause:e});}
 }
 const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const scalar=async(sql,args=[]) => Object.values((await query(sql,args))[0])[0];
 await t.test('migration preflight: all network tables have RLS, RPC names unambiguous and anon denied',async()=>{
  const tables=['organizations','organization_memberships','dealer_activation_codes','network_activation_attempts','network_devices','opportunities','opportunity_activities','sales_tasks','network_audit_log','orders','order_payment_milestones','order_documents','network_notifications','sales_goals','network_announcements','organization_modules'];
  assert.equal(await scalar("select count(*) from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[]) and relrowsecurity",[tables]),16);
  assert.equal(await scalar("select count(*) from (select proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'network_%' or proname='refresh_sales_network_tasks') group by proname having count(*)>1) s"),0);
  assert.equal(await scalar("select has_function_privilege('anon','public.network_activate_result(text,uuid,text)','EXECUTE')"),false);
  assert.equal(await scalar("select has_function_privilege('authenticated','public.network_activate_result(text,uuid,text)','EXECUTE')"),true);
  assert.equal(await scalar("select has_table_privilege('authenticated','public.orders','INSERT')"),false);
 });
 await t.test('migration safely backfills existing active admins only',async()=>{
  assert.equal(await scalar('select network_role from public.organization_memberships where user_id=$1',[existingAdmin]),'NETWORK_OWNER');
  assert.equal(await scalar('select count(*) from public.organization_memberships where user_id=$1',[inactiveAdmin]),0);
 });
 const ids={hq:randomUUID(),etm:randomUUID(),sisco:randomUUID(),fresh:randomUUID()};
 for(const [role,id] of Object.entries(ids)){await query('insert into auth.users(id,email) values($1,$2)',[id,`${role}@example.test`]);}
 const orgs=Object.fromEntries((await query('select slug,id from public.organizations')).map(o=>[o.slug,o.id]));
 orgs.sisco=orgs['sisco-print'];
 const devices=Object.fromEntries(Object.keys(ids).map(k=>[k,randomUUID()]));
 await query("update public.profiles set role='admin' where id=$1",[ids.hq]);
 for(const role of ['hq','etm','sisco']){
  const org=orgs[role==='hq'?'nahuitech':role];
  await query('insert into public.organization_memberships(organization_id,user_id,network_role) values($1,$2,$3)',[org,ids[role],role==='hq'?'NETWORK_OWNER':'SELLER']);
  await query('insert into public.network_devices(organization_id,user_id,device_public_id) values($1,$2,$3)',[org,ids[role],devices[role]]);
 }
 const as=async role=>{await db.exec('reset role');await query("select set_config('request.jwt.claim.sub',$1,false)",[ids[role]??'']);await query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-network-device':devices[role]??''})]);await db.exec('set role authenticated');};
 const opp=async(org,title)=>scalar("select public.network_opportunity($1,'create',null,$2)",[org,JSON.stringify({title,estimated_value:'12345.67'})]);
 await as('etm');const opportunity=await opp(orgs.etm,'Textiles Demo');
 await as('sisco');const other=await opp(orgs.sisco,'SISCO confidential');
 await t.test('ETM vs SISCO read/write isolation and denied direct writes',async()=>{
  await as('etm');assert.equal(await scalar('select count(*) from public.opportunities'),1);
  await assert.rejects(opp(orgs.sisco,'attack'),/no autorizado/);
  await assert.rejects(query("update public.opportunities set stage='WON' where id=$1",[opportunity]),/permission denied/);
  assert.equal(await scalar('select count(*) from public.opportunities where id=$1',[other]),0);
 });
 await t.test('HQ reads entire network',async()=>{await as('hq');assert.equal(await scalar('select count(*) from public.opportunities'),2);});
 const code='a secure 256 bit generated code';const hash=createHash('sha256').update(code).digest('hex');
 await t.test('activation hash, auth required, membership, limits and inactive membership',async()=>{
  await as('hq');await query('select public.network_issue_code($1,$2)',[orgs.etm,hash]);
  await as('none');await assert.rejects(query('select public.network_activate($1,$2,$3)',[hash,randomUUID(),'test']),/Autenticación requerida/);
  await as('fresh');assert.equal(await scalar('select public.network_activate($1,$2,$3)',[hash,devices.fresh,'test']),orgs.etm);
  assert.equal(await scalar('select auth.uid()'),ids.fresh);
  assert.equal(await scalar('select count(*) from public.organization_memberships where user_id=auth.uid()'),1);
  await query('select public.network_activate($1,$2,$3)',[hash,devices.fresh,'test']);
  assert.equal(await scalar('select count(*) from public.organization_memberships where user_id=auth.uid()'),1);
  await db.exec('reset role');assert.equal(await scalar('select code_hash from public.dealer_activation_codes where code_hash=$1',[hash]),hash);
  for(let i=0;i<10;i++){await as('fresh');await query('select public.network_activate($1,$2,$3)',['0'.repeat(64),devices.fresh,'test']);}
  assert.equal(await scalar('select public.network_activate($1,$2,$3)',[hash,devices.fresh,'test']),null);
 });
 await t.test('LOST reason and OTHER notes are required',async()=>{
  await as('etm');for(const data of [{stage:'LOST'},{stage:'LOST',lost_reason:'OTHER'}])await assert.rejects(query("select public.network_opportunity($1,'stage',$2,$3)",[orgs.etm,opportunity,JSON.stringify(data)]),/motivo/);
 });
 await t.test('activation distinguishes invalid, expired and exhausted codes without creating membership',async()=>{
  await db.exec('reset role');await query('delete from public.network_activation_attempts where user_id=$1',[ids.fresh]);
  const expired='1'.repeat(64),exhausted='2'.repeat(64);
  await query("insert into public.dealer_activation_codes(organization_id,code_hash,expires_at,max_uses,use_count,created_by_user_id) values($1,$2,now()-interval '1 day',null,0,$4),($1,$3,null,1,1,$4)",[orgs.sisco,expired,exhausted,ids.hq]);
  await as('fresh');
  for(const [hash,status] of [['f'.repeat(64),'INVALID'],[expired,'EXPIRED'],[exhausted,'EXHAUSTED']])assert.equal((await scalar('select public.network_activate_result($1,$2,$3)',[hash,devices.fresh,'test'])).status,status);
  assert.equal(await scalar('select count(*) from public.organization_memberships where user_id=auth.uid() and organization_id=$1',[orgs.sisco]),0);
 });
 await t.test('customer creation and existing customer selection stay authorized',async()=>{
  await as('etm');const id=await scalar("select public.network_opportunity($1,'create',null,$2)",[orgs.etm,JSON.stringify({title:'Inline customer test',customer_name:'Customer DEMO',customer_whatsapp:'525555555555'})]);
  const c=(await query('select customer_id,customer_name_snapshot from public.opportunities where id=$1',[id]))[0];assert.equal(c.customer_name_snapshot,'Customer DEMO');
  await as('sisco');await assert.rejects(query("select public.network_opportunity($1,'create',null,$2)",[orgs.sisco,JSON.stringify({title:'Unauthorized customer',customer_id:c.customer_id})]),/Cliente no autorizado/);
 });
 // A real quote is created through the existing commercial RPC, never a fabricated snapshot.
 await db.exec('reset role');const advisor=randomUUID();await query('insert into public.salespeople(id,full_name) values($1,$2)',[advisor,'Network test advisor']);
 await query('update public.profiles set salesperson_id=$1 where id=$2',[advisor,ids.etm]);
 const machine=randomUUID();
 await query("insert into public.machines(id,name,slug,short_description,base_price,number_of_bases) values($1,'Test machine','network-test','Test only',1160,1)",[machine]);
 await as('etm');
 const quote=(await query(`select * from public.create_quote($1::uuid,'{}'::jsonb,'Textiles Demo','DEMO','525555555555',null,'LATER'::public.quote_delivery_type,null,null,null,null,null,$2::uuid)`,[machine,advisor]))[0];
 await t.test('quote linking ownership and historical snapshot',async()=>{
  await as('sisco');await assert.rejects(query("select public.network_opportunity($1,'link_quote',$2,$3)",[orgs.sisco,other,JSON.stringify({quote_id:quote.quote_id})]),/propia/);
  await as('etm');await query("select public.network_opportunity($1,'link_quote',$2,$3)",[orgs.etm,opportunity,JSON.stringify({quote_id:quote.quote_id})]);
  assert.equal(await scalar('select stage from public.opportunities where id=$1',[opportunity]),'QUOTED');
  assert.equal(await scalar("select quote_snapshot->'quote'->>'folio' from public.opportunities where id=$1",[opportunity]),quote.folio);
  assert.equal(await scalar("select quote_snapshot->'customer'->>'name' from public.opportunities where id=$1",[opportunity]),'Textiles Demo');
  const before=await scalar('select to_jsonb(q) from public.quotes q where id=$1',[quote.quote_id]);
  await query("select public.network_opportunity($1,'stage',$2,$3)",[orgs.etm,opportunity,JSON.stringify({stage:'NEGOTIATION'})]);
  await query("select public.network_opportunity($1,'link_quote',$2,$3)",[orgs.etm,opportunity,JSON.stringify({quote_id:quote.quote_id})]);
  assert.equal(await scalar('select stage from public.opportunities where id=$1',[opportunity]),'NEGOTIATION');
  assert.equal(await scalar("select count(*) from public.opportunity_activities where opportunity_id=$1 and activity_type='QUOTE_LINKED'",[opportunity]),1);
  assert.deepEqual(await scalar('select to_jsonb(q) from public.quotes q where id=$1',[quote.quote_id]),before);
  await query("select public.network_opportunity($1,'stage',$2,$3)",[orgs.etm,opportunity,JSON.stringify({stage:'QUOTED'})]);
  await as('sisco');await assert.rejects(query("select public.network_opportunity($1,'link_quote',$2,$3)",[orgs.sisco,other,JSON.stringify({quote_id:quote.quote_id})]),/otra organización/);await as('etm');
 });
 await t.test('follow-up, quote expiry and negotiation are idempotent',async()=>{
  await db.exec('reset role');await query("update public.opportunities set last_activity_at=now()-interval '4 days',quote_snapshot=jsonb_set(quote_snapshot,'{quote,created_at}',to_jsonb(now()-interval '13 days')) where id=$1",[opportunity]);
  await as('etm');await query('select public.refresh_sales_network_tasks($1)',[orgs.etm]);await query('select public.refresh_sales_network_tasks($1)',[orgs.etm]);
  assert.equal(await scalar("select count(*) from public.sales_tasks where opportunity_id=$1",[opportunity]),2);
  await query("select public.network_opportunity($1,'stage',$2,$3)",[orgs.etm,opportunity,JSON.stringify({stage:'NEGOTIATION'})]);
  await query("select public.network_opportunity($1,'activity',$2,$3)",[orgs.etm,opportunity,JSON.stringify({activity_type:'CALL',body:'Follow-up recorded'})]);
  await query("select public.network_opportunity($1,'activity',$2,$3)",[orgs.etm,opportunity,JSON.stringify({activity_type:'NOTE',body:'Scheduled',next_action_at:'2099-01-01T12:00:00Z'})]);
  await query("select public.network_opportunity($1,'activity',$2,$3)",[orgs.etm,opportunity,JSON.stringify({activity_type:'NOTE',body:'Keep schedule',next_action_at:''})]);
  assert.ok(await scalar('select next_action_at is not null from public.opportunities where id=$1',[opportunity]));
 });
 await t.test('WON required before conversion',async()=>{await assert.rejects(query('select public.network_create_order($1)',[opportunity]),/ganada/);await query("select public.network_opportunity($1,'stage',$2,$3)",[orgs.etm,opportunity,JSON.stringify({stage:'WON'})]);});
 const order=await scalar('select public.network_create_order($1)',[opportunity]);
 const act=async(action,data={})=>query('select public.network_order_action($1,$2,$3)',[order,action,JSON.stringify(data)]);
 await t.test('cross-org order and finance access is denied',async()=>{
  await as('sisco');assert.equal(await scalar('select count(*) from public.orders where id=$1',[order]),0);await assert.rejects(act('verify',{milestone_type:'DEPOSIT'}),/no autorizado/);
  await as('etm');await assert.rejects(act('verify',{milestone_type:'DEPOSIT'}),/Solo HQ/);
 });
 await t.test('order conversion idempotent, sell-in not copied, dealer cannot approve',async()=>{
  assert.equal(await scalar('select public.network_create_order($1)',[opportunity]),order);
  assert.equal(await scalar('select dealer_order_total from public.orders where id=$1',[order]),null);
  await assert.rejects(act('approve',{dealer_order_total:'10000.01',estimated_completion_date:'2099-01-01'}),/Solo HQ/);
 });
 await t.test('HQ 50/50 uses numeric cents and remainder; approval cannot repeat',async()=>{
  await as('hq');
  for(const amount of ['0','-1','NaN','1.234'])await assert.rejects(act('approve',{dealer_order_total:amount,estimated_completion_date:'2099-01-01'}));
  await assert.rejects(act('approve',{dealer_order_total:'100',estimated_completion_date:'invalid'}));
  await act('approve',{dealer_order_total:'10000.01',estimated_completion_date:new Date(Date.now()+5*86400000).toISOString().slice(0,10)});
  const amounts=await query('select amount from public.order_payment_milestones where order_id=$1 order by milestone_type',[order]);assert.deepEqual(amounts.map(x=>x.amount),['5000.00','5000.01']);
  await assert.rejects(act('approve',{dealer_order_total:'2',estimated_completion_date:'2099-01-01'}),/revisado/);
  await assert.rejects(act('start_production'),/anticipo/);
 });
 const attach=async(type)=>{await db.exec('reset role');const path=`${orgs.etm}/${order}/${randomUUID()}`;await query("insert into storage.objects(bucket_id,name) values('sales-network-documents',$1)",[path]);await as('etm');return scalar("select public.network_attach_document($1,$2,$3,'proof.pdf','application/pdf',100)",[order,type,path]);};
 let document;
 await t.test('private vault and payment submission',async()=>{
  document=await attach('PURCHASE_ORDER');await attach('DEPOSIT_PROOF');assert.equal(await scalar('select status from public.orders where id=$1',[order]),'DEPOSIT_SUBMITTED');
  await as('sisco');assert.equal(await scalar('select count(*) from public.order_documents where id=$1',[document]),0);assert.equal(await scalar("select count(*) from storage.objects where bucket_id='sales-network-documents'"),0);
  await assert.rejects(query("select public.network_attach_document($1,'PURCHASE_ORDER','bad/path','x.pdf','application/pdf',100)",[order]),/no autorizado/);
  await as('hq');assert.equal(await scalar('select count(*) from public.order_documents where id=$1',[document]),1);
 });
 await t.test('reject with reason then resubmit; verified deposit releases production',async()=>{
  await assert.rejects(act('reject',{milestone_type:'DEPOSIT'}),/motivo/);await act('reject',{milestone_type:'DEPOSIT',reason:'Unreadable'});await attach('DEPOSIT_PROOF');await as('hq');await act('verify',{milestone_type:'DEPOSIT'});
  assert.equal(await scalar('select status from public.orders where id=$1',[order]),'RELEASED_TO_PRODUCTION');await act('start_production');
 });
 await t.test('10-day rule produces exactly one task and notification',async()=>{
  await as('hq');await act('date',{estimated_completion_date:await scalar("select to_char((now() at time zone 'America/Mexico_City')::date+11,'YYYY-MM-DD')")});
  await as('etm');await query('select public.refresh_sales_network_tasks($1)',[orgs.etm]);
  assert.equal(await scalar("select count(*) from public.sales_tasks where order_id=$1 and task_type='REQUEST_BALANCE'",[order]),0);
  await as('hq');await act('date',{estimated_completion_date:await scalar("select to_char((now() at time zone 'America/Mexico_City')::date+10,'YYYY-MM-DD')")});
  await as('etm');await query('select public.refresh_sales_network_tasks($1)',[orgs.etm]);await query('select public.refresh_sales_network_tasks($1)',[orgs.etm]);
  assert.equal(await scalar("select count(*) from public.sales_tasks where order_id=$1 and task_type='REQUEST_BALANCE'",[order]),1);
  assert.equal(await scalar("select count(*) from public.network_notifications where source_id=$1 and type='BALANCE_DUE'",[order]),1);
  await as('hq');await act('date',{estimated_completion_date:await scalar("select to_char((now() at time zone 'America/Mexico_City')::date+9,'YYYY-MM-DD')")});await as('etm');await query('select public.refresh_sales_network_tasks($1)',[orgs.etm]);assert.equal(await scalar("select count(*) from public.sales_tasks where order_id=$1 and task_type='REQUEST_BALANCE'",[order]),1);
 });
 await t.test('balance alone never means finished production; controlled ready/ship/deliver',async()=>{
  await attach('BALANCE_PROOF');await as('hq');await act('verify',{milestone_type:'BALANCE'});assert.equal(await scalar('select status from public.orders where id=$1',[order]),'IN_PRODUCTION');await assert.rejects(act('ship'),/listo/);
  await query('select public.refresh_sales_network_tasks($1)',[orgs.etm]);assert.equal(await scalar("select count(*) from public.sales_tasks where order_id=$1 and task_type='REQUEST_BALANCE' and status='OPEN'",[order]),0);
  await act('complete_production');assert.equal(await scalar('select status from public.orders where id=$1',[order]),'READY_TO_SHIP');await act('ship');await act('deliver');
  const events=(await query('select action from public.network_audit_log where entity_id=$1',[order])).map(x=>x.action);for(const event of ['order.created','order.approve','payment.submitted','order.verify','order.reject','order.start_production','order.complete_production','order.ship','order.deliver'])assert.ok(events.includes(event),event);
 });
 await t.test('P1 goals, insights, news audiences, branding and module controls',async()=>{
  await as('hq');
  const setting=async(org,action,data)=>query('select public.network_settings($1,$2,$3)',[org,action,JSON.stringify(data)]);
  await setting(orgs.etm,'goal',{period_start:'2020-01-01',period_end:'2099-01-01',target_amount:'100000'});
  await setting(orgs.etm,'goal',{period_start:'2020-01-01',period_end:'2099-01-01',target_amount:'200000'});
  await setting(orgs.etm,'branding',{display_name:'ETM Network',primary_color:'#123456'});
  await setting(orgs.etm,'module',{module_key:'NEWS',enabled:false});
  await setting(orgs.etm,'announcement',{scope:'ORG',audience:'ALL',announcement_type:'NEWS',title:'ETM only',body:'Dealer-specific'});
  await setting(orgs.sisco,'announcement',{scope:'ORG',audience:'ALL',announcement_type:'NEWS',title:'SISCO only',body:'Dealer-specific'});
  await setting(orgs.etm,'announcement',{scope:'ALL',audience:'HQ',announcement_type:'IMPORTANT',title:'HQ only',body:'Private'});
  assert.equal((await query('select * from public.network_dealer_summary()')).length,4);
  await query('select public.network_refresh_all_tasks()');const dashboard=await scalar('select public.network_dashboard(null)');assert.ok(dashboard.opportunities>=1);
  await as('etm');
  const insights=await scalar('select public.network_insights($1)',[orgs.etm]);
  assert.equal(insights.goals.length,1);assert.equal(Number(insights.goals[0].target_amount),200000);assert.equal(Number(insights.goals[0].achieved),Number(quote.total));
  assert.equal(insights.leaders[0].won,1);assert.equal(insights.machines[0].machine,'Test machine');
  assert.equal((await query('select title from public.network_announcements')).map(r=>r.title).join(','),'ETM only');
  await assert.rejects(setting(orgs.etm,'module',{module_key:'NEWS',enabled:true}),/Solo HQ/);
  await assert.rejects(query('select public.network_insights($1)',[orgs.sisco]),/no autorizado/);
  assert.equal(await scalar("select enabled from public.organization_modules where organization_id=$1 and module_key='NEWS'",[orgs.etm]),false);
 });
 await t.test('production-first convergence, balance rejection and verified balance create no new reminder',async()=>{
  await as('etm');const second=await opp(orgs.etm,'Production-first DEMO');
  const secondQuote=(await query("select * from public.create_quote($1::uuid,'{}'::jsonb,'Second DEMO','DEMO','525555555555',null,'LATER'::public.quote_delivery_type,null,null,null,null,null,$2::uuid)",[machine,advisor]))[0];
  await query("select public.network_opportunity($1,'link_quote',$2,$3)",[orgs.etm,second,JSON.stringify({quote_id:secondQuote.quote_id})]);
  await query("select public.network_opportunity($1,'stage',$2,$3)",[orgs.etm,second,JSON.stringify({stage:'WON'})]);
  const wonAt=await scalar('select won_at::text from public.opportunities where id=$1',[second]);await query("select public.network_opportunity($1,'stage',$2,$3)",[orgs.etm,second,JSON.stringify({stage:'WON'})]);assert.equal(await scalar('select won_at::text from public.opportunities where id=$1',[second]),wonAt);
  const secondOrder=await scalar('select public.network_create_order($1)',[second]);const action=async(name,data={})=>query('select public.network_order_action($1,$2,$3)',[secondOrder,name,JSON.stringify(data)]);
  const document=async type=>{await db.exec('reset role');const path=`${orgs.etm}/${secondOrder}/${randomUUID()}`;await query("insert into storage.objects(bucket_id,name) values('sales-network-documents',$1)",[path]);await as('etm');await query("select public.network_attach_document($1,$2,$3,'proof.pdf','application/pdf',100)",[secondOrder,type,path]);};
  await as('hq');await action('approve',{dealer_order_total:'100000.00',estimated_completion_date:await scalar("select to_char((now() at time zone 'America/Mexico_City')::date+10,'YYYY-MM-DD')")});
  await document('DEPOSIT_PROOF');await as('hq');await action('verify',{milestone_type:'DEPOSIT'});await action('start_production');await action('complete_production');assert.equal(await scalar('select status from public.orders where id=$1',[secondOrder]),'AWAITING_BALANCE');await assert.rejects(action('ship'),/listo/);
  await document('BALANCE_PROOF');await as('hq');await assert.rejects(action('reject',{milestone_type:'BALANCE'}),/motivo/);await action('reject',{milestone_type:'BALANCE',reason:'Unreadable balance'});
  await document('BALANCE_PROOF');await as('hq');await action('verify',{milestone_type:'BALANCE'});assert.equal(await scalar('select status from public.orders where id=$1',[secondOrder]),'READY_TO_SHIP');
  await query('select public.refresh_sales_network_tasks($1)',[orgs.etm]);await query('select public.refresh_sales_network_tasks($1)',[orgs.etm]);assert.equal(await scalar("select count(*) from public.sales_tasks where order_id=$1 and task_type='REQUEST_BALANCE'",[secondOrder]),0);
 });
 await t.test('revoked device loses data access and cannot re-register',async()=>{
  await as('hq');const id=await scalar('select id from public.network_devices where user_id=$1',[ids.etm]);await query('select public.network_revoke_device($1)',[id]);await as('etm');assert.equal(await scalar('select count(*) from public.opportunities'),0);await assert.rejects(query('select public.network_register_device($1,$2)',[orgs.etm,devices.etm]),/revocado/);
  assert.equal((await scalar('select public.network_activate_result($1,$2,$3)',[hash,devices.etm,'Revoked'])).status,'REVOKED');
 });
 await t.test('organization admin device directory is scoped; inactive membership cannot reactivate',async()=>{
  await db.exec('reset role');await query("update public.organization_memberships set network_role='ORG_ADMIN' where user_id=$1",[ids.sisco]);
  await as('sisco');const rows=await query('select * from public.network_device_directory($1)',[orgs.sisco]);assert.equal(rows.length,1);assert.equal(rows[0].organization_name,'SISCO PRINT');
  await assert.rejects(query('select * from public.network_device_directory($1)',[orgs.etm]),/no autorizado/);
  await db.exec('reset role');await query("update public.organization_memberships set active=false where user_id=$1",[ids.sisco]);await as('sisco');assert.equal(await scalar('select public.is_org_member($1)',[orgs.sisco]),false);await assert.rejects(query('select public.network_register_device($1,$2)',[orgs.sisco,randomUUID()]),/Membresía/);
  await db.exec('reset role');await query("update public.organization_memberships set active=false where user_id=$1 and organization_id=$2",[ids.fresh,orgs.etm]);await as('fresh');assert.equal((await scalar('select public.network_activate_result($1,$2,$3)',[hash,devices.fresh,'Inactive'])).status,'INACTIVE');
 });
 await t.test('demo reset executes against real PostgreSQL foreign keys and preserves unrelated data',async()=>{
  await db.exec('reset role');await query("update public.opportunities set title='Textiles Vega' where id=$1",[opportunity]);
  const quoteCount=await scalar('select count(*) from public.quotes'),orderCount=await scalar('select count(*) from public.orders'),machineCount=await scalar('select count(*) from public.machines');
  const admin={auth:{admin:{getUserById:async id=>({data:{user:{id,email:id===ids.hq?demoEmails.hq:demoEmails.dealer,app_metadata:{sales_network_demo:'staging-v1'}}}})}},storage:{from:()=>({remove:async paths=>({data:await query('delete from storage.objects where name=any($1::text[]) returning id',[paths])})})},from(table){
   assert.match(table,/^[a-z_]+$/);let operation='select',single=false,values=[],conditions=[],updates;
   const q={select(){return q;},delete(){operation='delete';return q;},update(v){operation='update';updates=v;return q;},eq(k,v){assert.match(k,/^[a-z_]+$/);values.push(v);conditions.push(`${k}=$${values.length}`);return q;},in(k,v){assert.match(k,/^[a-z_]+$/);values.push(v);conditions.push(`${k}=any($${values.length}::uuid[])`);return q;},single(){single=true;return q;},limit(){return q;},then(resolve,reject){
    let sql=operation==='select'?`select * from public.${table}`:operation==='delete'?`delete from public.${table}`:`update public.${table} set active=false`;
    if(updates)assert.deepEqual(updates,{active:false});sql+=' where '+conditions.join(' and ');if(operation!=='select')sql+=' returning *';
    return query(sql,values).then(rows=>({data:single?rows[0]:rows})).then(resolve,reject);
   }};return q;
  }};
  const manifest={version:1,organization_id:orgs.etm,users:{hq:ids.hq,dealer:ids.etm},opportunities:[opportunity],goals:[],announcements:[]};
  await resetDemo(admin,manifest);await resetDemo(admin,manifest);
  assert.equal(await scalar('select count(*) from public.orders'),orderCount-1);assert.equal(await scalar('select count(*) from public.orders where id=$1',[order]),0);
  assert.equal(await scalar('select count(*) from public.quotes'),quoteCount);assert.equal(await scalar('select count(*) from public.machines'),machineCount);
  assert.equal(await scalar('select count(*) from public.sales_goals'),1);
 });
 await t.test('activation-only reset preserves workflow and identities; real code activates ETM twice',async()=>{
  await db.exec('reset role');
  let writes=0;
  const admin={auth:{admin:{getUserById:async id=>({data:{user:{id,email:id===ids.hq?demoEmails.hq:demoEmails.dealer,app_metadata:{sales_network_demo:'staging-v1'}}}})}},from(table){
   assert.match(table,/^[a-z_]+$/);let operation='select',single=false,filters=[],payload,ordering='';
   const q={select(){return q;},delete(){operation='delete';return q;},update(v){operation='update';payload=v;return q;},insert(v){operation='insert';payload=v;return q;},eq(k,v){assert.match(k,/^[a-z_]+$/);filters.push([k,v]);return q;},single(){single=true;return q;},order(k,{ascending=true}={}){assert.match(k,/^[a-z_]+$/);ordering=` order by ${k} ${ascending?'asc':'desc'}`;return q;},limit(){return q;},then(resolve,reject){
    const values=[];const bind=v=>{values.push(v);return '$'+values.length;};let sql;
    if(operation==='select')sql=`select * from public.${table}`;
    else if(operation==='delete')sql=`delete from public.${table}`;
    else if(operation==='update')sql=`update public.${table} set `+Object.entries(payload).map(([k,v])=>`${k}=${bind(v)}`).join(',');
    else sql=`insert into public.${table} (${Object.keys(payload).join(',')}) values (${Object.values(payload).map(bind).join(',')})`;
    if(filters.length)sql+=' where '+filters.map(([k,v])=>`${k}=${bind(v)}`).join(' and ');
    sql+=operation==='select'?ordering:' returning *';if(operation!=='select')writes++;
    return query(sql,values).then(rows=>({data:single?rows[0]:rows})).then(resolve,reject);
   }};return q;
  }};
  const manifest={version:1,organization_id:orgs.etm,users:{hq:ids.hq,dealer:ids.etm}};
  await assert.rejects(resetDemoActivation(admin,{...manifest,organization_id:orgs.sisco}),/Only ETM/);assert.equal(writes,0);
  await query("insert into public.organization_memberships(organization_id,user_id,network_role) values($1,$2,'SELLER')",[orgs.sisco,ids.etm]);
  await assert.rejects(resetDemoActivation(admin,manifest),/Unexpected demo membership/);assert.equal(writes,0);
  await query('delete from public.organization_memberships where organization_id=$1 and user_id=$2',[orgs.sisco,ids.etm]);
  const tables=['auth.users','profiles','salespeople','organizations','opportunities','sales_tasks','sales_goals','quotes','machines','orders'];
  const counts=async()=>Promise.all(tables.map(table=>scalar('select count(*) from '+table)));
  const before=await counts();
  const first=await resetDemoActivation(admin,manifest);
  assert.equal(await scalar('select count(*) from public.organization_memberships where user_id=$1',[ids.etm]),0);
  assert.equal(await scalar('select count(*) from public.network_devices where user_id=$1',[ids.etm]),0);
  assert.equal(await scalar('select count(*) from public.network_activation_attempts where user_id=$1',[ids.etm]),0);
  assert.deepEqual(await counts(),before);
  const codeHash=createHash('sha256').update(first.code).digest('hex');assert.equal(await scalar('select code_hash from public.dealer_activation_codes where id=$1',[first.activation_code_id]),codeHash);
  assert.equal(await scalar('select use_count from public.dealer_activation_codes where id=$1',[first.activation_code_id]),0);
  await as('etm');assert.equal(await scalar('select public.network_access($1)',[orgs.etm]),false);
  assert.equal((await scalar('select public.network_activate_result($1,$2,$3)',[codeHash,devices.etm,'Demo browser'])).status,'OK');
  assert.equal(await scalar('select public.network_access($1)',[orgs.etm]),true);
  assert.equal(await scalar('select network_role from public.organization_memberships where user_id=auth.uid()'),'SELLER');
  await db.exec('reset role');assert.equal(await scalar('select use_count from public.dealer_activation_codes where id=$1',[first.activation_code_id]),1);
  const second=await resetDemoActivation(admin,{...manifest,activation_code_id:first.activation_code_id});assert.equal(second.activation_code_id,first.activation_code_id);assert.notEqual(second.code,first.code);assert.deepEqual(await counts(),before);
  await as('etm');assert.equal((await scalar('select public.network_activate_result($1,$2,$3)',[codeHash,devices.etm,'Old code'])).status,'INVALID');
  assert.equal((await scalar('select public.network_activate_result($1,$2,$3)',[createHash('sha256').update(second.code).digest('hex'),devices.etm,'Repeat demo'])).status,'OK');
 });
 }finally{await db.close();}
});
