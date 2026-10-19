import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
function load(path,modules={}){
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{if(name in modules)return modules[name];throw Error('Unexpected import '+name);},process:{env:{NODE_ENV:'test'}},Date,FormData});return exports;
}
const entry=load('src/lib/network/entry.ts');
const hq={organization_id:'hq',network_role:'NETWORK_OWNER',organizations:{name:'NAHUITECH',slug:'nahuitech',organization_type:'MANUFACTURER',status:'ACTIVE'}};
const etm={organization_id:'etm',network_role:'SELLER',organizations:{name:'ETM',slug:'etm',organization_type:'DEALER',status:'ACTIVE'}};
function fixture(members=[],initialCookies={},access=false){
 const jar=new Map(Object.entries(initialCookies));const calls=[];let result={data:{status:'OK',organization_id:'etm'}};
 const db={rpc:async(name,args)=>{calls.push({name,args});if(name==='network_access')return {data:access};if(name==='network_activate_result')return result;return {data:null,error:result.error};}};
 const server={networkSession:async()=>({db,user:{id:'u'},profile:{full_name:'Demo'}}),activeNetworkMemberships:async()=>({data:members}),requireNetwork:async()=>({db})};
 const modules={'@/lib/network/server':server,'@/lib/network/entry':entry,'@/lib/network/observability':{networkLog(){}},'node:crypto':crypto,'next/headers':{cookies:async()=>({get:k=>jar.has(k)?{value:jar.get(k)}:undefined,set:(k,v)=>jar.set(k,v)})},'next/navigation':{redirect:path=>{throw Error('redirect:'+path);}}};
 const actions=load('src/app/network/activation-actions.ts',modules);
 const page=load('src/app/network/activate/page.tsx',{...modules,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'next/link':{default:'link'},'@/lib/network/errors':{activationMessages:{INVALID:'El código no es válido',REVOKED:'Dispositivo revocado'}},'@/components/network/automatic-entry':{AutomaticNetworkEntry:'auto-entry'},'../activation-actions':actions,'../network.css':{}}).default;
 return {page,actions,jar,calls,setResult:r=>{result=r;}};
}
const form=values=>{const f=new FormData();Object.entries(values).forEach(([k,v])=>f.set(k,v));return f;};
test('HQ first entry has no activation form and automatically registers device then redirects to HQ',async()=>{
 const f=fixture([hq]);const page=JSON.stringify(await f.page({searchParams:Promise.resolve({})}));
 assert.ok(page.includes('auto-entry'));assert.ok(!page.includes('Código de distribuidor'));assert.ok(page.includes('"automatic":true'));
 await assert.rejects(f.actions.selectNetworkOrganization(form({organization_id:'hq'})),/redirect:\/network\/hq$/);
 assert.equal(f.jar.get('network_org'),'hq');assert.ok(f.jar.get('network_device'));assert.deepEqual(f.calls.map(c=>c.name),['network_register_device']);
});
test('HQ manual /activate visit with validated context redirects directly to HQ',async()=>{
 const f=fixture([hq],{network_org:'hq',network_device:'existing'},true);await assert.rejects(f.page({searchParams:Promise.resolve({})}),/redirect:\/network\/hq$/);
});
test('existing members cannot consume a dealer code through the action either',async()=>{
 const f=fixture([hq]);await assert.rejects(f.actions.validateDealerActivationCode(form({code:'anything'})),/redirect:\/network\/activate$/);assert.equal(f.calls.length,0);
});
test('ETM unactivated sees code; invalid code is clear; valid code records context and redirects',async()=>{
 const f=fixture();assert.ok(JSON.stringify(await f.page({searchParams:Promise.resolve({})})).includes('Código de distribuidor'));
 f.setResult({data:{status:'INVALID'}});await assert.rejects(f.actions.validateDealerActivationCode(form({code:'wrong'})),/error=INVALID/);assert.equal(f.jar.size,0);
 assert.ok(JSON.stringify(await f.page({searchParams:Promise.resolve({error:'INVALID'})})).includes('El código no es válido'));
 f.setResult({data:{status:'OK',organization_id:'etm'}});await assert.rejects(f.actions.validateDealerActivationCode(form({code:'valid'})),/redirect:\/network$/);assert.equal(f.jar.get('network_org'),'etm');
 assert.equal(f.calls[1].args.p_hash,crypto.createHash('sha256').update('valid').digest('hex'));
});
test('ETM returning login does not request another code, with or without retained cookies',async()=>{
 const f=fixture([etm],{network_org:'etm'},true);await assert.rejects(f.page({searchParams:Promise.resolve({})}),/redirect:\/network$/);
 const fresh=fixture([etm]);assert.ok(!JSON.stringify(await fresh.page({searchParams:Promise.resolve({})})).includes('Código de distribuidor'));
 await assert.rejects(fresh.actions.selectNetworkOrganization(form({organization_id:'etm'})),/redirect:\/network$/);assert.equal(fresh.calls[0].name,'network_register_device');
});
test('multi-org selects organization and never shows dealer code',async()=>{
 const f=fixture([hq,etm]);const page=JSON.stringify(await f.page({searchParams:Promise.resolve({})}));assert.ok(page.includes('Selecciona una organización'));assert.ok(!page.includes('Código de distribuidor'));assert.ok(!page.includes('auto-entry'));
 await assert.rejects(f.actions.selectNetworkOrganization(form({organization_id:'sisco'})),/error=INACTIVE/);assert.equal(f.calls.length,0);
});
test('revoked registration does not persist context and error page does not auto-retry',async()=>{
 const f=fixture([etm]);f.setResult({error:{message:'Dispositivo revocado'}});await assert.rejects(f.actions.selectNetworkOrganization(form({organization_id:'etm'})),/error=REVOKED/);assert.equal(f.jar.size,0);
 assert.ok(JSON.stringify(await f.page({searchParams:Promise.resolve({error:'REVOKED'})})).includes('"automatic":false'));
});
test('workspace guard rejects missing membership even with stale selection cookies',async()=>{
 const jar=new Map([['network_org','etm'],['network_device','old']]);
 const query={select(){return this;},eq(){return this;},single:async()=>({data:{id:'u',active:true}}),then(resolve){return Promise.resolve({data:[]}).then(resolve);}};
 const db={auth:{getUser:async()=>({data:{user:{id:'u'}}})},from:()=>query,rpc:async()=>({data:false})};
 const server=load('src/lib/network/server.ts',{'server-only':{},'@supabase/ssr':{createServerClient:()=>db},'next/headers':{cookies:async()=>({get:k=>jar.has(k)?{value:jar.get(k)}:undefined,getAll:()=>[]})},'next/navigation':{redirect:path=>{throw Error('redirect:'+path);}},react:{cache:f=>f}});
 await assert.rejects(server.requireNetwork(),/redirect:\/network\/activate$/);
 jar.clear();await assert.rejects(server.requireNetwork(),/redirect:\/network\/activate$/);
});
