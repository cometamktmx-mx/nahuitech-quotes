"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function NetworkNavigation({links}:{links:{label:string;href:string}[]}){const path=usePathname();return <nav aria-label="Sales Network" className="flex flex-wrap gap-1 border-b border-slate-700/60 p-4 lg:block lg:border-r lg:border-b-0">{links.map(l=><Link key={l.href} href={l.href} aria-current={path===l.href||(l.href!=="/network"&&l.href!=="/network/hq"&&path.startsWith(l.href+"/"))?"page":undefined} className="net-nav-link block rounded-r-lg px-3 py-3 text-sm">{l.label}</Link>)}</nav>}
