import Link from "next/link";
import { labels } from "@/lib/network/display";
export function StatusChip({value}:{value:string}){
 const tone=["WON","VERIFIED","READY_TO_SHIP","DELIVERED","DONE"].includes(value)?"success":["LOST","REJECTED","CANCELLED","URGENT"].includes(value)?"danger":["PENDING_HQ_REVIEW","DEPOSIT_SUBMITTED","BALANCE_SUBMITTED","HIGH"].includes(value)?"attention":"default";
 return <span className={`net-chip net-chip-${tone}`}>{labels[value]??value}</span>;
}
export function PageHeading({eyebrow,title,description,action}:{eyebrow:string;title:string;description?:string;action?:React.ReactNode}){return <header className="net-page-heading"><div><p className="net-eyebrow">{eyebrow}</p><h1>{title}</h1>{description&&<p className="net-muted mt-2 max-w-2xl">{description}</p>}</div>{action&&<div className="net-page-action">{action}</div>}</header>}
export function Metric({label,value,note}:{label:string;value:React.ReactNode;note?:string}){return <article className="net-card net-metric"><p className="net-muted text-xs">{label}</p><p className="net-metric-value">{value}</p>{note&&<p className="net-muted text-xs">{note}</p>}</article>}
export function EmptyState({title,body,href,label}:{title:string;body:string;href?:string;label?:string}){return <div className="net-empty"><span aria-hidden="true" className="net-empty-mark">＋</span><h3>{title}</h3><p className="net-muted">{body}</p>{href&&<Link className="net-button mt-3" href={href}>{label}</Link>}</div>}
export function SectionHeading({title,description}:{title:string;description?:string}){return <div className="mb-5"><h2>{title}</h2>{description&&<p className="net-muted mt-1 text-sm">{description}</p>}</div>}
