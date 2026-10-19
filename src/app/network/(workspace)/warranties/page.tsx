import Link from 'next/link';
import {requireNetwork} from '@/lib/network/server';
import {PageHeading,SectionHeading,EmptyState} from '@/components/network/ui';
import {ActionForm} from '@/components/network/action-form';
import {createUnitOpportunity} from '../../post-sale-actions';
import {date} from '@/lib/network/display';
export default async function Warranties(){
 const {db,org,owner}=await requireNetwork();
 let query=db.from('installed_units').select('*,orders(folio,customer_name_snapshot,dealer_name_snapshot)').order('delivered_at',{ascending:false}).limit(100);
 if(!owner)query=query.or(`dealer_organization_id.eq.${org},supplier_organization_id.eq.${org}`);
 const {data,error}=await query;if(error)throw new Error('No se pudo cargar el registro de unidades.');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 return <><PageHeading eyebrow="Posventa" title="Unidades y garantías"/><p className="net-muted">La vigencia se muestra solo cuando HQ registra una fecha de fin. No se presume una cobertura ni se gestionan reclamaciones en este módulo. Últimas 100 unidades entregadas.</p>{!data?.length?<EmptyState title="Sin unidades entregadas" body="Se registran al confirmar la entrega de un pedido."/>:<div className="net-grid">{data.map(u=><article className="net-card" key={u.id}><SectionHeading title={u.machine_name_snapshot}/><dl className="net-facts"><div><dt>Serie</dt><dd>{u.serial_number||'Pendiente de registro'}</dd></div><div><dt>Cliente</dt><dd>{u.orders?.customer_name_snapshot||'Sin registro'}</dd></div><div><dt>Dealer</dt><dd>{u.orders?.dealer_name_snapshot}</dd></div><div><dt>Entrega</dt><dd>{date(u.delivered_at)}</dd></div><div><dt>Garantía registrada</dt><dd>{date(u.warranty_start_date)} — {u.warranty_end_date?date(u.warranty_end_date):'Fin no definido'}</dd></div><div><dt>Estado por fecha</dt><dd>{!u.warranty_end_date?'Por definir':u.warranty_end_date>=today?'Dentro del periodo registrado':'Periodo vencido'}</dd></div></dl><Link className="net-button my-4" href={`/network/orders/${u.order_id}`}>{u.orders?.folio} · Ver pedido</Link>{(owner||u.dealer_organization_id===org)&&<ActionForm action={createUnitOpportunity} label="Crear oportunidad relacionada" secondary><input type="hidden" name="unit_id" value={u.id}/><label>Nueva necesidad del cliente<input name="title" maxLength={200} required/></label></ActionForm>}</article>)}</div>}</>;
}
