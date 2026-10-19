"use client";
import {useRef} from 'react';
export function PurchaseConfirmation({children}:{children:React.ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null);
 return <><button className="net-button net-primary" onClick={()=>dialog.current?.showModal()}>Cliente confirmó compra</button><dialog ref={dialog} className="network max-h-[90vh] w-[min(92vw,650px)] overflow-y-auto rounded-2xl border border-slate-600 bg-slate-950 p-6 text-slate-100 backdrop:bg-black/70"><h2 className="mb-5">Confirmar compra del cliente</h2>{children}<button className="net-button mt-4" onClick={()=>dialog.current?.close()}>Volver</button></dialog></>;
}
