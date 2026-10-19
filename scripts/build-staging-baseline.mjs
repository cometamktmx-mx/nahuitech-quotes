// Offline generation only. No database connection.
import {mkdirSync,writeFileSync} from 'node:fs';
import {buildStagingBaseline} from './lib/staging-baseline.mjs';
const out='tmp/sales-network-staging-plan';mkdirSync(out,{recursive:true});
writeFileSync(`${out}/baseline-combined.sql`,buildStagingBaseline().sql,'utf8');
console.log(`STAGING ONLY: UTF-8 commercial bootstrap generated at ${out}/baseline-combined.sql. No remote operation.`);
