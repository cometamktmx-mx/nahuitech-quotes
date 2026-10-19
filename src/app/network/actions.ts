"use server";
import { networkLog } from "@/lib/network/observability";
import { revalidatePath } from "next/cache";
import { requireNetwork } from "@/lib/network/server";
import type { ActionResult } from "@/components/network/action-form";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin.server";
import { networkError } from "@/lib/network/errors";

function fields(form:FormData){return Object.fromEntries([...form.entries()].filter(([,v])=>typeof v==="string"));}
export async function settingsAction(_state:ActionResult,form:FormData):Promise<ActionResult>{const {db}=await requireNetwork(true);const {error}=await db.rpc("network_settings",{p_org:String(form.get("organization_id")),p_action:String(form.get("action")),p_data:fields(form)});if(error)return {error:networkError(error)};revalidatePath("/network","layout");return {success:"Configuración guardada."};}
export async function createOrderAction(_state:ActionResult,form:FormData):Promise<ActionResult>{
 const started=Date.now();const {db}=await requireNetwork();const {data,error}=await db.rpc("network_create_order",{p_opportunity:String(form.get("opportunity_id"))});
 networkLog("order_transition",!error,started);
 if(error)return {error:networkError(error)};revalidatePath("/network","layout");redirect(`/network/orders/${data}`);
}
export async function orderAction(_state:ActionResult,form:FormData):Promise<ActionResult>{
 const started=Date.now();const {db}=await requireNetwork(true);const {error}=await db.rpc("network_order_action",{p_id:String(form.get("id")),p_action:String(form.get("action")),p_data:fields(form)});
 networkLog(["verify","reject"].includes(String(form.get("action")))?"payment_validation":"order_transition",!error,started);
 if(error)return {error:networkError(error)};revalidatePath("/network","layout");return {success:"Pedido actualizado y registrado en auditoría."};
}
export async function uploadDocumentAction(_state:ActionResult,form:FormData):Promise<ActionResult>{
 const started=Date.now();
 const {db,org,owner}=await requireNetwork();const orderId=String(form.get("order_id"));const file=form.get("file");
 if(!(file instanceof File)||file.size<1||file.size>8*1024*1024)return {error:"Selecciona un PDF, JPG o PNG de hasta 8 MB."};
 const {data:order}=await db.from("orders").select("id,organization_id,status").eq("id",orderId).single();
 if(!order||(!owner&&order.organization_id!==org))return {error:"Pedido no autorizado."};
 const bytes=Buffer.from(await file.arrayBuffer());
 const mime=bytes.subarray(0,5).toString()==="%PDF-"?"application/pdf":bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"image/png":bytes[0]===255&&bytes[1]===216&&bytes[2]===255?"image/jpeg":null;
 if(!mime||file.type!==mime)return {error:"El contenido no corresponde a un PDF, PNG o JPG válido."};
 const path=`${order.organization_id}/${order.id}/${randomUUID()}`;
 const admin=createSupabaseAdminClient();
 const {error:uploadError}=await admin.storage.from("sales-network-documents").upload(path,bytes,{contentType:mime,upsert:false});
 networkLog("document_upload",!uploadError,started);
 if(uploadError)return {error:"No se pudo guardar el archivo privado. Comprueba la configuración de Storage."};
 const {error}=await db.rpc("network_attach_document",{p_order:order.id,p_type:String(form.get("document_type")),p_path:path,p_name:file.name.replace(/[\x00-\x1f]/g,"").slice(0,250),p_mime:mime,p_size:file.size});
 if(["DEPOSIT_PROOF","BALANCE_PROOF"].includes(String(form.get("document_type"))))networkLog("payment_submit",!error,started);
 if(error){await admin.storage.from("sales-network-documents").remove([path]);return {error:networkError(error)};}
 revalidatePath("/network","layout");return {success:"Documento privado guardado y enviado a revisión cuando corresponde."};
}
export async function readNotificationAction(_state:ActionResult,form:FormData):Promise<ActionResult>{const {db}=await requireNetwork();const {error}=await db.rpc("network_read_notification",{p_id:String(form.get("id"))});if(error)return {error:networkError(error)};revalidatePath("/network","layout");return {success:"Leída por la organización."};}
export async function revokeDeviceAction(_state:ActionResult,form:FormData):Promise<ActionResult>{const {db}=await requireNetwork();const {error}=await db.rpc("network_revoke_device",{p_id:String(form.get("id"))});if(error)return {error:networkError(error)};revalidatePath("/network","layout");return {success:"Dispositivo revocado."};}
export async function opportunityAction(_state:ActionResult,form:FormData):Promise<ActionResult>{
 const {db,org,owner}=await requireNetwork();let opportunityOrg=org;
 if(form.get("id")){const {data:o}=await db.from("opportunities").select("organization_id").eq("id",String(form.get("id"))).single();if(!o||(!owner&&o.organization_id!==org))return {error:"Oportunidad no autorizada."};opportunityOrg=o.organization_id;}
 const {error}=await db.rpc("network_opportunity",{p_org:opportunityOrg,p_action:String(form.get("action")),p_id:form.get("id")||null,p_data:fields(form)});
 if(error) return {error:networkError(error)};
 revalidatePath("/network","layout");return {success:"Oportunidad actualizada."};
}
export async function taskAction(_state:ActionResult,form:FormData):Promise<ActionResult>{
 const {db,org,owner}=await requireNetwork();let taskOrg=org;
 if(form.get("id")){const {data:task}=await db.from("sales_tasks").select("organization_id").eq("id",String(form.get("id"))).single();if(!task||(!owner&&task.organization_id!==org))return {error:"Tarea no autorizada."};taskOrg=task.organization_id;}
 const {error}=await db.rpc("network_task",{p_org:taskOrg,p_id:form.get("id")||null,p_data:fields(form)});
 if(error)return {error:networkError(error)};revalidatePath("/network","layout");return {success:"Tarea actualizada."};
}
