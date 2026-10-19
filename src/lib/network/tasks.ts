import "server-only";
import { networkLog } from "./observability";
import type { SupabaseClient } from "@supabase/supabase-js";
// Rules, including BALANCE_REQUEST_DAYS_BEFORE_COMPLETION, live in PostgreSQL.
// This adapter can later be called by an authorized scheduler.
export async function refreshSalesNetworkTasks(db:SupabaseClient,organizationId:string|null){
 const started=Date.now();
 const {error}=organizationId===null?await db.rpc("network_refresh_all_tasks"):await db.rpc("refresh_sales_network_tasks",{p_org:organizationId});
 networkLog("task_automation",!error,started);
 if(error)throw new Error("No se pudo actualizar el seguimiento de ventas.");
}
