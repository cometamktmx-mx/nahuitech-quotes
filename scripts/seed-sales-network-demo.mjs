// Explicit/manual only. Never invoked by build, migrations, or application startup.
// node --env-file=.env.sales-network-staging scripts/seed-sales-network-demo.mjs --allow-demo-seed
import {createClient} from '@supabase/supabase-js';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {stagingTarget,demoEmails,assertDemoUser,readManifest,saveManifest,unwrap} from './lib/sales-network-staging.mjs';
const {url,secret,host,ref}=stagingTarget('--allow-demo-seed');
const password=process.env.SALES_NETWORK_DEMO_PASSWORD;
if(!password||password.length<12||password.startsWith('REPLACE_'))throw Error('Supply a unique demo password of 12+ characters.');
if(process.argv.includes('--with-order'))throw Error('Orders must be converted live; --with-order is disabled.');
const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const manifest=readManifest(ref)??{version:1,host,users:{},opportunities:[],quotes:[],goals:[],announcements:[]};
if(manifest.host!==host||manifest.version!==1)throw Error('Manifest target mismatch.');
const save=()=>saveManifest(ref,manifest);
const orgs=unwrap(await admin.from('organizations').select('id,slug'));
const hq=orgs.find(o=>o.slug==='nahuitech')?.id,etm=orgs.find(o=>o.slug==='etm')?.id;
if(!hq||!etm)throw new Error('Apply Sales Network migrations first.');
const emails=demoEmails;
const users={};
for(const [kind,email] of Object.entries(emails)){
 const existing=unwrap(await admin.from('profiles').select('id').eq('full_name',`Sales Network DEMO ${kind}`)).at(0);
 if(existing){const auth=unwrap(await admin.auth.admin.getUserById(existing.id));assertDemoUser(auth.user,kind);users[kind]=existing.id;}
 else{const auth=unwrap(await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{sales_network_demo:'staging-v1'},user_metadata:{full_name:`Sales Network DEMO ${kind}`}}));users[kind]=auth.user.id;}
 manifest.users[kind]=users[kind];save();
}
let salesperson=unwrap(await admin.from('salespeople').select('id').eq('email',emails.dealer)).at(0)?.id;
if(!salesperson)salesperson=unwrap(await admin.from('salespeople').insert({full_name:'Vendedor DEMO ETM',email:emails.dealer}).select('id').single()).id;
unwrap(await admin.from('profiles').update({role:'admin',active:true}).eq('id',users.hq));
unwrap(await admin.from('profiles').update({role:'seller',active:true,salesperson_id:salesperson}).eq('id',users.dealer));
unwrap(await admin.from('organization_memberships').upsert([{organization_id:hq,user_id:users.hq,network_role:'NETWORK_OWNER'},{organization_id:etm,user_id:users.dealer,network_role:'SELLER'}],{onConflict:'organization_id,user_id',ignoreDuplicates:true}));
const clients={};
for(const kind of ['hq','dealer']){
 const device=randomUUID();unwrap(await admin.from('network_devices').insert({organization_id:kind==='hq'?hq:etm,user_id:users[kind],device_public_id:device,device_name:'DEMO seed session'}));
 clients[kind]=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{global:{headers:{'x-network-device':device}},auth:{persistSession:false,autoRefreshToken:false}});
 unwrap(await clients[kind].auth.signInWithPassword({email:emails[kind],password}));
}
const dealer=clients.dealer;
const rpc=async(client,name,args)=>unwrap(await client.rpc(name,args));
const machines=unwrap(await admin.from('machines').select('id,name,delivery_policy').eq('active',true).order('sort_order'));
const machine=process.env.SALES_NETWORK_DEMO_MACHINE_ID?machines.find(m=>m.id===process.env.SALES_NETWORK_DEMO_MACHINE_ID):machines[0];
if(!machine)throw new Error('Select an existing active machine with SALES_NETWORK_DEMO_MACHINE_ID.');
const variants=unwrap(await admin.from('machine_variants').select('id').eq('machine_id',machine.id).eq('active',true).order('sort_order'));
const requiredAddons=unwrap(await admin.from('machine_addons').select('addon_id,addons!inner(required)').eq('machine_id',machine.id).eq('active',true));
const addons=Object.fromEntries(requiredAddons.filter(a=>a.addons.required).map(a=>[a.addon_id,1]));
async function makeQuote(title){const rows=await rpc(dealer,'create_quote',{p_machine_id:machine.id,p_addon_quantities:addons,p_customer_name:title,p_customer_company:'DEMO · NO COMERCIAL',p_customer_whatsapp:'525555555555',p_customer_email:'demo@example.invalid',p_delivery_type:machine.delivery_policy==='INSTALLATION_REQUIRED'?'INSTALLATION':machine.delivery_policy==='SHIPPING_ONLY'?'SHIPPING':'LATER',p_coupon_code:null,p_client_generated_id:null,p_client_generated_folio:null,p_machine_image_url_snapshot:null,p_machine_variant_id:variants[0]?.id??null,p_salesperson_id:salesperson});const id=rows[0].quote_id;manifest.quotes.push(id);save();return id;}
const demoTitles=['Textiles Vega','Grupo Industrial León','Confecciones del Bajío'];
const opportunities=[];
for(const [index,title] of demoTitles.entries()){
 let o=unwrap(await dealer.from('opportunities').select('*').eq('organization_id',etm).eq('title',title).eq('created_by_user_id',users.dealer)).at(0);
 if(!o){const id=await rpc(dealer,'network_opportunity',{p_org:etm,p_action:'create',p_data:{title,product_interest:machine.name,salesperson_id:salesperson,customer_name:title,customer_company:'DEMO - NO COMERCIAL',customer_whatsapp:'525555555555'}});o={id,stage:'NEW'};}
 if(index<2&&!o.linked_quote_id){const quote=await makeQuote(title);await rpc(dealer,'network_opportunity',{p_org:etm,p_action:'link_quote',p_id:o.id,p_data:{quote_id:quote}});o.stage='QUOTED';}
 if(index===1&&o.stage==='QUOTED')await rpc(dealer,'network_opportunity',{p_org:etm,p_action:'stage',p_id:o.id,p_data:{stage:'NEGOTIATION'}});
 opportunities.push(o.id);if(!manifest.opportunities.includes(o.id))manifest.opportunities.push(o.id);save();
}
const manualTasks=[{title:'Contactar Textiles Vega',opportunity_id:opportunities[0],task_type:'FOLLOW_UP',priority:'HIGH',days:0},{title:'Programar llamada',opportunity_id:opportunities[1],task_type:'CALL',priority:'MEDIUM',days:0},{title:'Cotización próxima a vencer',opportunity_id:opportunities[0],task_type:'QUOTE_EXPIRING',priority:'HIGH',days:13}];
for(const task of manualTasks){const {days,...row}=task;unwrap(await admin.from('sales_tasks').upsert({...row,organization_id:etm,assigned_user_id:users.dealer,due_at:new Date(Date.now()+days*86400000).toISOString(),description:'Recordatorio manual DEMO. No altera fechas ni vigencia de la cotización.',automation_key:'demo:'+task.task_type+':'+task.opportunity_id,created_by_system:false},{onConflict:'automation_key',ignoreDuplicates:true}));}
const now=new Date();const start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString().slice(0,10);const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString().slice(0,10);
const existingGoals=unwrap(await admin.from('sales_goals').select('id').eq('organization_id',etm).eq('period_start',start).eq('period_end',end).is('user_id',null).is('salesperson_id',null));
if(existingGoals.some(g=>!manifest.goals.includes(g.id)))throw Error('Existing ETM goal is not owned by this demo manifest. Refusing overwrite.');
await rpc(clients.hq,'network_settings',{p_org:etm,p_action:'goal',p_data:{period_start:start,period_end:end,target_amount:'300000.00'}});
const announcement=unwrap(await admin.from('network_announcements').select('id').eq('title','Nuevo lanzamiento Nahuitech').eq('organization_id',etm));
if(!announcement.length)await rpc(clients.hq,'network_settings',{p_org:etm,p_action:'announcement',p_data:{scope:'ORG',audience:'ALL',announcement_type:'PRODUCT_LAUNCH',title:'Nuevo lanzamiento Nahuitech',body:'Entorno de demostración. Los registros DEMO no representan operaciones reales.'}});
manifest.goals=unwrap(await admin.from('sales_goals').select('id').eq('organization_id',etm).eq('period_start',start).eq('period_end',end).is('user_id',null).is('salesperson_id',null)).map(g=>g.id);
manifest.announcements=unwrap(await admin.from('network_announcements').select('id').eq('organization_id',etm).eq('created_by_user_id',users.hq).eq('title','Nuevo lanzamiento Nahuitech')).map(a=>a.id);
manifest.organization_id=etm;save();
const code=randomBytes(32).toString('hex');await rpc(clients.hq,'network_issue_code',{p_org:etm,p_hash:createHash('sha256').update(code).digest('hex')});
console.log('DEMO prepared in',host,'\nHQ:',emails.hq,'\nETM:',emails.dealer,'\nETM activation code (save now):',code,'\nNo WhatsApp messages sent. Password is the explicitly supplied demo password.');
