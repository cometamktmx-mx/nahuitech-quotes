// Offline only. No shell concatenation, psql execution or network connection.
import {readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {buildStagingBaseline,sqlSource,hash,excludedMigration,sourceDirectory} from './lib/staging-baseline.mjs';
const out='tmp/sales-network-staging-plan';
mkdirSync(out,{recursive:true});
const baseline=buildStagingBaseline();
const network=readdirSync(sourceDirectory).filter(f=>/^2026101800003[1-6]_.*\.sql$/.test(f)).sort();
if(network.length!==6)throw Error('Unexpected Network inventory.');
const networkSql=network.map(f=>`-- SOURCE ${f}\n${sqlSource(f)}\n`).join('\n');
writeFileSync(`${out}/baseline-combined.sql`,baseline.sql,'utf8');
writeFileSync(`${out}/network-combined.sql`,networkSql,'utf8');
const slash=String.fromCharCode(92);
for(const name of ['baseline','network'])writeFileSync(`${out}/${name}.psql`,`${slash}set ON_ERROR_STOP on\n${slash}ir ${name}-combined.sql\n`,'utf8');
writeFileSync(`${out}/manifest.json`,JSON.stringify({encoding:'UTF-8 without BOM',skipped:excludedMigration,baseline:baseline.files,network,stagingIdentities:baseline.identities,stagingDisplayOrder:baseline.displayOrder,sha256:Object.fromEntries([...baseline.files,...network].map(f=>[f,hash(sqlSource(f))])),artifacts:{'baseline-combined.sql':hash(baseline.sql),'network-combined.sql':hash(networkSql)}},null,2),'utf8');
console.log(`STAGING ONLY: commercial bootstrap + separate Network SQL generated in ${out}. 00029 excluded. No remote action.`);
