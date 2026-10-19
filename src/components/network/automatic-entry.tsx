"use client";
import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { selectNetworkOrganization } from "@/app/network/activation-actions";
function EnterButton(){const {pending}=useFormStatus();return <button className="net-primary" disabled={pending}>{pending?"Entrando…":"Entrar a organización"}</button>;}
export function AutomaticNetworkEntry({organizationId,automatic}:{organizationId:string;automatic:boolean}){
 const form=useRef<HTMLFormElement>(null);const submitted=useRef(false);
 useEffect(()=>{if(automatic&&!submitted.current){submitted.current=true;form.current?.requestSubmit();}},[automatic]);
 return <form ref={form} action={selectNetworkOrganization} className="net-form"><input type="hidden" name="organization_id" value={organizationId}/><EnterButton/></form>;
}
