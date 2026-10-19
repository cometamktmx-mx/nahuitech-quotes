import Link from "next/link";
import { dateTime } from "@/lib/network/display";
import { ActionForm } from "./action-form";
import { StatusChip,EmptyState } from "./ui";
import { taskAction } from "@/app/network/actions";
export type TaskRow={id:string;title:string;description:string|null;priority:string;status:string;due_at:string;order_id:string|null;opportunity_id:string|null;task_type?:string;automation_key?:string|null;responsibility?:string;contact_snapshot?:{name?:string;phone?:string;email?:string}|null};
export function taskDestination(t:TaskRow){
 const type=t.task_type;
 if(t.order_id)return {href:`/network/orders/${t.order_id}#${type==='REQUEST_DEPOSIT'||type==='REQUEST_BALANCE'?'upload':'payments'}`,label:type==='REQUEST_DEPOSIT'?'Solicitar anticipo':type==='REQUEST_BALANCE'?'Solicitar liquidación':'Ver pedido'};
 if(t.opportunity_id)return {href:`/network/opportunities/${t.opportunity_id}#${type==='QUOTE_EXPIRING'?'quote':type==='ORDER_REVIEW'?'stage':'follow-up'}`,label:type==='CALL'?'Programar llamada':type==='QUOTE_EXPIRING'?'Ver cotización':type==='ORDER_REVIEW'?'Convertir en pedido':'Contactar'};
 return null;
}
export function TaskList({tasks}:{tasks:TaskRow[]}){return <div className="space-y-3">{tasks.map(t=>{const cta=taskDestination(t);return <article key={t.id} className="net-card"><div className="net-task"><div><div className="flex flex-wrap gap-2"><StatusChip value={t.priority}/><StatusChip value={t.status}/></div><h3 className="mt-3 font-semibold">{t.title}</h3><p className="net-muted text-xs mt-1">{dateTime(t.due_at)}</p></div><div className="net-task-actions">{cta&&<Link className="net-button" href={cta.href}>{cta.label} ↗</Link>}{!t.automation_key?.startsWith("operation:")&&t.status!=="DONE"&&t.status!=="CANCELLED"&&<ActionForm action={taskAction} label="Completar" secondary><input type="hidden" name="id" value={t.id}/><input type="hidden" name="status" value="DONE"/></ActionForm>}</div></div>{t.contact_snapshot&&<p className="net-muted mt-3 text-sm">{{COMMERCIAL:'Comercial',FINANCE:'Finanzas',PRODUCTION:'Producción',LOGISTICS:'Logística'}[t.responsibility??'']||t.responsibility} · {t.contact_snapshot.name} · {t.contact_snapshot.phone} · {t.contact_snapshot.email}</p>}{t.description&&<p className="net-muted mt-3 text-sm">{t.description}</p>}</article>})}{!tasks.length&&<EmptyState title="Tu seguimiento está al día" body="Las próximas acciones aparecerán aquí. También puedes crear una tarea manual."/>}</div>}
