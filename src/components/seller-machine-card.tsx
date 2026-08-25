import Link from "next/link";

import type { SellerMachine } from "@/lib/seller-catalog";

import { MachineThumbnail } from "./machine-thumbnail";

const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

export function SellerMachineCard({
  machine,
  startingPrice,
}: {
  machine: SellerMachine;
  startingPrice?: number;
}) {
  return (
    <Link className="group flex min-h-80 flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-card)] transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary active:scale-[0.99]" href={`/seller/quote/${machine.slug}`}>
      <MachineThumbnail className="aspect-[16/9] w-full shrink-0" imageUrl={machine.imageUrl} name={machine.name} />
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <h2 className="text-xl font-bold tracking-[-0.02em] text-foreground">{machine.name}</h2>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{machine.shortDescription}</p>
        <div className="mt-auto flex items-end justify-between gap-3 pt-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Desde</p>
            <p className="mt-1 text-2xl font-black tracking-[-0.04em] text-foreground">{currencyFormatter.format(startingPrice ?? machine.basePrice)}</p>
          </div>
          <span className="inline-flex min-h-11 items-center rounded-xl bg-primary/10 px-4 text-sm font-bold text-primary-hover">Configurar <span aria-hidden="true" className="ml-2">→</span></span>
        </div>
      </div>
    </Link>
  );
}
