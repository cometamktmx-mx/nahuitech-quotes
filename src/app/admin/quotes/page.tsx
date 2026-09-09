/* eslint-disable @typescript-eslint/no-explicit-any */
import { AdminNav } from "@/components/admin-nav";
import { AdminQuotesInbox } from "@/components/admin-quotes-inbox";
import { requireRole } from "@/lib/auth/require-role";
import { asCatalogNumber } from "@/lib/seller-catalog";
import { createClient } from "@/lib/supabase/server";
export default async function AdminQuotesPage(){
 const profile=await requireRole("admin"); const supabase=await createClient();
 const {data:quotes,error}=await supabase.from("quotes").select("id,folio,customer_id,salesperson_name_snapshot,machine_name_snapshot,total,created_at").order("created_at",{ascending:false}); if(error)throw new Error("No se pudieron cargar las cotizaciones.");
 const ids=(quotes??[]).map(q=>q.id); const customerIds=(quotes??[]).map(q=>q.customer_id);
 const [{data:customers},{data:messages},{data:tokens},{data:items}]=await Promise.all([customerIds.length?supabase.from("customers").select("id,name,whatsapp").in("id",customerIds):Promise.resolve({data:[]} as never),ids.length?supabase.from("whatsapp_messages").select("quote_id,status,delivery_method,error_message,customer_whatsapp_snapshot").in("quote_id",ids):Promise.resolve({data:[]} as never),ids.length?supabase.from("quote_delivery_tokens").select("quote_id,expires_at").in("quote_id",ids):Promise.resolve({data:[]} as never),ids.length?supabase.from("quote_items").select("quote_id").in("quote_id",ids):Promise.resolve({data:[]} as never)]);
 const customerMap=new Map((customers??[]).map((c:any)=>[c.id,c])); const messageMap=new Map((messages??[]).map((m:any)=>[m.quote_id,m])); const tokenMap=new Map((tokens??[]).map((t:any)=>[t.quote_id,t])); const itemCounts=new Map<string,number>(); (items??[]).forEach((i:any)=>itemCounts.set(i.quote_id,(itemCounts.get(i.quote_id)??0)+1));
 const rows=(quotes??[]).map(q=>{const c=customerMap.get(q.customer_id);const m=messageMap.get(q.id);const t=tokenMap.get(q.id);const status=m?.status??(t&&new Date(t.expires_at)>new Date()?"WAITING_FOR_CUSTOMER":"NO_ENVIADA");return{id:q.id,folio:q.folio,customer:c?.name??"Cliente",phone:m?.customer_whatsapp_snapshot??c?.whatsapp??"—",seller:q.salesperson_name_snapshot??"Vendedor",createdAt:q.created_at,machine:q.machine_name_snapshot,items:itemCounts.get(q.id)??1,total:asCatalogNumber(q.total),status,method:m?.delivery_method??"NONE",error:m?.error_message??null};});
 return <div className="min-h-screen bg-background"><AdminNav active="quotes" userName={profile.full_name}/><main className="mx-auto grid max-w-7xl gap-8 px-5 py-8 md:px-8 md:py-12"><header><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Comercial</p><h1 className="mt-3 text-3xl font-black text-foreground sm:text-4xl">Cotizaciones</h1><p className="mt-3 text-base leading-7 text-muted">Bandeja operativa de seguimiento y rescate.</p></header><AdminQuotesInbox rows={rows}/></main></div>;
}
