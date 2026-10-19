"use server";
import {randomUUID} from "node:crypto";
import sharp from "sharp";
import {revalidatePath} from "next/cache";
import {requireNetwork} from "@/lib/network/server";
import {createSupabaseAdminClient} from "@/lib/supabase/admin.server";
import {networkError} from "@/lib/network/errors";
import type {ActionResult} from "@/components/network/action-form";
export async function brandingAction(_state:ActionResult,form:FormData):Promise<ActionResult>{
 const {db,org}=await requireNetwork();const target=String(form.get("organization_id")||org);
 const {data:allowed,error:accessError}=await db.rpc("network_manage_organization",{p_org:target});
 if(accessError||!allowed)return {error:"No tienes permiso para configurar esta organización."};
 const data=Object.fromEntries([...form.entries()].filter(([k,v])=>typeof v==="string"&&!['organization_id','logo_url'].includes(k)));
 const file=form.get("logo");let uploaded:string|undefined;
 if(file instanceof File&&file.size){
  if(file.size>2*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))return {error:"Logo PNG, JPG o WebP de hasta 2 MB."};
  let bytes:Buffer;try{bytes=await sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:16_000_000}).resize({width:1000,height:1000,fit:'inside',withoutEnlargement:true}).png().toBuffer();}catch{return {error:"La imagen no es válida."};}
  uploaded=`${target}/${randomUUID()}.png`;const storage=createSupabaseAdminClient().storage.from('network-branding');const {error}=await storage.upload(uploaded,bytes,{contentType:'image/png',upsert:false});if(error)return {error:"No se pudo subir el logo."};
  data.logo_url=storage.getPublicUrl(uploaded).data.publicUrl;
 }
 const {error}=await db.rpc('network_branding',{p_org:target,p_data:data});
 if(error){if(uploaded)await createSupabaseAdminClient().storage.from('network-branding').remove([uploaded]);return {error:networkError(error)};}
 revalidatePath('/network','layout');return {success:'Identidad guardada. Las cotizaciones anteriores conservan su identidad original.'};
}
export async function teamAction(_state:ActionResult,form:FormData):Promise<ActionResult>{
 const {db,org}=await requireNetwork();const data=Object.fromEntries(form.entries());
 const {error}=await db.rpc('network_team',{p_org:String(form.get('organization_id')||org),p_kind:String(form.get('kind')),p_id:form.get('id')||null,p_data:data});
 if(error)return {error:networkError(error)};revalidatePath('/network','layout');return {success:'Registro guardado.'};
}
