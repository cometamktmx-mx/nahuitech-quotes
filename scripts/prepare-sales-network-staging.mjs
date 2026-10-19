// Offline only: emits an explicit psql plan. Never connects to any database.
import {readdirSync,readFileSync,mkdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='supabase/migrations',out='tmp/sales-network-staging-plan';
mkdirSync(out,{recursive:true});
const all=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
const skipped='20260922000029_admin_quote_access.sql';
const baseline=all.filter(f=>f<'20261018000031'&&f!==skipped);
const network=all.filter(f=>/^2026101800003[1-6]_/.test(f));
if(baseline.length!==30||network.length!==6)throw Error('Unexpected migration inventory. Review plan manually.');
for(const f of [...baseline,...network])copyFileSync(`${dir}/${f}`,`${out}/${f}`);
const slash=String.fromCharCode(92);
for(const [name,files] of [['baseline',baseline],['network',network]])writeFileSync(`${out}/${name}.psql`,[`${slash}set ON_ERROR_STOP on`,...files.map(f=>`${slash}echo Applying ${f}\n${slash}ir ${f}`)].join('\n')+'\n');
writeFileSync(`${out}/manifest.json`,JSON.stringify({skipped,reason:'00029 rolled back; 00030 independently replaces the exact five signatures.',baseline,network,sha256:Object.fromEntries([...baseline,...network].map(f=>[f,createHash('sha256').update(readFileSync(`${dir}/${f}`)).digest('hex')]))},null,2));
console.log(`Offline plans ready in ${out}. No remote action. Baseline 00000–00028 + 00030; network 00031–00036.`);
