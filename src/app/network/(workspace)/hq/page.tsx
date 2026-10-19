import { refreshSalesNetworkTasks } from "@/lib/network/tasks";
import Link from "next/link";
import { requireNetwork } from "@/lib/network/server";
import { money,date } from "@/lib/network/display";
import { TaskList } from "@/components/network/tasks";
import { ActionForm } from "@/components/network/action-form";
import { PageHeading,Metric,SectionHeading,StatusChip } from "@/components/network/ui";
import { issueActivationCode } from "../../activation-actions";
export default async function Headquarters(){
 const {db}=await requireNetwork(true);await refreshSalesNetworkTasks(db,null);
 const [orgs,metrics,activity,urgent,finance,production]=await Promise.all([
  db.from("organizations").select("id,name,organization_type").order("name"),db.rpc("network_dashboard",{p_org:null}),db.rpc("network_dealer_summary"),
  db.from("sales_tasks").select("*").in("status",["OPEN","IN_PROGRESS"]).in("priority",["HIGH","URGENT"]).order("priority_rank").order("due_at").limit(6),
  db.from("order_payment_milestones").select("id",{count:"exact",head:true}).eq("status","SUBMITTED"),
  db.from("orders").select("id,folio,status,estimated_completion_date,organizations!orders_organization_id_fkey(name)").in("status",["PENDING_HQ_REVIEW","RELEASED_TO_PRODUCTION","IN_PRODUCTION","AWAITING_BALANCE","BALANCE_SUBMITTED"]).order("estimated_completion_date",{nullsFirst:true}).limit(6),
 ]);
 if([orgs,metrics,activity,urgent,finance,production].some(r=>r.error))throw new Error("No se pudo cargar Network HQ");const m=metrics.data;
 return <>
  <PageHeading eyebrow="Nahuitech · centro de control" title="NETWORK HQ" description="Visibilidad de la red. Revisión financiera, producción y próximos envíos." action={<Link className="net-button net-primary" href="/network/hq/finance">Finance Inbox {finance.count?`· ${finance.count}`:""} ↗</Link>}/>
  <div className="net-metrics"><Metric label="Pipeline de red" value={money(m.pipeline)}/><Metric label="Pedidos activos" value={m.orders}/><Metric label="Anticipos pendientes" value={money(m.deposits)}/><Metric label="Saldos pendientes" value={money(m.balances)}/></div>
  <div className="net-detail-grid"><section className="net-card net-attention"><SectionHeading title="Atención financiera"/><p className="text-4xl font-semibold">{finance.count??0}</p><p className="net-muted my-4">comprobantes esperan validación. Revisa el abono bancario antes de liberar producción o envío.</p><Link className="net-button" href="/network/hq/finance">Revisar comprobantes</Link></section><section className="net-card"><SectionHeading title="Atención de producción" description="Pedidos en revisión o ejecución, ordenados por fecha estimada."/>{production.data?.map(o=><Link className="net-document" key={o.id} href={`/network/orders/${o.id}`}><div><p className="font-semibold">{o.folio}</p><p className="net-muted text-xs">{(o.organizations as unknown as {name:string})?.name} · {date(o.estimated_completion_date)}</p></div><StatusChip value={o.status}/></Link>)}{!production.data?.length&&<p className="net-muted">No hay pedidos que requieran seguimiento de producción.</p>}<Link className="net-button mt-4" href="/network/hq/orders">Ver todos los pedidos ↗</Link></section></div>
  <section><SectionHeading title="Distribuidores de la red" description={`Cotizado este mes: ${money(m.quoted_month)} · ${m.opportunities} oportunidades activas`}/><div className="net-grid">{orgs.data?.map(o=>{const stats=activity.data?.find((a:{organization_id:string})=>a.organization_id===o.id);return <Link className="net-card" href={`/network/hq/dealers/${o.id}`} key={o.id}><p className="net-eyebrow">{o.organization_type==='MANUFACTURER'?'Venta directa':'Dealer'}</p><h2>{o.name} ↗</h2><div className="net-divider flex justify-between gap-4"><p><strong className="block text-2xl">{stats?.opportunities??0}</strong><span className="net-muted text-xs">Oportunidades</span></p><p><strong className="block text-2xl">{stats?.won??0}</strong><span className="net-muted text-xs">Ganadas</span></p></div></Link>})}</div></section>
  <section><SectionHeading title="Prioridades de la red"/><TaskList tasks={urgent.data??[]}/></section>
  <div className="flex flex-wrap gap-3"><Link className="net-button" href="/network/hq/settings">Metas y configuración</Link><Link className="net-button" href="/network/hq/devices">Dispositivos</Link></div>
  <details className="net-card"><summary>Emitir código de activación</summary><ActionForm action={issueActivationCode} className="mt-5" label="Generar código seguro"><label>Organización<select name="organization_id">{orgs.data?.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label></ActionForm></details>
 </>;
}
