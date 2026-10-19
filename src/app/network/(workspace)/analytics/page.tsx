import { requireNetwork } from "@/lib/network/server";
import { InsightsPanel } from "@/components/network/insights";
export default async function Analytics(){const {db,org}=await requireNetwork();const {data,error}=await db.rpc("network_insights",{p_org:org});if(error)throw new Error(error.message);return <><h1>Sales Analytics</h1><p className="net-muted">Datos de tu organización. Agregaciones internas, sin predicciones ni scores artificiales.</p><InsightsPanel data={data}/></>}
