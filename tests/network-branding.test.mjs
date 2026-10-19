import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/network/quote-branding.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
test('legacy and direct manufacturer PDF snapshots do not enable dealer co-branding',()=>{
 assert.equal(exports.quoteBranding({}),undefined);assert.equal(exports.quoteBranding({organization_branding_snapshot:{type:'MANUFACTURER',name:'Nahuitech'}}),undefined);
});
test('dealer PDF consumes only persisted identity/contact snapshots',()=>{
 const q={organization_branding_snapshot:{type:'DEALER',name:'Original ETM',logo_url:'https://storage.example.invalid/version.png',label:'Distribuidor autorizado de Nahuitech',footer:'Condiciones capturadas'},salesperson_phone_snapshot:'5555555555',salesperson_email_snapshot:'demo@example.invalid'};
 const brand=exports.quoteBranding(q);assert.equal(brand.name,'Original ETM');assert.equal(brand.sellerPhone,'5555555555');assert.equal(brand.logoUrl,q.organization_branding_snapshot.logo_url);
 assert.equal(brand.footer,'Condiciones capturadas');
});
