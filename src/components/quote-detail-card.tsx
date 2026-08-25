import Link from "next/link";

import { QuotePdfDownloadButton } from "@/components/quote-pdf-download-button";
import { QuoteWhatsAppButton } from "@/components/quote-whatsapp-button";
import type { QuotePdfSnapshot } from "@/lib/pdf/quote-pdf-types";
import { calculateIncludedTaxBreakdown } from "@/lib/quotes/tax";

type QuoteAddonSnapshot = {
  id: string;
  addonName: string;
  description: string | null;
  calculationType: "FIXED" | "PER_BASE" | "QUANTITY";
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

type QuoteSnapshot = {
  folio: string;
  status: "DRAFT" | "CREATED" | "SENT" | "CANCELLED";
  createdAt: string;
  machineName: string;
  machineBasePrice: number;
  machineNumberOfBases: number | null;
  machineImageUrl: string | null;
  machineVariantType: "AUTOMATIC" | "SEMI_AUTOMATIC" | null;
  machineVariantName: string | null;
  machineVariantPrice: number | null;
  machineVariantDescription: string | null;
  deliveryType: "SHIPPING" | "INSTALLATION" | "LATER";
  deliveryNote: string | null;
  subtotal: number;
  discountAmount: number;
  couponCode: string | null;
  couponName: string | null;
  couponDiscountType: "FIXED_AMOUNT" | "PERCENTAGE" | null;
  couponDiscountValue: number | null;
  notes: string | null;
  total: number;
  subtotalBeforeTax: number | null;
  taxRate: number | null;
  taxAmount: number | null;
};

type QuoteCustomer = {
  name: string;
  company: string | null;
  whatsapp: string;
  email: string | null;
};

const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

const statusLabel: Record<QuoteSnapshot["status"], string> = {
  DRAFT: "Borrador",
  CREATED: "Creada",
  SENT: "Enviada",
  CANCELLED: "Cancelada",
};

const deliveryLabel: Record<QuoteSnapshot["deliveryType"], string> = {
  SHIPPING: "Envío",
  INSTALLATION: "Instalación",
  LATER: "Definir después",
};

/*
export function QuoteDetailCard({
  quote,
  customer,
  addons,
  backHref,
  backLabel,
  sellerName,
  whatsapp,
}: {
  quote: QuoteSnapshot;
  customer: QuoteCustomer;
  addons: QuoteAddonSnapshot[];
  backHref: string;
  backLabel: string;
  sellerName?: string;
  whatsapp?: {
    quoteId: string;
    status: "PENDING" | "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
    destination: string | null;
    error: string | null;
  };
}) {
  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-5 py-7 md:gap-8 md:px-8 md:py-10">
      <Link className="inline-flex min-h-11 w-fit items-center rounded-xl px-3 text-sm font-bold text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href={backHref}>← {backLabel}</Link>
      <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-card)]">
        <div className="bg-graphite px-6 py-7 text-on-graphite sm:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">NAHUITECH</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-black tracking-[-0.04em] sm:text-4xl">{quote.folio}</h1><p className="mt-2 text-sm text-on-graphite-muted">{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(quote.createdAt))}</p></div><span className="rounded-full bg-primary/15 px-4 py-2 text-sm font-bold text-primary">{statusLabel[quote.status]}</span></div>
        </div>

        <div className="grid gap-7 p-6 sm:p-8">
          <section className="grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Cliente</p><p className="mt-2 font-bold text-foreground">{customer.name}</p>{customer.company ? <p className="mt-1 text-sm text-muted">{customer.company}</p> : null}</div>
            <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Contacto</p><p className="mt-2 text-sm font-semibold text-foreground">{customer.whatsapp}</p>{customer.email ? <p className="mt-1 text-sm text-muted">{customer.email}</p> : null}</div>
            {sellerName ? <div className="sm:col-span-2"><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Vendedor</p><p className="mt-2 text-sm font-semibold text-foreground">{sellerName}</p></div> : null}
          </section>

          <section className="border-y border-border py-6">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Máquina</p>
            <div className="mt-3 flex items-start justify-between gap-5"><div><p className="text-lg font-bold text-foreground">{quote.machineName}</p>{quote.machineVariantName ? <p className="mt-1 text-sm font-semibold text-primary-hover">Versión: {quote.machineVariantName}</p> : null}{quote.machineVariantDescription ? <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{quote.machineVariantDescription}</p> : null}{quote.machineNumberOfBases ? <p className="mt-1 text-sm text-muted">{quote.machineNumberOfBases} bases</p> : null}</div><p className="shrink-0 text-lg font-black text-foreground">{currencyFormatter.format(quote.machineBasePrice)}</p></div>
          </section>

          <section>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Add-ons cotizados</p>
            {addons.length > 0 ? <div className="mt-4 grid gap-4">{addons.map((addon) => <div className="flex items-start justify-between gap-4 rounded-2xl bg-surface-muted/60 p-4" key={addon.id}><div><p className="font-bold text-foreground">{addon.addonName}</p>{addon.calculationType === "PER_BASE" ? <p className="mt-1 text-sm text-muted">{addon.quantity} bases × {currencyFormatter.format(addon.unitPrice)} = {currencyFormatter.format(addon.lineTotal)}</p> : <p className="mt-1 text-sm text-muted">Precio fijo</p>}</div><p className="shrink-0 font-black text-foreground">{currencyFormatter.format(addon.lineTotal)}</p></div>)}</div> : <p className="mt-3 text-sm text-muted">Sin add-ons.</p>}
          </section>

          <section className="border-t border-border pt-6"><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Entrega</p><p className="mt-2 font-bold text-foreground">{deliveryLabel[quote.deliveryType]}{quote.deliveryNote ? ` — ${quote.deliveryNote}` : ""}</p><p className="mt-1 text-sm text-muted">La entrega no se incluye como importe en esta cotización.</p></section>

          <section className="grid gap-3 border-t border-border pt-6 text-sm"><div className="flex justify-between gap-4"><span className="text-muted">Subtotal</span><span className="font-bold text-foreground">{currencyFormatter.format(quote.subtotal)}</span></div>{quote.discountAmount > 0 ? <div className="flex justify-between gap-4"><span className="text-muted">Descuento</span><span className="font-bold text-foreground">− {currencyFormatter.format(quote.discountAmount)}</span></div> : null}<div className="flex items-end justify-between gap-4 border-t border-border pt-4"><span className="font-bold uppercase tracking-[0.14em] text-muted">Total equipo</span><span className="text-3xl font-black tracking-[-0.04em] text-foreground">{currencyFormatter.format(quote.total)} MXN</span></div></section>
        </div>
      </section>
    </main>
  );
}
*/

export function QuoteDetailCard({
  quote,
  customer,
  addons,
  backHref,
  backLabel,
  sellerName,
  whatsapp,
}: {
  quote: QuoteSnapshot;
  customer: QuoteCustomer;
  addons: QuoteAddonSnapshot[];
  backHref: string;
  backLabel: string;
  sellerName?: string;
  whatsapp?: {
    quoteId: string;
    status: "PENDING" | "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
    destination: string | null;
    error: string | null;
  };
}) {
  const couponBenefit = quote.couponDiscountType === "PERCENTAGE"
    ? `${quote.couponDiscountValue}%`
    : quote.couponDiscountValue === null
      ? null
      : currencyFormatter.format(quote.couponDiscountValue);
  const historicTax = calculateIncludedTaxBreakdown(quote.total);
  const tax = quote.subtotalBeforeTax !== null && quote.taxRate !== null && quote.taxAmount !== null
    ? {
        subtotalBeforeTax: quote.subtotalBeforeTax,
        taxRate: quote.taxRate,
        taxAmount: quote.taxAmount,
        totalWithTax: quote.total,
      }
    : historicTax;

  const pdfSnapshot: QuotePdfSnapshot = {
    folio: quote.folio,
    createdAt: quote.createdAt,
    customer,
    sellerName: sellerName ?? null,
    machine: {
      name: quote.machineName,
      basePrice: quote.machineBasePrice,
      numberOfBases: quote.machineNumberOfBases,
      imageUrl: quote.machineImageUrl,
      variant: quote.machineVariantType && quote.machineVariantName && quote.machineVariantPrice !== null ? { type: quote.machineVariantType, name: quote.machineVariantName, price: quote.machineVariantPrice, description: quote.machineVariantDescription } : null,
    },
    addons: addons.map((addon) => ({
      id: addon.id,
      name: addon.addonName,
      description: addon.description,
      calculationType: addon.calculationType,
      unitPrice: addon.unitPrice,
      quantity: addon.quantity,
      lineTotal: addon.lineTotal,
    })),
    subtotal: quote.subtotal,
    discountAmount: quote.discountAmount,
    total: quote.total,
    tax,
    coupon:
      quote.couponCode &&
      quote.couponName &&
      quote.couponDiscountType &&
      quote.couponDiscountValue !== null
        ? {
            code: quote.couponCode,
            name: quote.couponName,
            discountType: quote.couponDiscountType,
            discountValue: quote.couponDiscountValue,
            discountAmount: quote.discountAmount,
          }
        : null,
    delivery: {
      type: quote.deliveryType,
      note: quote.deliveryNote,
    },
    notes: quote.notes,
  };

  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-5 py-7 md:gap-8 md:px-8 md:py-10">
      <div className="grid gap-3 sm:flex sm:flex-wrap">
        <QuotePdfDownloadButton className="w-full sm:w-fit" snapshot={pdfSnapshot} />
        {whatsapp ? <QuoteWhatsAppButton initialDestination={whatsapp.destination} initialError={whatsapp.error} initialStatus={whatsapp.status} quoteId={whatsapp.quoteId} /> : null}
      </div>
      <Link className="inline-flex min-h-11 w-fit items-center rounded-xl px-3 text-sm font-bold text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href={backHref}>← {backLabel}</Link>
      <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-card)]">
        <div className="bg-graphite px-6 py-7 text-on-graphite sm:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">NAHUITECH</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div><h1 className="text-3xl font-black tracking-[-0.04em] sm:text-4xl">{quote.folio}</h1><p className="mt-2 text-sm text-on-graphite-muted">{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(quote.createdAt))}</p></div>
            <span className="rounded-full bg-primary/15 px-4 py-2 text-sm font-bold text-primary">{statusLabel[quote.status]}</span>
          </div>
        </div>

        <div className="grid gap-7 p-6 sm:p-8">
          <section className="grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Cliente</p><p className="mt-2 font-bold text-foreground">{customer.name}</p>{customer.company ? <p className="mt-1 text-sm text-muted">{customer.company}</p> : null}</div>
            <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Contacto</p><p className="mt-2 text-sm font-semibold text-foreground">{customer.whatsapp}</p>{customer.email ? <p className="mt-1 text-sm text-muted">{customer.email}</p> : null}</div>
            {sellerName ? <div className="sm:col-span-2"><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Vendedor</p><p className="mt-2 text-sm font-semibold text-foreground">{sellerName}</p></div> : null}
          </section>

          <section className="border-y border-border py-6">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Máquina</p>
            <div className="mt-3 flex items-start justify-between gap-5"><div><p className="text-lg font-bold text-foreground">{quote.machineName}</p>{quote.machineVariantName ? <p className="mt-1 text-sm font-semibold text-primary-hover">Versión: {quote.machineVariantName}</p> : null}{quote.machineNumberOfBases ? <p className="mt-1 text-sm text-muted">{quote.machineNumberOfBases} bases</p> : null}</div><p className="shrink-0 text-lg font-black text-foreground">{currencyFormatter.format(quote.machineBasePrice)}</p></div>
          </section>

          <section>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Add-ons cotizados</p>
            {addons.length > 0 ? <div className="mt-4 grid gap-4">{addons.map((addon) => <div className="flex items-start justify-between gap-4 rounded-2xl bg-surface-muted/60 p-4" key={addon.id}><div><p className="font-bold text-foreground">{addon.addonName}</p>{addon.description ? <p className="mt-1 text-sm text-muted">{addon.description}</p> : null}{addon.calculationType === "PER_BASE" ? <p className="mt-1 text-sm text-muted">{addon.quantity} bases × {currencyFormatter.format(addon.unitPrice)} = {currencyFormatter.format(addon.lineTotal)}</p> : addon.calculationType === "QUANTITY" ? <p className="mt-1 text-sm text-muted">{addon.quantity} {addon.quantity === 1 ? "unidad" : "unidades"} × {currencyFormatter.format(addon.unitPrice)} = {currencyFormatter.format(addon.lineTotal)}</p> : <p className="mt-1 text-sm text-muted">Precio fijo</p>}</div><p className="shrink-0 font-black text-foreground">{currencyFormatter.format(addon.lineTotal)}</p></div>)}</div> : <p className="mt-3 text-sm text-muted">Sin add-ons.</p>}
          </section>

          <section className="border-t border-border pt-6"><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Entrega</p><p className="mt-2 font-bold text-foreground">{deliveryLabel[quote.deliveryType]}{quote.deliveryNote ? ` — ${quote.deliveryNote}` : ""}</p><p className="mt-1 text-sm text-muted">La entrega no se incluye como importe en esta cotización.</p></section>

          <section className="grid gap-3 border-t border-border pt-6 text-sm">
            <div className="flex justify-between gap-4"><span className="text-muted">Precio configuración</span><span className="font-bold text-foreground">{currencyFormatter.format(quote.subtotal)}</span></div>
            {quote.discountAmount > 0 ? <div className="flex justify-between gap-4"><span className="text-muted"><span className="block">Beneficio {quote.couponName ?? "Expo"}{couponBenefit ? ` (${couponBenefit})` : ""}</span>{quote.couponCode ? <span className="mt-1 block text-xs font-bold uppercase tracking-[0.12em] text-muted">Código: {quote.couponCode}</span> : null}</span><span className="font-bold text-success">− {currencyFormatter.format(quote.discountAmount)}</span></div> : null}
            <div className="flex justify-between gap-4"><span className="text-muted">Subtotal sin IVA</span><span className="font-bold text-foreground">{currencyFormatter.format(tax.subtotalBeforeTax)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted">IVA {Math.round(tax.taxRate * 100)}%</span><span className="font-bold text-foreground">{currencyFormatter.format(tax.taxAmount)}</span></div>
            <div className="flex items-end justify-between gap-4 border-t border-border pt-4"><span className="font-bold uppercase tracking-[0.14em] text-muted">Total equipo</span><span className="text-3xl font-black tracking-[-0.04em] text-foreground">{currencyFormatter.format(quote.total)} MXN</span></div>
          </section>
        </div>
      </section>
    </main>
  );
}
