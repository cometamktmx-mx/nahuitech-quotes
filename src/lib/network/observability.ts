import "server-only";
type Event="activation"|"order_transition"|"document_upload"|"payment_submit"|"payment_validation"|"task_automation";
// Deliberately no free-form metadata, exception messages, payloads or identifiers.
export function networkLog(event:Event,ok:boolean,started:number){
 if(process.env.SALES_NETWORK_ENV!=="staging"||process.env.SALES_NETWORK_OBSERVABILITY!=="true")return;
 console.info(JSON.stringify({scope:"sales-network",event,ok,duration_ms:Math.max(0,Date.now()-started)}));
}
