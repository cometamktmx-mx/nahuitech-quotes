import { NetworkNavigation } from "@/components/network/navigation";
import Image from "next/image";
import Link from "next/link";
import { requireNetwork } from "@/lib/network/server";
import "../network.css";
export default async function NetworkLayout({children}:{children:React.ReactNode}) {
 const {db,org,organization,owner}=await requireNetwork();
 const {count}=await db.from("network_notifications").select("id",{count:"exact",head:true}).eq("organization_id",org).is("read_at",null);
 const {data:modules}=await db.from("organization_modules").select("module_key,enabled").eq("organization_id",org);
 const enabled=(key:string)=>modules?.find(m=>m.module_key===key)?.enabled!==false;
 const moduleFor=(href:string)=>href.includes("opportunities")||href.includes("tasks")||href==="/seller"?"SALES":href.includes("orders")?"ORDERS":href.includes("analytics")?"ANALYTICS":href.includes("news")?"NEWS":"";
 const {data:manage}=await db.rpc("can_manage_org",{p_org:org});
 const links=[["Inicio","/network"],["Oportunidades","/network/opportunities"],["Tareas","/network/tasks"],["Cotizar","/seller"],["Pedidos","/network/orders"],["Noticias","/network/news"],["Analytics","/network/analytics"]];
 return <div className="network" style={{borderTop:`3px solid ${organization?.primary_color||"#4cdae2"}`}}><header className="border-b border-slate-700/60 px-5 py-5 lg:px-10"><div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4"><Link href="/network"><p className="text-xs font-bold tracking-[.25em] text-cyan-300">NAHUITECH</p><p className="text-xl font-semibold tracking-tight">SALES NETWORK</p><p className="net-muted text-xs">Dealer &amp; Sales Operating System</p></Link><div className="flex flex-wrap items-center gap-4"><span className="net-chip">BETA · ONLINE</span><Link href="/network/notifications">Notificaciones {count?`(${count})`:""}</Link><Link href="/network/activate">{organization?.logo_url&&<Image src={organization.logo_url} alt="" width={32} height={32} unoptimized className="mr-2 inline-block rounded"/>}{organization?.display_name||organization?.name} ↗</Link></div></div></header><div className="mx-auto max-w-[1500px] lg:grid lg:grid-cols-[190px_1fr]"><NetworkNavigation links={[...links.filter(([,href])=>enabled(moduleFor(href))).map(([label,href])=>({label,href})),...(manage?[{label:"Dispositivos",href:"/network/devices"}]:[]),...(owner?[{label:"Network HQ",href:"/network/hq"},{label:"Finance Inbox",href:"/network/hq/finance"},{label:"Pedidos de red",href:"/network/hq/orders"}]:[])]}/><main className="min-w-0 space-y-7 p-5 md:p-8">{children}</main></div></div>;
}
