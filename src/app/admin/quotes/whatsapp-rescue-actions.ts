"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseAdminClient } from "@/lib/supabase/admin.server";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp/phone";
export async function markWhatsAppManual(quoteId:string){
  await requireRole("admin"); const auth=await (await import("@/lib/supabase/server")).createClient(); const claims=await auth.auth.getClaims(); const userId=typeof claims.data?.claims.sub === "string" ? claims.data.claims.sub : null; const admin=createSupabaseAdminClient();
  const result=await admin.from("whatsapp_messages").update({status:"MANUAL_SENT",delivery_method:"MANUAL",manual_sent_at:new Date().toISOString(),manual_sent_by_user_id:userId,error_code:null,error_message:null}).eq("quote_id",quoteId).in("status",["PENDING","FAILED","SENDING"]).select("quote_id").maybeSingle();
  if(result.error||!result.data) throw new Error("No se pudo marcar el envío manual.");
  revalidatePath("/admin/quotes"); revalidatePath(`/admin/quotes/${quoteId}`); return {ok:true};
}
export async function getManualWhatsAppLink(quoteId:string){
  await requireRole("admin"); const admin=createSupabaseAdminClient();
  const q=await admin.from("quotes").select("customer_id").eq("id",quoteId).single(); if(q.error) throw new Error("Cotización no encontrada.");
  const c=await admin.from("customers").select("name,whatsapp").eq("id",q.data.customer_id).single(); if(c.error) throw new Error("Cliente no encontrado.");
  const phone=normalizeWhatsAppPhone(c.data.whatsapp).e164.replace(/^\+/,"");
  const text="Hola "+c.data.name+", te compartimos tu cotización de Nahuitech. Para cualquier ajuste o atención directa, estamos a tus órdenes.";
  return "https://wa.me/"+phone+"?text="+encodeURIComponent(text);
}
