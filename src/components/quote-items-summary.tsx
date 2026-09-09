import { snapshotItems } from "@/lib/quotes/items";
import { grossToNet } from "@/lib/quotes/tax";
import type { QuotePdfSnapshot } from "@/lib/pdf/quote-pdf-types";
import { MachineThumbnail } from "./machine-thumbnail";

const money = (value: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(grossToNet(value));

export function QuoteItemsSummary({ snapshot }: { snapshot: QuotePdfSnapshot }) {
  const items = snapshotItems(snapshot);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  return <section className="grid gap-5 border-y border-border py-6">
    <h2 className="text-xl font-black">{count} {count === 1 ? "equipo" : "equipos"}</h2>
    {items.map((item, index) => <article className="grid gap-3 rounded-2xl bg-surface-muted/60 p-4" key={item.id ?? index}>
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr_auto]">
        <MachineThumbnail className="aspect-video rounded-xl" name={item.machine.name} imageUrl={item.machine.imageUrl} />
        <div><h3 className="font-bold">{index + 1}. {item.machine.name}</h3><p>{item.machine.variant?.name}</p><p className="text-sm text-muted">{item.machine.variant?.description}</p><p>Cantidad: {item.quantity} · {money(item.machine.basePrice)} por unidad</p></div>
        <p className="font-black">{money(item.machine.basePrice * item.quantity)}</p>
      </div>
      {item.addons.map((addon) => <div className="flex justify-between gap-4 text-sm" key={addon.id}><div><strong>{addon.name}</strong><p>{addon.description}</p><p>{addon.quantity} × {money(addon.unitPrice)}</p></div><strong>{money(addon.lineTotal)}</strong></div>)}
      <p className="text-sm">{item.delivery.type === "INSTALLATION" ? "Instalación" : item.delivery.type === "SHIPPING" ? "Envío" : "Entrega por definir"} · {item.delivery.note}</p>
      <p className="text-right font-bold">Importe: {money(item.lineGrossTotal)}</p>
    </article>)}
  </section>;
}
