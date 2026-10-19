import {createHash,randomBytes} from 'node:crypto';
import {assertDemoUser,unwrap} from './sales-network-staging.mjs';

export async function resetDemoActivation(admin,m){
 if(m?.version!==1||!m.organization_id||!m.users?.dealer||!m.users?.hq)throw Error('Matching seed manifest required. No writes made.');
 for(const kind of ['hq','dealer'])assertDemoUser(unwrap(await admin.auth.admin.getUserById(m.users[kind])).user,kind);
 const org=unwrap(await admin.from('organizations').select('id,slug').eq('id',m.organization_id).single());
 if(org?.slug!=='etm')throw Error('Only ETM demo activation can be reset.');
 const memberships=unwrap(await admin.from('organization_memberships').select('*').eq('user_id',m.users.dealer));
 if(memberships.some(x=>x.organization_id!==org.id||x.network_role!=='SELLER'))throw Error('Unexpected demo membership; no writes made.');
 const codes=unwrap(await admin.from('dealer_activation_codes').select('*').eq('organization_id',org.id).eq('created_by_user_id',m.users.hq).order('created_at',{ascending:false}).limit(100));
 const target=m.activation_code_id?codes.find(c=>c.id===m.activation_code_id):codes[0];
 if(m.activation_code_id&&!target)throw Error('Activation code ownership mismatch; no writes made.');
 // Old seed manifests did not record code IDs. Only accept a code issued by the
 // verified, dedicated demo HQ to ETM; never reset codes belonging to normal HQ.
 const code=randomBytes(32).toString('hex');
 const payload={code_hash:createHash('sha256').update(code).digest('hex'),active:true,use_count:0,max_uses:20,expires_at:new Date(Date.now()+7*86400000).toISOString()};
 const result=target
  ?unwrap(await admin.from('dealer_activation_codes').update(payload).eq('id',target.id).eq('organization_id',org.id).eq('created_by_user_id',m.users.hq).select('id').single())
  :unwrap(await admin.from('dealer_activation_codes').insert({...payload,organization_id:org.id,created_by_user_id:m.users.hq}).select('id').single());
 // REST operations are retryable, not atomic. Stop all demo browsers first.
 unwrap(await admin.from('network_devices').delete().eq('organization_id',org.id).eq('user_id',m.users.dealer));
 unwrap(await admin.from('organization_memberships').delete().eq('organization_id',org.id).eq('user_id',m.users.dealer).eq('network_role','SELLER'));
 unwrap(await admin.from('network_activation_attempts').delete().eq('user_id',m.users.dealer));
 return {code,activation_code_id:result.id};
}
