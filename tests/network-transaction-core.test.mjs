import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '../tmp/sql-validation/node_modules/@electric-sql/pglite/dist/index.js';
import {buildStagingBaseline} from '../scripts/lib/staging-baseline.mjs';

test('transaction core: attribution, branding, confirmation, OC, payments, lifecycle and supplier isolation',async t=>{
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
 for(const f of readdirSync('supabase/migrations').filter(f=>f>='20261018000031'&&f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const one=async(sql,args=[])=>Object.values((await rows(sql,args))[0])[0];
 const org=Object.fromEntries((await rows('select slug,id from public.organizations')).map(g=>[g.slug,g.id]));
 const ids={hq:randomUUID(),dealer:randomUUID(),sisco:randomUUID(),supplier:randomUUID()};const devices=Object.fromEntries(Object.keys(ids).map(k=>[k,randomUUID()]));
 const foreignSupplier=randomUUID();await rows("insert into public.organizations(id,name,slug,organization_type) values($1,'Other supplier','other-supplier','SUPPLIER')",[foreignSupplier]);
 const context={hq:org.nahuitech,dealer:org.etm,sisco:org['sisco-print'],supplier:foreignSupplier};
 for(const [k,id]of Object.entries(ids)){
  await rows('insert into auth.users(id,email) values($1,$2)',[id,k+'@example.invalid']);
  await rows('insert into public.organization_memberships(organization_id,user_id,network_role) values($1,$2,$3)',[context[k],id,k==='hq'||k==='supplier'?'NETWORK_OWNER':k==='dealer'?'MANAGER':'SELLER']);
  await rows('insert into public.network_devices(organization_id,user_id,device_public_id) values($1,$2,$3)',[context[k],id,devices[k]]);
 }
 await rows("update public.profiles set role='admin' where id=$1",[ids.hq]);
 const as=async k=>{await db.exec('reset role');await rows("select set_config('request.jwt.claim.sub',$1,false)",[ids[k]]);await rows("select set_config('request.headers',$1,false)",[JSON.stringify({'x-network-device':devices[k],'x-network-org':context[k]})]);await db.exec('set role authenticated');};
 const op=async(id,action,data={})=>one('select public.network_opportunity($1,$2,$3,$4)',[org.etm,action,id,JSON.stringify(data)]);
 const act=async(id,action,data={})=>rows('select public.network_order_action($1,$2,$3)',[id,action,JSON.stringify(data)]);
 let seller,branch,quote,opportunity,order;
 await t.test('branding and team are tenant authorized, supplier does not become global HQ',async()=>{
  await as('sisco');await assert.rejects(rows('select public.network_branding($1,$2)',[org.etm,JSON.stringify({display_name:'Hijack'})]),/requerida/);
  await as('supplier');assert.equal(await one('select public.is_network_owner()'),false);await assert.rejects(one('select public.network_dashboard(null)'),/Solo HQ/);
  await as('dealer');await rows('select public.network_branding($1,$2)',[org.etm,JSON.stringify({display_name:'ETM Comercial',finance_contact_name:'Demo Finance',finance_email:'demo@example.invalid',authorized_distributor_label:'Distribuidor autorizado de Nahuitech'})]);
  branch=await one('select public.network_team($1,$2,null,$3)',[org.etm,'branch',JSON.stringify({name:'Branch explicitly created in test'})]);
  seller=await one('select public.network_team($1,$2,null,$3)',[org.etm,'seller',JSON.stringify({full_name:'Asesor prueba',phone:'5555555555',email:'seller@example.invalid',branch_id:branch})]);
  await as('sisco');assert.equal(await one('select count(*) from public.salespeople where id=$1',[seller]),0);assert.equal(await one('select count(*) from public.organization_branches where id=$1',[branch]),0);
  await assert.rejects(one('select public.network_opportunity($1,$2,null,$3)',[context.sisco,'create',JSON.stringify({title:'Foreign seller',salesperson_id:seller})]),/otra organización/);
 });
 await t.test('new commercial quote RPC retains exact price and captures immutable attribution',async()=>{
  await db.exec('reset role');await rows('update public.profiles set salesperson_id=$1 where id=$2',[seller,ids.dealer]);await as('dealer');
  const machine=await one("select id from public.machines where slug='nahui-flash-on'");
  quote=(await rows("select * from public.create_quote($1,'{}','Cliente prueba','','5555555555','','LATER',null,null,null,null,null,$2)",[machine,seller]))[0].quote_id;
  const q=(await rows('select * from public.quotes where id=$1',[quote]))[0];assert.equal(Number(q.total),69990);assert.equal(q.organization_id,org.etm);assert.equal(q.branch_id,branch);assert.equal(q.salesperson_phone_snapshot,'5555555555');assert.equal(q.organization_name_snapshot,'ETM Comercial');
  await rows('select public.network_branding($1,$2)',[org.etm,JSON.stringify({display_name:'ETM cambiado'})]);
  assert.equal(await one('select organization_name_snapshot from public.quotes where id=$1',[quote]),'ETM Comercial');
  await db.exec('reset role');await assert.rejects(rows("update public.quotes set organization_name_snapshot='Override' where id=$1",[quote]),/histórica/);
 });
 await t.test('quote linking, human confirmation and order snapshots',async()=>{
  await as('dealer');opportunity=await op(null,'create',{title:'Compra real de prueba',salesperson_id:seller});await op(opportunity,'link_quote',{quote_id:quote});
  await assert.rejects(op(opportunity,'stage',{stage:'WON'}),/confirmó/);
  await assert.rejects(op(opportunity,'confirm_purchase',{confirmed:'yes'}),/negociación/);
  await op(opportunity,'stage',{stage:'NEGOTIATION'});await op(opportunity,'confirm_purchase',{confirmed:'yes'});
  assert.equal(await one("select count(*) from public.opportunity_activities where opportunity_id=$1 and activity_type='CUSTOMER_CONFIRMED_PURCHASE'",[opportunity]),1);
  order=await one('select public.network_create_order($1)',[opportunity]);assert.equal(await one('select public.network_create_order($1)',[opportunity]),order);
  const o=(await rows('select * from public.orders where id=$1',[order]))[0];assert.equal(o.dealer_order_total,null);assert.equal(Number(o.customer_quote_total_snapshot),69990);assert.equal(o.dealer_name_snapshot,'ETM Comercial');assert.equal(o.salesperson_phone_snapshot,'5555555555');assert.equal(o.customer_name_snapshot,'Cliente prueba');
  assert.equal(await one('select count(*) from public.order_items where order_id=$1',[order]),1);
  await as('hq');assert.equal((await one('select public.network_quote_detail($1)',[quote])).quote.folio,o.quote_snapshot.quote.folio);
  await as('sisco');assert.equal(await one('select count(*) from public.orders where id=$1',[order]),0);await assert.rejects(one('select public.network_quote_detail($1)',[quote]),/autorizad/);
 });
 const submit=async(type,amount,actor='dealer')=>{
  await db.exec('reset role');const path=`${org.etm}/${order}/${randomUUID()}`;await rows("insert into storage.objects(bucket_id,name) values('sales-network-documents',$1)",[path]);await as(actor);
  return one("select public.network_submit_document($1,$2,$3,'demo.pdf','application/pdf',100,$4,'DEMO-REF')",[order,type,path,amount??null]);
 };
 await t.test('sell-in approval validates percentages and never accepts dealer edits',async()=>{
  const approval={dealer_order_total:'205000.00',estimated_completion_date:new Date(Date.now()+9*86400000).toISOString().slice(0,10),deposit_percent:'50',balance_percent:'50'};
  await as('dealer');await assert.rejects(act(order,'approve',approval),/Solo HQ/);
  await as('hq');await assert.rejects(act(order,'approve',{...approval,balance_percent:'40'}),/sumar 100/);await act(order,'approve',approval);
  assert.equal(await one('select count(*) from public.order_payment_milestones where order_id=$1 and amount=102500',[order]),2);
  assert.equal(Number(await one('select customer_quote_total_snapshot from public.orders where id=$1',[order])),69990);
 });
 await t.test('even HQ cannot verify its own submitted voucher',async()=>{
  await submit('DEPOSIT_PROOF','102500','hq');await assert.rejects(act(order,'verify',{milestone_type:'DEPOSIT'}),/propio comprobante/);
  await act(order,'reject',{milestone_type:'DEPOSIT',reason:'Solicitar comprobante al dealer'});
 });
 await t.test('verified deposit without OC never releases production; later OC converges',async()=>{
  await submit('DEPOSIT_PROOF','102500');await as('dealer');await assert.rejects(act(order,'verify',{milestone_type:'DEPOSIT'}),/Solo HQ/);
  await as('hq');await act(order,'verify',{milestone_type:'DEPOSIT'});assert.equal(await one('select status from public.orders where id=$1',[order]),'AWAITING_DEPOSIT');await assert.rejects(act(order,'start_production'),/anticipo/);
  await submit('PURCHASE_ORDER');assert.equal(await one('select status from public.orders where id=$1',[order]),'RELEASED_TO_PRODUCTION');
 });
 await t.test('approved change preserves paid deposit, updates balance and archives snapshots',async()=>{
  await as('dealer');const item=await one('select id from public.order_items where order_id=$1',[order]);
  const request=await one('select public.network_order_request($1,$2,$3,$4,$5)',[order,'CHANGE','Cliente solicita ajuste',item,'Configuración adicional aprobada']);
  await assert.rejects(rows('select public.network_review_request($1,true,$2)',[request,JSON.stringify({reason:'Test',price_delta:'4000'})]),/Solo HQ/);
  await as('sisco');assert.equal(await one('select count(*) from public.order_change_requests where id=$1',[request]),0);
  await as('hq');await rows('select public.network_review_request($1,true,$2)',[request,JSON.stringify({reason:'Ajuste autorizado',price_delta:'4000'})]);
  assert.equal(Number(await one('select dealer_order_total from public.orders where id=$1',[order])),209000);
  assert.equal(Number(await one("select amount from public.order_payment_milestones where order_id=$1 and milestone_type='DEPOSIT'",[order])),102500);
  assert.equal(Number(await one("select amount from public.order_payment_milestones where order_id=$1 and milestone_type='BALANCE'",[order])),106500);
  assert.equal(Number(await one('select total from public.quotes where id=$1',[quote])),69990);
  assert.equal((await one('select old_snapshot from public.order_change_requests where id=$1',[request])).sell_in_total,205000);
  assert.equal(await one('select status from public.order_change_requests where id=$1',[request]),'APPROVED');
  await assert.rejects(rows('select public.network_review_request($1,true,$2)',[request,JSON.stringify({reason:'Replay',price_delta:'4000'})]),/no pendiente/);
  await act(order,'reserve',{reservation_type:'PRODUCTION_SLOT',reference:'Local test'});
 });
 await t.test('post-sale tasks route contacts and 10-day rule is idempotent',async()=>{
  await as('hq');await act(order,'start_production');
  await as('dealer');await rows('select public.refresh_sales_network_tasks($1)',[org.etm]);await rows('select public.refresh_sales_network_tasks($1)',[org.etm]);
  const tasks=await rows("select * from public.sales_tasks where order_id=$1 and task_type='REQUEST_BALANCE'",[order]);assert.equal(tasks.length,1);assert.equal(tasks[0].priority,'HIGH');assert.equal(tasks[0].contact_snapshot.email,'demo@example.invalid');
  await assert.rejects(one('select public.network_task($1,$2,$3)',[org.etm,tasks[0].id,JSON.stringify({status:'DONE'})]),/al avanzar el pedido/);
  assert.equal(await one("select count(*) from public.network_notifications where organization_id=$1 and source_id=$2 and type='BALANCE_REQUESTED'",[org.etm,order]),1);
 });
 await t.test('mismatched balance rejected and resubmitted; payment alone never means ready',async()=>{
  await submit('BALANCE_PROOF','1');await as('hq');await assert.rejects(act(order,'verify',{milestone_type:'BALANCE'}),/importe/);await assert.rejects(act(order,'reject',{milestone_type:'BALANCE'}),/motivo/);
  await act(order,'reject',{milestone_type:'BALANCE',reason:'Importe incorrecto'});
  await submit('BALANCE_PROOF','106500');await as('hq');await act(order,'verify',{milestone_type:'BALANCE'});assert.equal(await one('select status from public.orders where id=$1',[order]),'IN_PRODUCTION');
  await act(order,'complete_production');assert.equal(await one('select status from public.orders where id=$1',[order]),'READY_TO_SHIP');await act(order,'ship');await act(order,'deliver',{delivery_date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())});
  const events=(await rows('select event_type from public.order_events where order_id=$1',[order])).map(e=>e.event_type);
  for(const name of ['NEW_ORDER','CUSTOMER_CONFIRMED_PURCHASE','ORDER_APPROVED','PURCHASE_ORDER_RECEIVED','DEPOSIT_SUBMITTED','DEPOSIT_VERIFIED','PRODUCTION_STARTED','BALANCE_REQUESTED','BALANCE_SUBMITTED','BALANCE_VERIFIED','PRODUCTION_COMPLETED','READY_TO_SHIP','SHIPPED','DELIVERED'])assert.ok(events.includes(name),name);
  assert.equal(await one("select count(*) from public.sales_tasks where order_id=$1 and automation_key like 'operation:%' and status='OPEN'",[order]),0);
 });
 await t.test('delivery creates units without inventing warranty duration; unit opportunities are isolated',async()=>{
  await as('dealer');const units=await rows('select * from public.installed_units where order_id=$1',[order]);assert.equal(units.length,1);assert.equal(units[0].warranty_end_date,null);assert.equal(units[0].serial_number,null);
  const followup=await one('select public.network_unit_opportunity($1,$2)',[units[0].id,'Ampliación futura']);
  assert.equal(await one('select installed_unit_id from public.opportunities where id=$1',[followup]),units[0].id);
  assert.equal(await one('select count(*) from public.order_reservations where order_id=$1 and released_at is null',[order]),0);
  await as('sisco');assert.equal(await one('select count(*) from public.installed_units where order_id=$1',[order]),0);await assert.rejects(one('select public.network_unit_opportunity($1,$2)',[units[0].id,'Intrusión']),/no autorizado/);
 });
 await t.test('cancellation requires explicit financial and production approvals, preserves payments',async()=>{
  await as('dealer');const machine=await one("select id from public.machines where slug='nahui-flash-on'");
  const cancelQuote=(await rows("select * from public.create_quote($1,'{}','Cliente cancelación','','5555555555','','LATER',null,null,null,null,null,$2)",[machine,seller]))[0].quote_id;
  const cancelOpp=await op(null,'create',{title:'Cancelar en prueba'});await op(cancelOpp,'link_quote',{quote_id:cancelQuote});await op(cancelOpp,'stage',{stage:'NEGOTIATION'});await op(cancelOpp,'confirm_purchase',{confirmed:'yes'});
  const cancelOrder=await one('select public.network_create_order($1)',[cancelOpp]);
  await as('hq');await act(cancelOrder,'approve',{dealer_order_total:'100',estimated_completion_date:'2099-01-01'});
  await db.exec('reset role');await rows("update public.order_payment_milestones set status='VERIFIED',verified_at=now(),verified_by_user_id=$2 where order_id=$1 and milestone_type='DEPOSIT'",[cancelOrder,ids.hq]);await rows("update public.orders set status='IN_PRODUCTION',production_started_at=now() where id=$1",[cancelOrder]);
  await as('dealer');const request=await one("select public.network_order_request($1,'CANCEL','Proyecto cancelado')",[cancelOrder]);
  await as('hq');const review=data=>rows('select public.network_review_request($1,true,$2)',[request,JSON.stringify(data)]);
  await assert.rejects(review({reason:'Confirmado'}),/pagos validados/);await assert.rejects(review({reason:'Confirmado',confirm_paid:'yes'}),/producción iniciada/);
  await review({reason:'Autorización explícita',confirm_paid:'yes',confirm_production:'yes'});
  assert.equal(await one('select status from public.orders where id=$1',[cancelOrder]),'CANCELLED');assert.equal(Number(await one("select amount from public.order_payment_milestones where order_id=$1 and milestone_type='DEPOSIT' and status='VERIFIED'",[cancelOrder])),50);
  await assert.rejects(act(cancelOrder,'start_production'),/anticipo/);
 });
 await t.test('multi-machine attribution and immutable quantities, lines and independent sell-in',async()=>{
  await as('dealer');const machine=await one("select id from public.machines where slug='nahui-flash-on'");
  const payload=JSON.stringify([{machine_id:machine,quantity:2,addons:[]}]);
  const multi=(await rows("select * from public.create_multi_quote($1::jsonb,'Multi demo','','5555555555','','LATER',null,null,null,$2)",[payload,seller]))[0].quote_id;
  const q=(await rows('select * from public.quotes where id=$1',[multi]))[0];assert.equal(q.organization_id,org.etm);assert.equal(Number(q.total),139980);
  const opportunity=await op(null,'create',{title:'Multi machine order'});await op(opportunity,'link_quote',{quote_id:multi});await op(opportunity,'stage',{stage:'NEGOTIATION'});await op(opportunity,'confirm_purchase',{confirmed:'yes'});
  const multiOrder=await one('select public.network_create_order($1)',[opportunity]);const lines=await rows('select * from public.order_items where order_id=$1',[multiOrder]);assert.equal(lines.length,1);assert.equal(lines[0].quantity,2);assert.equal(Number(lines[0].sell_out_line_total_snapshot),139980);assert.equal(Number(lines[0].sell_out_unit_price_snapshot),69990);assert.equal(await one('select dealer_order_total from public.orders where id=$1',[multiOrder]),null);
  await as('hq');await act(multiOrder,'approve',{dealer_order_total:'100.01',deposit_percent:'33.33',balance_percent:'66.67',estimated_completion_date:'2099-01-01'});
  const amounts=await rows('select milestone_type,amount from public.order_payment_milestones where order_id=$1 order by milestone_type',[multiOrder]);assert.deepEqual(amounts.map(m=>Number(m.amount)),[66.68,33.33]);
  const cancel=await one("select public.network_order_request($1,'CANCEL','Test cleanup')",[multiOrder]);await rows('select public.network_review_request($1,true,$2)',[cancel,JSON.stringify({reason:'Before payment'})]);
 });
 await t.test('supplier can read own orders only; Nahuitech HQ cannot mutate another supplier order',async()=>{
  await db.exec('reset role');await rows('update public.orders set supplier_organization_id=$1,manufacturer_organization_id=$1 where id=$2',[foreignSupplier,order]);
  await as('supplier');assert.equal(await one('select count(*) from public.orders where id=$1',[order]),1);
  await as('hq');assert.equal(await one('select count(*) from public.orders where id=$1',[order]),0);await assert.rejects(act(order,'date',{estimated_completion_date:'2099-01-01'}),/Solo HQ del proveedor/);
  assert.equal((await one('select public.network_dashboard(null)')).orders,0);
 });
 }finally{await db.close();}
});
