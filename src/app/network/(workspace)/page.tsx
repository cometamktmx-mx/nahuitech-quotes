import Link from "next/link";
import { requireNetwork } from "@/lib/network/server";
import { refreshSalesNetworkTasks } from "@/lib/network/tasks";
import { TaskList } from "@/components/network/tasks";
import { Goals,Insights } from "@/components/network/insights";
import { PageHeading,Metric,SectionHeading,EmptyState } from "@/components/network/ui";
import { money,stages,labels,dateTime,auditLabel } from "@/lib/network/display";
export default async function NetworkHome(){
 const {db,org,organization,owner}=await requireNetwork();await refreshSalesNetworkTasks(db,org);
 const [metrics,tasks,insights,activity,news]=await Promise.all([
  db.rpc("network_dashboard",{p_org:org}),db.from("sales_tasks").select("*").eq("organization_id",org).in("status",["OPEN","IN_PROGRESS"]).order("priority_rank").order("due_at").limit(8),
  db.rpc("network_insights",{p_org:org}),db.from("network_audit_log").select("id,action,entity_type,entity_id,created_at").eq("organization_id",org).order("created_at",{ascending:false}).limit(6),
  db.from("network_announcements").select("id,title,announcement_type").or(`organization_id.is.null,organization_id.eq.${org}`).in("audience",owner?["ALL","HQ","DEALERS"]:["ALL","DEALERS"]).lte("published_at",new Date().toISOString()).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order("published_at",{ascending:false}).limit(3),
 ]);
 if(metrics.error||tasks.error||insights.error||activity.error||news.error)throw new Error("No se pudo cargar el dashboard completo");
 const m=metrics.data;const data:Insights=insights.data;
 return <>
  <PageHeading eyebrow={`${organization?.display_name||organization?.name} · operación comercial`} title="Tu operación, en movimiento." description="Del primer contacto a la entrega. Atiende lo importante y avanza el siguiente pedido." action={<Link className="net-button net-primary" href="/network/opportunities#new">Nueva oportunidad +</Link>}/>
  <div className="net-metrics"><Metric label="Pipeline abierto" value={money(m.pipeline)}/><Metric label="Cotizado este mes" value={money(m.quoted_month)} note="Cotizaciones vinculadas"/><Metric label="Oportunidades" value={m.opportunities} note="Activas"/><Metric label="Tareas pendientes" value={m.tasks}/><Metric label="Pedidos activos" value={m.orders}/></div>
  <section><div className="net-surface-title mb-5"><SectionHeading title="Tu día" description="Urgente primero. Cada tarea te lleva a la acción que necesita."/><Link className="net-muted text-xs" href="/network/tasks">Ver todas las tareas ↗</Link></div><TaskList tasks={tasks.data??[]}/></section>
  <section className="net-card"><SectionHeading title="Tu pipeline" description="Oportunidades por etapa, con datos de tu organización."/><div className="net-pipeline-mini">{stages.map(stage=><Link key={stage} href="/network/opportunities"><span className="net-muted text-xs">{labels[stage]}</span><strong>{data.stages.find(s=>s.stage===stage)?.count??0}</strong><span className="net-muted text-xs">{money(data.stages.find(s=>s.stage===stage)?.value??0)}</span></Link>)}</div></section>
  <section><SectionHeading title="Meta comercial"/><Goals goals={data.goals}/></section>
  <div className="net-detail-grid"><section className="net-card"><SectionHeading title="Actividad reciente"/>{activity.data?.length?<ol className="net-audit">{activity.data.map(a=><li key={a.id}><p>{["opportunity","order"].includes(a.entity_type)?<Link href={`/network/${a.entity_type==='order'?'orders':'opportunities'}/${a.entity_id}`}>{auditLabel(a.action)} ↗</Link>:auditLabel(a.action)}</p><p className="net-muted text-xs">{dateTime(a.created_at)}</p></li>)}</ol>:<EmptyState title="Todo comienza con una oportunidad" body="Las acciones de tu equipo aparecerán aquí."/>}</section><section className="net-card"><SectionHeading title="Desde Nahuitech"/>{news.data?.length?news.data.map(n=><Link href="/network/news" key={n.id} className="net-divider block"><span className="net-chip">{labels[n.announcement_type]??n.announcement_type}</span><p className="mt-3 font-medium">{n.title} ↗</p></Link>):<p className="net-muted">No hay publicaciones vigentes.</p>}</section></div>
 </>;
}
