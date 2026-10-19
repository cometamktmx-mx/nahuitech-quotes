import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
function load(path,mocks){const exports={};const js=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;vm.runInNewContext(js,{exports,require:name=>{if(name==='@/lib/network/observability')return {networkLog(){}};if(!(name in mocks))throw new Error(`Unexpected dependency ${name}`);return mocks[name];},Response,File,Buffer,FormData,process:{env:{NODE_ENV:'test'}}});return exports;}
test('private download cannot sign an RLS-denied document',async()=>{
 let signatures=0;const builder={select(){return this;},eq(){return this;},async single(){return {data:null};}};
 const route=load('src/app/network/documents/[id]/route.ts',{'@/lib/network/server':{requireNetwork:async()=>({db:{from:()=>builder}})},'@/lib/supabase/admin.server':{createSupabaseAdminClient:()=>{signatures++;throw new Error('Must not sign');}}});
 const result=await route.GET(null,{params:Promise.resolve({id:crypto.randomUUID()})});assert.equal(result.status,404);assert.equal(signatures,0);
});
for(const scenario of ['empty','oversize','mime','signature','cross-org','PDF','JPG','PNG'])test(`document upload boundary: ${scenario}`,async()=>{
 let uploaded=0,attached=0;
 const builder={select(){return this;},eq(){return this;},async single(){return {data:{id:'order',organization_id:scenario==='cross-org'?'sisco':'etm'}};}};
 const actions=load('src/app/network/actions.ts',{
  'node:crypto':crypto,'next/cache':{revalidatePath(){}},'next/navigation':{redirect(){throw Error('Unexpected redirect');}},
  '@/lib/network/errors':{networkError:e=>e.message},
  '@/lib/network/server':{requireNetwork:async()=>({org:'etm',owner:false,db:{from:()=>builder,rpc:async()=>{attached++;return {error:null};}}})},
  '@/lib/supabase/admin.server':{createSupabaseAdminClient:()=>({storage:{from:()=>({upload:async()=>{uploaded++;return {error:null};}})}})}
 });
 const bytes=scenario==='oversize'?Buffer.alloc(8*1024*1024+1):scenario==='empty'?Buffer.alloc(0):scenario==='signature'?Buffer.from('fake'):scenario==='JPG'?Buffer.from([255,216,255,0]):scenario==='PNG'?Buffer.from([137,80,78,71,13,10,26,10]):Buffer.from('%PDF-1.7');
 const type=scenario==='mime'?'text/plain':scenario==='JPG'?'image/jpeg':scenario==='PNG'?'image/png':'application/pdf';
 const form=new FormData();form.set('order_id','order');form.set('document_type','PURCHASE_ORDER');form.set('file',new File([bytes],'sample',{type}));
 const result=await actions.uploadDocumentAction({},form);const valid=['PDF','JPG','PNG'].includes(scenario);
 assert.equal(!!result.success,valid);assert.equal(uploaded,valid?1:0);assert.equal(attached,valid?1:0);if(!valid)assert.ok(result.error);
});
test('demo seed refuses execution without explicit opt-in before any network operation',()=>{
 const result=spawnSync(process.execPath,['scripts/seed-sales-network-demo.mjs'],{encoding:'utf8',env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_SECRET_KEY:'test',SALES_NETWORK_DEMO_PASSWORD:'test-password-12345',SALES_NETWORK_ENV:'development'}});
 assert.notEqual(result.status,0);assert.match(result.stderr,/--allow-demo-seed/);
});
test('private download authorizes first and returns a short-lived no-store signed URL',async()=>{
 const path='org/order/random';let signed;const builder={select(){return this;},eq(){return this;},async single(){return {data:{storage_path:path,original_filename:'proof.pdf'}};}};
 const route=load('src/app/network/documents/[id]/route.ts',{'@/lib/network/server':{requireNetwork:async()=>({db:{from:()=>builder}})},'@/lib/supabase/admin.server':{createSupabaseAdminClient:()=>({storage:{from:bucket=>({createSignedUrl:async(p,ttl)=>{signed={bucket,p,ttl};return {data:{signedUrl:'https://storage.example.test/signed'}};}})}})}});
 const result=await route.GET(null,{params:Promise.resolve({id:crypto.randomUUID()})});assert.equal(result.status,303);assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(signed,{bucket:'sales-network-documents',p:path,ttl:60});
});
test('activation action hashes plaintext, requires existing session and only persists network selection',async()=>{
 let params;const cookies=[];let sessions=0;
 const actions=load('src/app/network/activation-actions.ts',{'@/lib/network/entry':load('src/lib/network/entry.ts',{}),'node:crypto':crypto,'next/headers':{cookies:async()=>({get:()=>undefined,set:(...args)=>cookies.push(args)})},'next/navigation':{redirect:path=>{throw new Error(`REDIRECT:${path}`);}},'@/lib/network/server':{activeNetworkMemberships:async()=>({data:[]}),networkSession:async()=>{sessions++;return {user:{id:'user'},db:{rpc:async(name,args)=>{assert.equal(name,'network_activate_result');params=args;return {data:{status:'OK',organization_id:'org-uuid'}};}}};},requireNetwork:async()=>{throw new Error('Unused');}}});
 const form=new FormData();form.set('code','test-secret');form.set('device_name','test');await assert.rejects(actions.validateDealerActivationCode(form),/REDIRECT:\/network$/);
 assert.equal(sessions,1);assert.equal(params.p_hash,crypto.createHash('sha256').update('test-secret').digest('hex'));assert.ok(!JSON.stringify(params).includes('test-secret'));assert.deepEqual(cookies.map(c=>c[0]),['network_org','network_device']);assert.ok(cookies.every(c=>c[2].httpOnly));
});
