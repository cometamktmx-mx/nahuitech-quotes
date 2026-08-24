"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import type { SellerAddon, SellerMachine } from "@/lib/seller-catalog";
import { createOfflineQuote } from "@/lib/offline/offline-quotes";
import type { OfflineQuote } from "@/lib/offline/offline-types";
import {
  createQuote,
  type CreateQuoteResult,
} from "@/app/seller/quote/actions";

import { SellerCouponPanel, type AppliedCoupon } from "./seller-coupon-panel";
import { OfflineWhatsAppQueueButton } from "./offline-whatsapp-queue-button";
import { QuotePdfDownloadButton } from "./quote-pdf-download-button";
import { QuoteWhatsAppButton } from "./quote-whatsapp-button";
import { MachineThumbnail } from "./machine-thumbnail";
import { primaryButtonClass, secondaryButtonClass } from "./ui";
import { useSellerOffline } from "./seller-offline-provider";

type QuoteStep = "configure" | "details" | "summary";
type DeliveryOption = "shipping" | "installation" | "later";

type CustomerData = {
  name: string;
  company: string;
  whatsapp: string;
  email: string;
};

const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

const inputClass =
  "min-h-13 w-full rounded-2xl border border-border bg-surface px-4 text-base text-foreground outline-none transition placeholder:text-muted focus:border-primary focus:ring-4 focus:ring-primary/10";

const deliveryLabels: Record<DeliveryOption, string> = {
  shipping: "Envío — Por cotizar",
  installation: "Instalación — Por cotizar",
  later: "Definir después",
};

const deliveryTypes: Record<DeliveryOption, "SHIPPING" | "INSTALLATION" | "LATER"> = {
  shipping: "SHIPPING",
  installation: "INSTALLATION",
  later: "LATER",
};

function quoteAddonTotal(addon: SellerAddon, machine: SellerMachine, selectedQuantity: number) {
  if (addon.calculationType === "PER_BASE") {
    return addon.unitPrice * (machine.numberOfBases ?? 0);
  }

  return addon.unitPrice * selectedQuantity;
}

function addonQuantityLabel(addon: SellerAddon, machine: SellerMachine, selectedQuantity: number) {
  if (addon.calculationType === "PER_BASE") {
    return `${machine.numberOfBases ?? 0} bases × ${currencyFormatter.format(addon.unitPrice)}`;
  }
  if (addon.calculationType === "QUANTITY") {
    return `${selectedQuantity} ${selectedQuantity === 1 ? "unidad" : "unidades"} × ${currencyFormatter.format(addon.unitPrice)}`;
  }
  return "Precio fijo";
}

