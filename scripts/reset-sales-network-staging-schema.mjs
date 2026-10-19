// OFFLINE GENERATOR ONLY. Does not connect to Supabase or execute SQL.
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {stagingTarget} from './lib/sales-network-staging.mjs';
import {buildSchemaReset} from './lib/staging-schema-reset.mjs';
const {ref}=stagingTarget('--allow-staging-schema-reset');
const result=buildSchemaReset(ref,randomBytes(32).toString('hex'));
const dir='tmp/sales-network-staging-reset';mkdirSync(dir,{recursive:true});
for(const [name,text] of Object.entries({'01-manual-staging-authorization.sql':result.marker,'02-reset-staging-schema.sql':result.sql,'03-verify-clean.sql':result.verify}))writeFileSync(`${dir}/${name}`,text,'utf8');
console.log(`OFFLINE ONLY. Files generated in ${dir}. Verify SAME staging dashboard ref, stop app, read runbook, then execute 01 and 02 separately within 20 minutes. Never paste in production.`);
