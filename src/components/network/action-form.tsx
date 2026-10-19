"use client";
import { useActionState,useState } from "react";
export type ActionResult={error?:string;success?:string;code?:string};
export function ActionForm({action,children,label="Guardar",className="",confirm,secondary=false}:{action:(state:ActionResult,form:FormData)=>Promise<ActionResult>;children:React.ReactNode;label?:string;className?:string;confirm?:string;secondary?:boolean}){
 const [clientError,setClientError]=useState("");
 const [state,submit,pending]=useActionState(async(previous:ActionResult,form:FormData)=>{
  for(const key of ["due_at","next_action_at","expires_at"]){const value=form.get(key);if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))form.set(key,new Date(value).toISOString());}
  return action(previous,form);
 },{});
 return <form action={submit} onSubmit={event=>{setClientError("");const file=new FormData(event.currentTarget).get("file");if(file instanceof File&&file.size>8*1024*1024){event.preventDefault();setClientError("El archivo supera 8 MB. Elige una versión más ligera antes de enviarlo.");return;}if(confirm&&!window.confirm(confirm))event.preventDefault();}} className={`net-form ${className}`} aria-busy={pending}>
  <fieldset disabled={pending} className="net-fields">{children}</fieldset>
  <button disabled={pending} className={secondary?"net-secondary":"net-primary"}>{pending?"Guardando…":label}</button>
  {state.error&&<p role="alert" className="net-feedback net-feedback-error">{state.error}</p>}
  {clientError&&<p role="alert" className="net-feedback net-feedback-error">{clientError}</p>}
  {state.success&&<p role="status" className="net-feedback net-feedback-success">{state.success}</p>}
  {state.code&&<p role="status" className="break-all rounded border border-cyan-600 p-3">Copia este código ahora (7 días, 20 usos): <strong>{state.code}</strong></p>}
 </form>;
}
