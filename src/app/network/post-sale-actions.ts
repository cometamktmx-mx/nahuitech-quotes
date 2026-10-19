"use server";
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {requireNetwork} from '@/lib/network/server';
import {networkError} from '@/lib/network/errors';
import type {ActionResult} from '@/components/network/action-form';

export async function requestOrderChange(_state:ActionResult,form:FormData):Promise<ActionResult>{
 const {db}=await requireNetwork();
 const {error}=await db.rpc('network_order_request',{p_order:String(form.get('order_id')),p_kind:String(form.get('request_type')),p_reason:String(form.get('reason')),p_item:form.get('item_id')||null,p_configuration:form.get('configuration')||null});
 if(error)return {error:networkError(error)};revalidatePath('/network','layout');return {success:'Solicitud enviada a HQ. El pedido conserva sus condiciones hasta la aprobación.'};
}
export async function reviewOrderChange(_state:ActionResult,form:FormData):Promise<ActionResult>{
 const {db}=await requireNetwork(true);
 const {error}=await db.rpc('network_review_request',{p_request:String(form.get('request_id')),p_approve:form.get('approve')==='yes',p_data:Object.fromEntries(form.entries())});
 if(error)return {error:networkError(error)};revalidatePath('/network','layout');return {success:'Resolución registrada. Los pagos validados conservan su historial.'};
}
export async function createUnitOpportunity(_state:ActionResult,form:FormData):Promise<ActionResult>{
 const {db}=await requireNetwork();const {data,error}=await db.rpc('network_unit_opportunity',{p_unit:String(form.get('unit_id')),p_title:String(form.get('title'))});
 if(error)return {error:networkError(error)};revalidatePath('/network','layout');redirect(`/network/opportunities/${data}`);
}
