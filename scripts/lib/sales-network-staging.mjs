import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
export function stagingTarget(flag,env=process.env,args=process.argv){
 if(!args.includes(flag))throw Error(`Explicit ${flag} required.`);
 if(env.SALES_NETWORK_ENV!=='staging')throw Error('STAGING ONLY: SALES_NETWORK_ENV must equal staging.');
 const ref=env.SALES_NETWORK_STAGING_PROJECT_REF,prod=env.SALES_NETWORK_PRODUCTION_PROJECT_REF;
 if(!/^[a-z0-9]{20}$/.test(ref??'')||!/^[a-z0-9]{20}$/.test(prod??'')||ref===prod)throw Error('Distinct staging and production project refs are required (non-secret identifiers).');
 const url=new URL(env.NEXT_PUBLIC_SUPABASE_URL??'');
 const host=`${ref}.supabase.co`;
 if(url.origin!==`https://${host}`||url.username||url.password||url.search||url.hash||url.pathname!=='/'||env.SALES_NETWORK_DEMO_ALLOW_HOST!==host)throw Error('STAGING ONLY: URL, staging project ref and allow host must match exactly.');
 if(!env.SUPABASE_SECRET_KEY||!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)throw Error('Staging secret and publishable keys are required.');
 // Also reject the repository default project's URL, without displaying its values.
 if(existsSync('.env.local')){
  const match=readFileSync('.env.local','utf8').match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^\s"']+)/m);
  if(match&&new URL(match[1]).hostname===host)throw Error('Target matches .env.local. Use an isolated staging project, not the default environment.');
 }
 console.log(`STAGING ONLY | project=${ref} | host=${host} | ${flag}`);
 return {url:url.origin,host,ref,secret:env.SUPABASE_SECRET_KEY};
}
export const demoEmails={hq:'network-hq-demo@example.invalid',dealer:'network-etm-demo@example.invalid'};
export function assertDemoUser(user,kind){
 if(!user||user.email!==demoEmails[kind]||user.app_metadata?.sales_network_demo!=='staging-v1')throw Error('Identity is not a seed-owned staging demo user. Refusing mutation.');
}
export const manifestPath=ref=>`tmp/sales-network-demo-${ref}.json`;
export function readManifest(ref){const p=manifestPath(ref);return existsSync(p)?JSON.parse(readFileSync(p,'utf8')):null;}
export function saveManifest(ref,data){mkdirSync('tmp',{recursive:true});const p=manifestPath(ref);writeFileSync(p+'.tmp',JSON.stringify(data,null,2));renameSync(p+'.tmp',p);}
export function unwrap(r){if(r.error)throw Error(`Staging operation failed (${r.error.code??'service'}). Check the staging service logs; no payload logged.`);return r.data;}
