"use client";
import { useState, useTransition } from "react";
import { getManualWhatsAppLink, markWhatsAppManual } from "@/app/admin/quotes/whatsapp-rescue-actions";
import { secondaryButtonClass, primaryButtonClass } from "./ui";
export function AdminWhatsAppRescue({quoteId,status}:{quoteId:string;status:string|null}){
 const [pending,start]=useTransition(); const [error,setError]=useState<string|null>(null);
 const open=()=>start(async()=>{try{window.open(await getManualWhatsAppLink(quoteId),"_blank","noopener,noreferrer");}catch(e){setError(e instanceof Error?e.message:"No se pudo abrir WhatsApp.");}});
 const manual=()=>{if(!window.confirm("¿Marcar esta cotización como enviada manualmente?"))return;start(async()=>{try{await markWhatsAppManual(quoteId);window.location.reload();}catch(e){setError(e instanceof Error?e.message:"No se pudo guardar el envío manual.");}});};
 if(status==="SENT"||status==="DELIVERED"||status==="READ"||status==="MANUAL_SENT")return null;
 return <div className="mt-3 flex flex-wrap gap-2"><button className={secondaryButtonClass} disabled={pending} onClick={open} type="button">Abrir WhatsApp manual</button><button className={primaryButtonClass} disabled={pending} onClick={manual} type="button">Marcar enviado manualmente</button>{error?<p className="basis-full text-sm text-danger">{error}</p>:null}</div>;
}
