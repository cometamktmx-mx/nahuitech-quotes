import { requireNetwork } from "@/lib/network/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin.server";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {db}=await requireNetwork();const {id}=await params;
 const {data:doc}=await db.from("order_documents").select("storage_path,original_filename").eq("id",id).single();
 if(!doc)return new Response("Documento no disponible",{status:404});
 // Authorize through the user's RLS-bound PostgREST session before server signing.
 // Storage does not need to propagate the network device header to PostgreSQL.
 const {data,error}=await createSupabaseAdminClient().storage.from("sales-network-documents").createSignedUrl(doc.storage_path,60);
 if(error||!data)return new Response("No se pudo abrir el documento",{status:403});
 return new Response(null,{status:303,headers:{Location:data.signedUrl,"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
}
