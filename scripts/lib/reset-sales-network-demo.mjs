import {assertDemoUser,unwrap} from './sales-network-staging.mjs';
export async function resetDemo(admin,m){
 if(m?.version!==1||!m.organization_id||!m.users?.hq||!m.users?.dealer||!Array.isArray(m.opportunities))throw Error('Complete seed manifest required. No writes made.');
 for(const kind of ['hq','dealer'])assertDemoUser(unwrap(await admin.auth.admin.getUserById(m.users[kind])).user,kind);
 const org=unwrap(await admin.from('organizations').select('id,slug').eq('id',m.organization_id).single());
 if(org?.slug!=='etm')throw Error('Manifest must refer to ETM.');
 const list=async(table,column,ids)=>{
  if(!ids.length)return [];
  const rows=unwrap(await admin.from(table).select('*').in(column,ids).limit(1000));
  if(rows.length>=1000)throw Error('Demo reset safety limit reached; no deletion started.');return rows;
 };
 const opps=await list('opportunities','id',m.opportunities);
 const titles=['Textiles Vega','Grupo Industrial León','Confecciones del Bajío'];
 if(opps.some(o=>o.organization_id!==org.id||o.created_by_user_id!==m.users.dealer||!titles.includes(o.title)))throw Error('Opportunity ownership mismatch.');
 const orders=await list('orders','opportunity_id',m.opportunities);
 if(orders.some(o=>o.organization_id!==org.id||o.created_by_user_id!==m.users.dealer))throw Error('Order ownership mismatch.');
 const ids=orders.map(o=>o.id),entities=[...m.opportunities,...ids];
 const docs=await list('order_documents','order_id',ids);
 if(docs.some(d=>d.organization_id!==org.id||!Object.values(m.users).includes(d.uploaded_by_user_id)||!d.storage_path.startsWith(`${org.id}/${d.order_id}/`)||d.storage_path.includes('..')))throw Error('Document ownership/path mismatch.');
 const activities=await list('opportunity_activities','opportunity_id',m.opportunities);
 if(activities.some(a=>!Object.values(m.users).includes(a.created_by_user_id)))throw Error('Non-demo actor contributed activity; reset refused.');
 const goals=await list('sales_goals','id',m.goals??[]),news=await list('network_announcements','id',m.announcements??[]);
 if(goals.some(g=>g.organization_id!==org.id||g.user_id||g.salesperson_id||Number(g.target_amount)!==300000)||news.some(n=>n.organization_id!==org.id||n.created_by_user_id!==m.users.hq||n.title!=='Nuevo lanzamiento Nahuitech'))throw Error('Demo goal/announcement no longer matches manifest.');
 // All ownership checks precede the first deletion. REST steps are retryable, not atomic.
 console.log(`STAGING ONLY reset | opportunities=${opps.length} orders=${ids.length} documents=${docs.length}`);
 if(docs.length)unwrap(await admin.storage.from('sales-network-documents').remove(docs.map(d=>d.storage_path)));
 const del=async(table,column,values)=>{if(values.length)unwrap(await admin.from(table).delete().in(column,values));};
 await del('order_documents','id',docs.map(d=>d.id));
 await del('sales_tasks','order_id',ids);await del('sales_tasks','opportunity_id',m.opportunities);
 await del('order_payment_milestones','order_id',ids);
 await del('network_notifications','source_id',entities);
 await del('network_audit_log','entity_id',entities);
 await del('orders','id',ids);await del('opportunity_activities','opportunity_id',m.opportunities);
 await del('opportunities','id',m.opportunities);
 await del('sales_goals','id',goals.map(g=>g.id));await del('network_announcements','id',news.map(n=>n.id));
 // Keep Auth identities, memberships, devices, commercial quotes/customers and catalog.
 // Codes issued by the dedicated demo HQ are disabled, never printed or reactivated.
 unwrap(await admin.from('dealer_activation_codes').update({active:false}).eq('created_by_user_id',m.users.hq).eq('organization_id',org.id));
 return {opportunities:[],goals:[],announcements:[]};
}
