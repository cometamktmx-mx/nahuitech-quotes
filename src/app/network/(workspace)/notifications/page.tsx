import Link from "next/link";
import { requireNetwork } from "@/lib/network/server";
import { date } from "@/lib/network/display";
import { ActionForm } from "@/components/network/action-form";
import { readNotificationAction } from "../../actions";
export default async function Notifications(){const {db,org}=await requireNetwork();const {data,error}=await db.from("network_notifications").select("*").eq("organization_id",org).order("created_at",{ascending:false}).limit(100);if(error)throw new Error(error.message);return <><h1>Notificaciones</h1><p className="net-muted">Bandeja compartida por la organización.</p>{data?.map(n=><article className="net-card space-y-3" key={n.id}><p className="net-muted text-xs">{date(n.created_at)} · {n.read_at?"Leída":"Nueva"}</p><h2>{n.title}</h2><p>{n.body}</p>{n.source_type==="order"&&<Link href={`/network/orders/${n.source_id}`}>Abrir pedido ↗</Link>}{!n.read_at&&<ActionForm action={readNotificationAction} label="Marcar leída"><input type="hidden" name="id" value={n.id}/></ActionForm>}</article>)}{!data?.length&&<p className="net-card net-muted">Sin novedades por ahora.</p>}</>}