function StepIndicator({ currentStep, supportsAddons }: { currentStep: QuoteStep; supportsAddons: boolean }) {
  const steps = supportsAddons
    ? [
        { key: "select", label: "Seleccionar máquina" },
        { key: "configure", label: "Configurar" },
        { key: "details", label: "Datos / entrega" },
        { key: "summary", label: "Resumen" },
      ]
    : [
        { key: "select", label: "Seleccionar máquina" },
        { key: "details", label: "Datos / entrega" },
        { key: "summary", label: "Resumen" },
      ];
  const currentIndex = steps.findIndex((step) => step.key === currentStep);

  return (
    <ol aria-label="Progreso de la configuración" className="flex items-center gap-2 overflow-x-auto pb-1">
      {steps.map((step, index) => {
        const isCurrent = step.key === currentStep;
        const isComplete = index < currentIndex || step.key === "select";
        const className = isCurrent
          ? "inline-flex min-h-9 items-center rounded-full bg-primary px-3 text-xs font-bold text-primary-foreground"
          : isComplete
            ? "inline-flex min-h-9 items-center rounded-full bg-success/10 px-3 text-xs font-bold text-success"
            : "inline-flex min-h-9 items-center rounded-full bg-surface-muted px-3 text-xs font-bold text-muted";

        return (
          <li className="flex shrink-0 items-center gap-2" key={step.key}>
            {index > 0 ? <span aria-hidden="true" className="h-px w-4 bg-border sm:w-7" /> : null}
            <span className={className}>{isComplete && !isCurrent ? "✓ " : ""}{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function AddonCard({ addon, machine, selectedQuantity, onQuantityChange }: { addon: SellerAddon; machine: SellerMachine; selectedQuantity: number; onQuantityChange: (quantity: number) => void }) {
  const isSelected = selectedQuantity > 0;
  const addonTotal = quoteAddonTotal(addon, machine, selectedQuantity);
  const className = isSelected
    ? "flex min-h-40 w-full flex-col rounded-3xl border-2 border-primary bg-primary/5 p-5 text-left shadow-[0_10px_24px_rgba(6,174,184,0.12)] transition active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    : "flex min-h-40 w-full flex-col rounded-3xl border border-border bg-surface p-5 text-left shadow-[var(--shadow-card)] transition active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

  if (addon.calculationType === "QUANTITY") {
    return (
      <section className={className}>
        <div className="flex items-start justify-between gap-4">
          <div><h3 className="text-lg font-bold tracking-[-0.02em] text-foreground">{addon.name}</h3>{addon.description ? <p className="mt-1 text-sm leading-5 text-muted">{addon.description}</p> : null}</div>
          <button aria-label={`Agregar ${addon.name}`} className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary bg-primary/10 text-xl font-black text-primary-hover" onClick={() => onQuantityChange(Math.max(1, selectedQuantity))} type="button">+</button>
        </div>
        <p className="mt-4 text-sm font-bold text-primary-hover">{currencyFormatter.format(addon.unitPrice)} c/u</p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <div className="inline-flex min-h-12 items-center rounded-xl border border-border bg-surface">
            <button aria-label={`Restar una unidad de ${addon.name}`} className="grid min-h-12 min-w-12 place-items-center text-xl font-black text-foreground disabled:text-muted" disabled={selectedQuantity === 0} onClick={() => onQuantityChange(Math.max(0, selectedQuantity - 1))} type="button">−</button>
            <span className="min-w-12 px-2 text-center text-base font-black text-foreground">{selectedQuantity}</span>
            <button aria-label={`Sumar una unidad de ${addon.name}`} className="grid min-h-12 min-w-12 place-items-center text-xl font-black text-foreground" onClick={() => onQuantityChange(selectedQuantity + 1)} type="button">+</button>
          </div>
          <div className="text-right"><p className="text-xs font-bold uppercase tracking-[0.1em] text-muted">{selectedQuantity === 1 ? "Unidad" : "Unidades"}</p><p className="mt-1 text-lg font-black tracking-[-0.02em] text-foreground">{isSelected ? currencyFormatter.format(addonTotal) : "Sin agregar"}</p></div>
        </div>
      </section>
    );
  }

  return (
    <button aria-pressed={isSelected} className={className} disabled={addon.required} onClick={() => onQuantityChange(isSelected ? 0 : 1)} type="button">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold tracking-[-0.02em] text-foreground">{addon.name}</h3>
          {addon.description ? <p className="mt-1 text-sm leading-5 text-muted">{addon.description}</p> : null}
        </div>
        <span aria-hidden="true" className={isSelected ? "grid size-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-black text-primary-foreground" : "grid size-7 shrink-0 place-items-center rounded-full border border-border text-transparent"}>✓</span>
      </div>
      <div className="mt-auto pt-5">
        {addon.calculationType === "PER_BASE" ? (
          <>
            <p className="text-sm font-bold text-primary-hover">{currencyFormatter.format(addon.unitPrice)} × {machine.numberOfBases} bases</p>
            <p className="mt-1 text-lg font-black tracking-[-0.02em] text-foreground">+ {currencyFormatter.format(addonTotal)} MXN</p>
          </>
        ) : <p className="text-lg font-black tracking-[-0.02em] text-foreground">+ {currencyFormatter.format(addon.unitPrice)} MXN</p>}
        {addon.required ? <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-success">Incluido obligatoriamente</p> : null}
      </div>
    </button>
  );
}

/*
function CouponPlaceholder() {
  const [couponCode, setCouponCode] = useState("");
  const [message, setMessage] = useState("");

  return (
    <section className="rounded-3xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Cupón de expo</p>
      <div className="mt-3 flex gap-2">
        <input aria-label="Código de cupón de expo" className="min-h-12 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-sm font-bold uppercase outline-none transition placeholder:normal-case placeholder:font-normal focus:border-primary focus:ring-4 focus:ring-primary/10" onChange={(event) => setCouponCode(event.target.value)} placeholder="CÓDIGO" value={couponCode} />
        <button className="min-h-12 rounded-xl border border-border px-4 text-sm font-bold text-foreground transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" onClick={() => setMessage("La validación de cupones se habilitará en el siguiente módulo.")} type="button">Aplicar</button>
      </div>
      {message ? <p aria-live="polite" className="mt-3 text-sm leading-5 text-muted">{message}</p> : null}
    </section>
  );
}
*/

/*
function QuoteSummary({ machine, selectedAddons, delivery, customer, compact = false }: { machine: SellerMachine; selectedAddons: SellerAddon[]; delivery: DeliveryOption; customer: CustomerData; compact?: boolean }) {
  const addonsTotal = selectedAddons.reduce((total, addon) => total + quoteAddonTotal(addon, machine), 0);
  const total = machine.basePrice + addonsTotal;

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-2xl bg-graphite px-5 py-4 text-on-graphite">
        <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-on-graphite-muted">Total equipo</p><p className="mt-1 text-2xl font-black tracking-[-0.03em]">{currencyFormatter.format(total)} MXN</p></div>
        <span className="rounded-full bg-primary/15 px-3 py-2 text-xs font-bold text-primary">{selectedAddons.length} add-ons</span>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-card)]">
      <div className="bg-graphite px-5 py-5 text-on-graphite"><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Resumen en vivo</p><p className="mt-2 text-2xl font-black tracking-[-0.04em]">{currencyFormatter.format(total)} MXN</p></div>
      <div className="grid gap-5 p-5">
        <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Máquina</p><p className="mt-1 font-bold text-foreground">{machine.name}</p><p className="mt-1 text-sm text-muted">{currencyFormatter.format(machine.basePrice)} MXN</p></div>
        <div className="border-t border-border pt-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Add-ons</p>
          {selectedAddons.length > 0 ? <div className="mt-3 grid gap-3">{selectedAddons.map((addon) => <div className="flex items-start justify-between gap-3 text-sm" key={addon.id}><span className="font-semibold text-foreground">{addon.name}</span><span className="shrink-0 font-bold text-foreground">{currencyFormatter.format(quoteAddonTotal(addon, machine))}</span></div>)}</div> : <p className="mt-2 text-sm text-muted">Sin configuración adicional.</p>}
          <p className="mt-3 text-sm font-bold text-foreground">Add-ons: {currencyFormatter.format(addonsTotal)} MXN</p>
        </div>
        <div className="border-t border-border pt-4"><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Entrega</p><p className="mt-2 text-sm font-bold text-foreground">{deliveryLabels[delivery]}</p><p className="mt-1 text-xs text-muted">El importe se definirá posteriormente.</p></div>
        {customer.name || customer.whatsapp ? <div className="border-t border-border pt-4"><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Cliente</p><p className="mt-2 text-sm font-bold text-foreground">{customer.name || "Pendiente"}</p>{customer.company ? <p className="mt-1 text-sm text-muted">{customer.company}</p> : null}{customer.whatsapp ? <p className="mt-1 text-sm text-muted">{customer.whatsapp}</p> : null}</div> : null}
      </div>
    </section>
  );
}
*/

function QuoteSummary({
  machine,
  selectedAddons,
  selectedAddonQuantities,
  delivery,
  customer,
  coupon,
  compact = false,
}: {
  machine: SellerMachine;
  selectedAddons: SellerAddon[];
  selectedAddonQuantities: Record<string, number>;
  delivery: DeliveryOption;
  customer: CustomerData;
  coupon: AppliedCoupon | null;
  compact?: boolean;
}) {
  const addonsTotal = selectedAddons.reduce(
    (total, addon) => total + quoteAddonTotal(addon, machine, selectedAddonQuantities[addon.id]),
    0
  );
  const subtotal = machine.basePrice + addonsTotal;
  const discountAmount = coupon?.discountAmount ?? 0;
  const total = subtotal - discountAmount;

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-2xl bg-graphite px-5 py-4 text-on-graphite">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-on-graphite-muted">Total equipo</p>
          <p className="mt-1 text-2xl font-black tracking-[-0.03em]">{currencyFormatter.format(total)} MXN</p>
        </div>
        <span className="rounded-full bg-primary/15 px-3 py-2 text-xs font-bold text-primary">
          {selectedAddons.length} add-ons
        </span>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-card)]">
      <div className="bg-graphite px-5 py-5 text-on-graphite">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Resumen en vivo</p>
        <p className="mt-2 text-2xl font-black tracking-[-0.04em]">{currencyFormatter.format(total)} MXN</p>
      </div>
      <div className="grid gap-5 p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Máquina</p>
          <p className="mt-1 font-bold text-foreground">{machine.name}</p>
          <p className="mt-1 text-sm text-muted">{currencyFormatter.format(machine.basePrice)} MXN</p>
        </div>
        <div className="border-t border-border pt-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Add-ons</p>
          {selectedAddons.length > 0 ? (
            <div className="mt-3 grid gap-3">
              {selectedAddons.map((addon) => (
                <div className="flex items-start justify-between gap-3 text-sm" key={addon.id}>
                  <span className="font-semibold text-foreground">{addon.name}</span>
                  <span className="shrink-0 font-bold text-foreground">{currencyFormatter.format(quoteAddonTotal(addon, machine, selectedAddonQuantities[addon.id]))}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">Sin configuración adicional.</p>
          )}
          <p className="mt-3 text-sm font-bold text-foreground">Add-ons: {currencyFormatter.format(addonsTotal)} MXN</p>
        </div>
        <div className="grid gap-2 border-t border-border pt-4 text-sm">
          <div className="flex justify-between gap-3"><span className="text-muted">Subtotal</span><span className="font-bold text-foreground">{currencyFormatter.format(subtotal)}</span></div>
          {coupon ? <div className="flex justify-between gap-3"><span className="text-success">Beneficio {coupon.couponName}</span><span className="font-bold text-success">− {currencyFormatter.format(discountAmount)}</span></div> : null}
        </div>
        <div className="border-t border-border pt-4"><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Entrega</p><p className="mt-2 text-sm font-bold text-foreground">{deliveryLabels[delivery]}</p><p className="mt-1 text-xs text-muted">El importe se definirá posteriormente.</p></div>
        {customer.name || customer.whatsapp ? <div className="border-t border-border pt-4"><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Cliente</p><p className="mt-2 text-sm font-bold text-foreground">{customer.name || "Pendiente"}</p>{customer.company ? <p className="mt-1 text-sm text-muted">{customer.company}</p> : null}{customer.whatsapp ? <p className="mt-1 text-sm text-muted">{customer.whatsapp}</p> : null}</div> : null}
      </div>
    </section>
  );
}

export function SellerQuoteConfigurator({
  machine,
  addons,
  onChangeMachine,
  onViewPending,
}: {
  machine: SellerMachine;
  addons: SellerAddon[];
  onChangeMachine?: () => void;
  onViewPending?: () => void;
}) {
  const router = useRouter();
  const offline = useSellerOffline();
  const [step, setStep] = useState<QuoteStep>(machine.supportsAddons ? "configure" : "details");
  const [selectedAddonQuantities, setSelectedAddonQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(addons.filter((addon) => addon.required).map((addon) => [addon.id, 1]))
  );
  const lockedDelivery = machine.deliveryPolicy === "INSTALLATION_REQUIRED"
    ? "installation"
    : machine.deliveryPolicy === "SHIPPING_ONLY"
      ? "shipping"
      : null;
  const [delivery, setDelivery] = useState<DeliveryOption>(lockedDelivery ?? "later");
  const [customer, setCustomer] = useState<CustomerData>({ name: "", company: "", whatsapp: "", email: "" });
  const [detailsError, setDetailsError] = useState("");
  const [createError, setCreateError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createdQuote, setCreatedQuote] = useState<CreateQuoteResult | null>(null);
  const [createdLocalQuote, setCreatedLocalQuote] = useState<OfflineQuote | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const selectedAddons = addons.filter((addon) => (selectedAddonQuantities[addon.id] ?? 0) > 0);
  const subtotal = machine.basePrice + selectedAddons.reduce((sum, addon) => sum + quoteAddonTotal(addon, machine, selectedAddonQuantities[addon.id]), 0);
  const total = subtotal - (appliedCoupon?.discountAmount ?? 0);

  function moveTo(nextStep: QuoteStep) {
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setAddonQuantity(addon: SellerAddon, quantity: number) {
    if (addon.required && quantity === 0) return;
    setAppliedCoupon(null);
    setSelectedAddonQuantities((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[addon.id];
      else next[addon.id] = quantity;
      return next;
    });
  }

  function handleCouponCodeChange(value: string) {
    setCouponCode(value);
    setAppliedCoupon(null);
  }

  function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer.name.trim() || !customer.whatsapp.trim()) {
      setDetailsError("Nombre y WhatsApp son obligatorios para continuar.");
      return;
    }
    setDetailsError("");
    moveTo("summary");
  }

  function goBack() {
    if (step === "summary") {
      moveTo("details");
    } else if (step === "details" && machine.supportsAddons) {
      moveTo("configure");
    }
  }

  function changeMachine() {
    if (onChangeMachine) {
      onChangeMachine();
      return;
    }
    router.push("/seller");
  }

  function viewPendingQuotes() {
    if (onViewPending) {
      onViewPending();
      return;
    }
    router.push("/seller/offline");
  }

  async function createLocalQuote() {
    if (!offline?.sellerId) {
      setCreateError("No hay una sesión local preparada para crear esta cotización offline.");
      return false;
    }

    try {
      const quote = await createOfflineQuote({
        sellerId: offline.sellerId,
        machineId: machine.id,
        addonQuantities: selectedAddonQuantities,
        customerName: customer.name,
        customerCompany: customer.company,
        customerWhatsapp: customer.whatsapp,
        customerEmail: customer.email,
        deliveryType: deliveryTypes[delivery],
        couponCode: appliedCoupon?.couponCode ?? "",
      });
      setCreatedLocalQuote(quote);
      await offline.refreshOfflineState();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return true;
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "No se pudo crear la cotización local.");
      return false;
    }
  }

  async function handleCreateQuote() {
    setCreateError("");
    setIsCreating(true);

    if (offline && !offline.isOnline) {
      await createLocalQuote();
      setIsCreating(false);
      return;
    }

    try {
      const result = await createQuote({
        machineId: machine.id,
        addonQuantities: selectedAddonQuantities,
        customerName: customer.name,
        customerCompany: customer.company,
        customerWhatsapp: customer.whatsapp,
        customerEmail: customer.email,
        deliveryType: deliveryTypes[delivery],
        couponCode: appliedCoupon?.couponCode ?? "",
      });

      if (result.error || !result.quoteId || !result.folio || result.total === undefined) {
        if (result.retryable) {
          await createLocalQuote();
        } else {
          setCreateError(result.error ?? "No se pudo crear la cotización.");
        }
        return;
      }

      setCreatedQuote(result);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      await createLocalQuote();
    } finally {
      setIsCreating(false);
    }
  }

  const remoteQuoteCreated = createdQuote?.quoteId && createdQuote.folio && createdQuote.total !== undefined;
  const createdFolio = createdLocalQuote?.folio ?? (remoteQuoteCreated ? createdQuote.folio : null);
  const createdTotal = createdLocalQuote?.pdfSnapshot.total ?? (remoteQuoteCreated ? createdQuote.total : null);
  const createdPdfSnapshot = createdLocalQuote?.pdfSnapshot ?? (remoteQuoteCreated ? createdQuote.pdfSnapshot : undefined);

  if (createdFolio && typeof createdTotal === "number") {
    return (
      <main className="mx-auto grid max-w-3xl place-items-center px-5 py-10 md:min-h-[70vh] md:px-8">
        <section className="w-full overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-card)]">
          <div className="bg-graphite px-6 py-8 text-on-graphite sm:px-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">NAHUITECH</p>
            <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl">{createdLocalQuote ? "Cotización creada en este dispositivo" : "Cotización creada"}</h1>
          </div>
          <div className="grid gap-6 p-6 sm:p-8">
            <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Folio</p><p className="mt-2 text-2xl font-black tracking-[-0.03em] text-foreground">{createdFolio}</p></div>
            <div className="grid gap-4 border-y border-border py-5 sm:grid-cols-2"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Cliente</p><p className="mt-2 font-bold text-foreground">{customer.name}</p></div><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Estado</p><p className="mt-2 font-bold text-success">{createdLocalQuote ? "Pendiente de sincronización" : "Creada"}</p></div></div>
            <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Total equipo</p><p className="mt-2 text-3xl font-black tracking-[-0.04em] text-foreground">{currencyFormatter.format(createdTotal)} MXN</p></div>
            {createdPdfSnapshot ? <QuotePdfDownloadButton snapshot={createdPdfSnapshot} /> : null}
            {createdLocalQuote && offline?.sellerId ? <OfflineWhatsAppQueueButton onQueued={offline.refreshOfflineState} quoteLocalId={createdLocalQuote.localId} sellerId={offline.sellerId} /> : null}
            {!createdLocalQuote && createdQuote?.quoteId ? <QuoteWhatsAppButton quoteId={createdQuote.quoteId} /> : null}
            {createdLocalQuote ? <div className="grid gap-3 sm:grid-cols-2"><button className={primaryButtonClass} onClick={viewPendingQuotes} type="button">Ver pendientes</button><button className={secondaryButtonClass} onClick={changeMachine} type="button">Nueva cotización</button></div> : <div className="grid gap-3 sm:grid-cols-2"><Link className={primaryButtonClass} href={`/seller/quotes/${createdQuote?.quoteId}`}>Ver cotización</Link><Link className={secondaryButtonClass} href="/seller">Nueva cotización</Link></div>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-5 py-6 md:gap-8 md:px-8 md:py-10">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><StepIndicator currentStep={step} supportsAddons={machine.supportsAddons} /><Link className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href="/seller">Cambiar máquina</Link></div>
        <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-card)]">
          <div className="grid md:grid-cols-[16rem_minmax(0,1fr)]">
            <MachineThumbnail className="aspect-[16/9] min-h-full md:aspect-auto" imageUrl={machine.imageUrl} name={machine.name} />
            <div className="p-5 sm:p-7"><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Máquina seleccionada</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-foreground sm:text-4xl">{machine.name}</h1><p className="mt-3 max-w-2xl text-base leading-7 text-muted">{machine.shortDescription}</p><p className="mt-5 text-3xl font-black tracking-[-0.04em] text-foreground">{currencyFormatter.format(machine.basePrice)} MXN</p>{machine.numberOfBases ? <p className="mt-3 inline-flex rounded-full bg-primary/10 px-4 py-2 text-sm font-bold text-primary-hover">{machine.numberOfBases} bases incluidas</p> : null}{!machine.supportsAddons ? <p className="mt-4 inline-flex rounded-full bg-surface-muted px-4 py-2 text-sm font-bold text-muted">Equipo completo · Sin configuración adicional</p> : null}</div>
          </div>
        </section>
      </div>

      <QuoteSummary compact coupon={appliedCoupon} customer={customer} delivery={delivery} machine={machine} selectedAddonQuantities={selectedAddonQuantities} selectedAddons={selectedAddons} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="min-w-0">
          {step === "configure" ? (
            <section className="rounded-3xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-7">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Configuración</p>
              <h2 className="mt-3 text-2xl font-black tracking-[-0.03em] text-foreground sm:text-3xl">Elige los add-ons para esta máquina</h2>
              <p className="mt-3 text-base leading-7 text-muted">Los precios se actualizan inmediatamente. La entrega se cotiza después.</p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">{addons.map((addon) => <AddonCard addon={addon} key={addon.id} machine={machine} onQuantityChange={(quantity) => setAddonQuantity(addon, quantity)} selectedQuantity={selectedAddonQuantities[addon.id] ?? 0} />)}</div>
              <div className="mt-7 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"><Link className={secondaryButtonClass} href="/seller">Atrás</Link><button className={primaryButtonClass} onClick={() => moveTo("details")} type="button">Continuar con datos y entrega <span aria-hidden="true">→</span></button></div>
            </section>
          ) : null}

          {step === "details" ? (
            <form className="grid gap-7 rounded-3xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-7" onSubmit={handleDetailsSubmit}>
              <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Datos / entrega</p><h2 className="mt-3 text-2xl font-black tracking-[-0.03em] text-foreground sm:text-3xl">¿Para quién preparamos esta configuración?</h2></div>
              <fieldset className="grid gap-4">
                <legend className="text-base font-bold text-foreground">Cliente</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-2 sm:col-span-2"><span className="text-sm font-bold text-foreground">Nombre</span><input className={inputClass} onChange={(event) => setCustomer((current) => ({ ...current, name: event.target.value }))} placeholder="Nombre de contacto" required value={customer.name} /></label>
                  <label className="grid gap-2"><span className="text-sm font-bold text-foreground">Empresa <span className="font-normal text-muted">(opcional)</span></span><input className={inputClass} onChange={(event) => setCustomer((current) => ({ ...current, company: event.target.value }))} placeholder="Empresa" value={customer.company} /></label>
                  <label className="grid gap-2"><span className="text-sm font-bold text-foreground">WhatsApp</span><input className={inputClass} onChange={(event) => setCustomer((current) => ({ ...current, whatsapp: event.target.value }))} placeholder="Número de WhatsApp" required type="tel" value={customer.whatsapp} /></label>
                  <label className="grid gap-2 sm:col-span-2"><span className="text-sm font-bold text-foreground">Correo <span className="font-normal text-muted">(opcional)</span></span><input className={inputClass} onChange={(event) => setCustomer((current) => ({ ...current, email: event.target.value }))} placeholder="correo@empresa.com" type="email" value={customer.email} /></label>
                </div>
              </fieldset>

              <fieldset className="border-t border-border pt-7">
                <legend className="text-base font-bold text-foreground">Entrega</legend>
                {lockedDelivery ? <div className="mt-4 rounded-2xl border-2 border-primary bg-primary/5 px-5 py-5"><p className="font-bold text-foreground">{lockedDelivery === "installation" ? "Instalación requerida" : "Envío requerido"}</p><p className="mt-1 text-sm text-muted">Por cotizar. Este importe no se incluye en el total de equipo.</p></div> : <><p className="mt-2 text-sm leading-6 text-muted">Selecciona cómo deseas dejar registrada esta parte. No se suma ningún importe todavía.</p>
                <div className="mt-4 grid gap-3">
                  {(Object.keys(deliveryLabels) as DeliveryOption[]).map((option) => {
                    const isSelected = delivery === option;
                    const optionClass = isSelected ? "flex min-h-16 items-center justify-between rounded-2xl border-2 border-primary bg-primary/5 px-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" : "flex min-h-16 items-center justify-between rounded-2xl border border-border bg-surface px-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
                    return <button aria-pressed={isSelected} className={optionClass} key={option} onClick={() => setDelivery(option)} type="button"><span className="font-bold text-foreground">{deliveryLabels[option]}</span><span className={isSelected ? "grid size-6 place-items-center rounded-full bg-primary text-xs font-black text-primary-foreground" : "grid size-6 place-items-center rounded-full border border-border text-transparent"}>✓</span></button>;
                  })}
                </div></>}
              </fieldset>

              {detailsError ? <p aria-live="polite" className="rounded-2xl bg-danger/10 px-4 py-3 text-sm font-bold text-danger" role="alert">{detailsError}</p> : null}
              <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">{machine.supportsAddons ? <button className={secondaryButtonClass} onClick={goBack} type="button">Atrás</button> : <Link className={secondaryButtonClass} href="/seller">Cambiar máquina</Link>}<button className={primaryButtonClass} type="submit">Ver resumen <span aria-hidden="true">→</span></button></div>
            </form>
          ) : null}

          {step === "summary" ? (
            <section className="grid gap-7 rounded-3xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-7">
              <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">NAHUITECH</p><h2 className="mt-3 text-2xl font-black tracking-[-0.03em] text-foreground sm:text-3xl">Resumen de la configuración</h2></div>
              <div className="grid gap-6 border-y border-border py-6">
                <div className="flex items-start justify-between gap-5"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Máquina seleccionada</p><p className="mt-2 text-lg font-bold text-foreground">{machine.name}</p></div><p className="shrink-0 text-lg font-black text-foreground">{currencyFormatter.format(machine.basePrice)}</p></div>
                <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Add-ons seleccionados</p>{selectedAddons.length > 0 ? <div className="mt-4 grid gap-4">{selectedAddons.map((addon) => <div className="flex items-start justify-between gap-4" key={addon.id}><div><p className="font-bold text-foreground">{addon.name}</p>{addon.description ? <p className="mt-1 text-sm text-muted">{addon.description}</p> : null}<p className="mt-1 text-sm text-muted">{addonQuantityLabel(addon, machine, selectedAddonQuantities[addon.id])}{addon.calculationType !== "FIXED" ? ` = ${currencyFormatter.format(quoteAddonTotal(addon, machine, selectedAddonQuantities[addon.id]))}` : ""}</p></div><p className="shrink-0 font-black text-foreground">{currencyFormatter.format(quoteAddonTotal(addon, machine, selectedAddonQuantities[addon.id]))}</p></div>)}</div> : <p className="mt-3 text-sm text-muted">Esta máquina se cotiza como equipo completo, sin add-ons.</p>}</div>
                <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Entrega</p><p className="mt-2 font-bold text-foreground">{deliveryLabels[delivery]}</p><p className="mt-1 text-sm text-muted">Por cotizar — no se incluye en el total de equipo.</p></div>
                <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Cliente</p><p className="mt-2 font-bold text-foreground">{customer.name}</p>{customer.company ? <p className="mt-1 text-sm text-muted">{customer.company}</p> : null}<p className="mt-1 text-sm text-muted">{customer.whatsapp}</p>{customer.email ? <p className="mt-1 text-sm text-muted">{customer.email}</p> : null}</div>
              </div>
              <div className="grid gap-3 border-t border-border pt-5 text-sm">
                <div className="flex justify-between gap-4"><span className="text-muted">Subtotal</span><span className="font-bold text-foreground">{currencyFormatter.format(subtotal)}</span></div>
                {appliedCoupon ? <div className="flex justify-between gap-4"><span className="text-success">Beneficio {appliedCoupon.couponName}</span><span className="font-bold text-success">− {currencyFormatter.format(appliedCoupon.discountAmount)}</span></div> : null}
              </div>
              <div className="flex items-end justify-between gap-5"><p className="text-sm font-bold uppercase tracking-[0.14em] text-muted">Total equipo</p><p className="text-3xl font-black tracking-[-0.04em] text-foreground">{currencyFormatter.format(total)} MXN</p></div>
              {createError ? <p aria-live="polite" className="rounded-2xl bg-danger/10 px-4 py-4 text-sm font-bold text-danger" role="alert">{createError}</p> : null}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"><button className={secondaryButtonClass} disabled={isCreating} onClick={goBack} type="button">Atrás</button><button className={primaryButtonClass} disabled={isCreating} onClick={handleCreateQuote} type="button">{isCreating ? "Creando cotización..." : "Crear cotización"}</button></div>
              <Link className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href="/seller">Nueva configuración</Link>
            </section>
          ) : null}
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-6"><QuoteSummary coupon={appliedCoupon} customer={customer} delivery={delivery} machine={machine} selectedAddonQuantities={selectedAddonQuantities} selectedAddons={selectedAddons} /><SellerCouponPanel addonQuantities={selectedAddonQuantities} appliedCoupon={appliedCoupon} couponCode={couponCode} machineId={machine.id} onAppliedCoupon={setAppliedCoupon} onCouponCodeChange={handleCouponCodeChange} /></aside>
      </div>
    </main>
  );
}
