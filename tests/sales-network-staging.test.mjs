import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
import {stagingTarget,assertDemoUser,demoEmails} from '../scripts/lib/sales-network-staging.mjs';
import {resetDemo} from '../scripts/lib/reset-sales-network-demo.mjs';
const env={SALES_NETWORK_ENV:'staging',SALES_NETWORK_STAGING_PROJECT_REF:'abcdefghijklmnopqrst',SALES_NETWORK_PRODUCTION_PROJECT_REF:'zzzzzzzzzzzzzzzzzzzz',NEXT_PUBLIC_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SALES_NETWORK_DEMO_ALLOW_HOST:'abcdefghijklmnopqrst.supabase.co',SUPABASE_SECRET_KEY:'test-only',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test-only'};
test('offline migration plan skips 00029 and emits valid psql meta commands',()=>{
 const r=spawnSync(process.execPath,['scripts/prepare-sales-network-staging.mjs']);assert.equal(r.status,0);
 const manifest=JSON.parse(readFileSync('tmp/sales-network-staging-plan/manifest.json','utf8'));
 assert.equal(manifest.baseline.length,30);assert.equal(manifest.network.length,6);assert.ok(!manifest.baseline.some(f=>f.includes('00029')));assert.ok(manifest.baseline.at(-1).includes('00030'));
 const plan=readFileSync('tmp/sales-network-staging-plan/baseline.psql','utf8');const slash=String.fromCharCode(92);
 assert.ok(plan.startsWith(slash+'set ON_ERROR_STOP on'));assert.deepEqual(plan.split('\n').filter(l=>l.startsWith(slash+'ir ')),[slash+'ir baseline-combined.sql']);
});
for(const [name,change,args] of [
 ['development',{SALES_NETWORK_ENV:'development'}],['production',{SALES_NETWORK_ENV:'production'}],['missing env',{SALES_NETWORK_ENV:''}],['wrong host',{SALES_NETWORK_DEMO_ALLOW_HOST:'other.supabase.co'}],['production ref',{SALES_NETWORK_PRODUCTION_PROJECT_REF:env.SALES_NETWORK_STAGING_PROJECT_REF}],['missing production ref',{SALES_NETWORK_PRODUCTION_PROJECT_REF:''}],['http',{NEXT_PUBLIC_SUPABASE_URL:'http://abcdefghijklmnopqrst.supabase.co'}],['localhost',{NEXT_PUBLIC_SUPABASE_URL:'http://localhost:54321'}],['missing flag',{},[]],['missing key',{SUPABASE_SECRET_KEY:''}],
])test(`staging guard refuses ${name}`,()=>{assert.throws(()=>stagingTarget('--allow-demo-seed',{...env,...change},args??['--allow-demo-seed']));});
test('staging guard requires dedicated reset flag',()=>{assert.throws(()=>stagingTarget('--allow-demo-reset',env,['--allow-demo-seed']));assert.equal(stagingTarget('--allow-demo-reset',env,['--allow-demo-reset']).host,env.SALES_NETWORK_DEMO_ALLOW_HOST);});
test('activation reset has its own staging-only flag and production/host rejection',()=>{
 const flag='--allow-demo-activation-reset';
 assert.throws(()=>stagingTarget(flag,env,['--allow-demo-reset']));
 for(const change of [{SALES_NETWORK_ENV:'production'},{SALES_NETWORK_PRODUCTION_PROJECT_REF:env.SALES_NETWORK_STAGING_PROJECT_REF},{SALES_NETWORK_DEMO_ALLOW_HOST:'production.supabase.co'}])assert.throws(()=>stagingTarget(flag,{...env,...change},[flag]));
 assert.equal(stagingTarget(flag,env,[flag]).ref,env.SALES_NETWORK_STAGING_PROJECT_REF);
});
test('ordinary users cannot be adopted as demo accounts',()=>{assert.throws(()=>assertDemoUser({email:demoEmails.hq,app_metadata:{}},'hq'));assert.throws(()=>assertDemoUser({email:'normal@example.test',app_metadata:{sales_network_demo:'staging-v1'}},'hq'));});
function fixture(change={}){
 const writes=[];const m={version:1,organization_id:'etm',users:{hq:'hq',dealer:'dealer'},opportunities:['opp'],goals:['goal'],announcements:['news']};
 const rows={organizations:[{id:'etm',slug:'etm'}],opportunities:[{id:'opp',title:'Textiles Vega',organization_id:'etm',created_by_user_id:'dealer'}],orders:[{id:'order',opportunity_id:'opp',organization_id:'etm',created_by_user_id:'dealer'}],order_documents:[{id:'doc',order_id:'order',organization_id:'etm',uploaded_by_user_id:'dealer',storage_path:'etm/order/file'}],sales_goals:[{id:'goal',organization_id:'etm',target_amount:300000}],network_announcements:[{id:'news',organization_id:'etm',created_by_user_id:'hq',title:'Nuevo lanzamiento Nahuitech'}],...change};
 const admin={auth:{admin:{getUserById:async id=>({data:{user:{id,email:demoEmails[id==='hq'?'hq':'dealer'],app_metadata:{sales_network_demo:'staging-v1'}}}})}},storage:{from:()=>({remove:async paths=>{writes.push({table:'storage',values:paths});return {data:[]};}})},from(table){let single=false,mutation=false;const filters=[];const q={select(){return q;},delete(){mutation=true;return q;},update(){mutation=true;return q;},eq(k,v){filters.push([k,[v]]);return q;},in(k,v){filters.push([k,v]);return q;},limit(){return q;},single(){single=true;return q;},then(resolve,reject){if(mutation){writes.push({table,filters});return Promise.resolve({data:[]}).then(resolve,reject);}const data=(rows[table]??[]).filter(r=>filters.every(([k,v])=>v.includes(r[k])));return Promise.resolve({data:single?data[0]:data}).then(resolve,reject);}};return q;}};
 return {admin,m,writes};
}
test('reset refuses cross-org order before deleting anything',async()=>{const {admin,m,writes}=fixture({orders:[{id:'order',opportunity_id:'opp',organization_id:'sisco',created_by_user_id:'dealer'}]});await assert.rejects(resetDemo(admin,m),/ownership/);assert.equal(writes.length,0);});
test('reset refuses foreign document path before deleting anything',async()=>{const {admin,m,writes}=fixture({order_documents:[{id:'doc',order_id:'order',organization_id:'etm',uploaded_by_user_id:'dealer',storage_path:'sisco/order/file'}]});await assert.rejects(resetDemo(admin,m),/path/);assert.equal(writes.length,0);});
test('reset refuses modified goal before deleting anything',async()=>{const {admin,m,writes}=fixture({sales_goals:[{id:'goal',organization_id:'etm',target_amount:900000}]});await assert.rejects(resetDemo(admin,m),/goal/);assert.equal(writes.length,0);});
test('reset deletes only scoped workflow, preserves catalog, quotes and identities',async()=>{const {admin,m,writes}=fixture();await resetDemo(admin,m);assert.ok(writes.some(w=>w.table==='orders'));assert.ok(writes.every(w=>!['quotes','customers','machines','profiles','salespeople','organization_memberships','network_devices'].includes(w.table)));assert.ok(writes.filter(w=>w.filters).every(w=>w.filters.length));assert.deepEqual(writes[0],{table:'storage',values:['etm/order/file']});});
test('observability emits only fixed safe fields in staging',()=>{
 const logs=[];const exports={};const process={env:{SALES_NETWORK_ENV:'staging',SALES_NETWORK_OBSERVABILITY:'true'}};
 vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/network/observability.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>({}),process,Date,console:{info:s=>logs.push(JSON.parse(s))}});
 exports.networkLog('activation',false,Date.now());assert.deepEqual(Object.keys(logs[0]),['scope','event','ok','duration_ms']);process.env.SALES_NETWORK_ENV='production';exports.networkLog('activation',true,Date.now());assert.equal(logs.length,1);
});
