import { requireNetwork } from "@/lib/network/server";
import { OrderList } from "@/components/network/orders";
export default async function HqOrders(){const {db}=await requireNetwork(true);const {data,error}=await db.from("orders").select("id,folio,status,dealer_order_total,customer_quote_total_snapshot,estimated_completion_date").order("created_at",{ascending:false}).limit(200);if(error)throw new Error(error.message);return <><p className="net-muted">NAHUITECH HQ · ÚLTIMOS 200 PEDIDOS</p><h1>Operación de la red</h1><OrderList orders={data??[]}/></>}
