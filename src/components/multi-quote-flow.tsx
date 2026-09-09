"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SellerAddon, SellerMachine, SellerMachineVariant } from "@/lib/seller-catalog";
import type { QuoteItemInput } from "@/lib/quotes/items";
import type { OfflineQuote } from "@/lib/offline/offline-types";
import { offlineDb } from "@/lib/offline/offline-db";
import { createOfflineQuote } from "@/lib/offline/offline-quotes";
import { createQuote, type CreateQuoteResult } from "@/app/seller/quote/actions";
import { calculateIncludedTaxBreakdown, grossToNet, netDiscount } from "@/lib/quotes/tax";
import { useSellerOffline } from "./seller-offline-provider";
import { SellerCouponPanel, type AppliedCoupon } from "./seller-coupon-panel";
import { QuotePdfDownloadButton } from "./quote-pdf-download-button";
import { QuoteWhatsAppButton } from "./quote-whatsapp-button";
import { OfflineWhatsAppQueueButton } from "./offline-whatsapp-queue-button";
import { MachineThumbnail } from "./machine-thumbnail";
import { primaryButtonClass, secondaryButtonClass } from "./ui";

type CartItem = QuoteItemInput & {
  id: string;
  machine: SellerMachine;
  variant: SellerMachineVariant | null;
  addons: SellerAddon[];
  variants: SellerMachineVariant[];
  gross: number;
};
type Customer = { name: string; company: string; whatsapp: string; email: string };
type Draft = { items: CartItem[]; customer: Customer; clientGeneratedId: string };
const emptyCustomer = { name: "", company: "", whatsapp: "", email: "" };
const money = (value: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);
const inputClass = "min-h-12 w-full rounded-xl border border-border bg-surface px-4";
const panelClass = "grid gap-5 rounded-3xl border border-border bg-surface p-6";
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function MultiQuoteFlow({ machine, addons, variants = [], isExpoAccount = false, onChangeMachine, onViewPending }: {
  machine: SellerMachine; addons: SellerAddon[]; variants?: SellerMachineVariant[];
  isExpoAccount?: boolean; onChangeMachine?: () => void; onViewPending?: () => void;
}) {
  const offline = useSellerOffline();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [config, setConfig] = useState({ machine, addons, variants });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState(() => defaultVariant(machine, variants));
  const [quantities, setQuantities] = useState<Record<string, number>>(() => requiredAddons(addons));
  const [quantity, setQuantity] = useState(1);
  const [step, setStep] = useState<"configure" | "cart" | "customer">("configure");
  const [delivery, setDelivery] = useState<"SHIPPING" | "INSTALLATION" | "LATER">("LATER");
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreateQuoteResult | null>(null);
  const [local, setLocal] = useState<OfflineQuote | null>(null);
  const draftKey = offline?.sellerId ? `multi-quote-draft:${offline.sellerId}` : null;

  useEffect(() => {
    if (!draftKey) return;
    let cancelled = false;
    offlineDb.metadata.get(draftKey).then((row) => {
      if (cancelled) return;
      setDraft(row ? JSON.parse(row.value) as Draft : { items: [], customer: emptyCustomer, clientGeneratedId: crypto.randomUUID() });
    }).catch(() => { if (!cancelled) setError("No se pudo abrir el carrito local. Recarga la aplicación."); });
    return () => { cancelled = true; };
  }, [draftKey]);

  async function persist(next: Draft) {
    if (!draftKey) throw new Error("La sesión todavía no está preparada.");
    await offlineDb.metadata.put({ key: draftKey, value: JSON.stringify(next), updatedAt: new Date().toISOString() });
    setDraft(next);
  }

  const allowed = config.variants.filter((v) => config.machine.allowedVariantTypes.includes(v.variantType));
  const variant = allowed.find((v) => v.id === variantId) ?? null;
  const unitPrice = variant?.price ?? config.machine.basePrice;
  const unitAddonTotal = config.addons.reduce((sum, addon) => sum + ((quantities[addon.id] ?? 0) > 0
    ? addon.unitPrice * (addon.calculationType === "PER_BASE" ? config.machine.numberOfBases ?? 0 : quantities[addon.id]) : 0), 0);
  const gross = round((unitPrice + unitAddonTotal) * quantity);
  const subtotal = round(draft?.items.reduce((sum, item) => sum + item.gross, 0) ?? 0);
  const total = round(subtotal - (coupon?.discountAmount ?? 0));
  const tax = calculateIncludedTaxBreakdown(total);
  const items: QuoteItemInput[] = (draft?.items ?? []).map((item) => ({ ...item, deliveryType: item.machine.deliveryPolicy === "INSTALLATION_REQUIRED" ? "INSTALLATION" : item.machine.deliveryPolicy === "SHIPPING_ONLY" ? "SHIPPING" : delivery }));
  const equipmentCount = items.reduce((sum, item) => sum + item.quantity, 0);

  async function addItem() {
    if (!draft) return;
    setError("");
    if (allowed.length && (!variant || !variant.active || !variant.price)) { setError("Selecciona una versión disponible."); return; }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) { setError("La cantidad debe ser un entero entre 1 y 10000."); return; }
    const item: CartItem = { id: editingId ?? crypto.randomUUID(), machineId: config.machine.id, machineVariantId: variantId,
      quantity, addonQuantities: quantities, ...config, variant, gross };
    setBusy(true);
    try {
      await persist({ ...draft, items: editingId ? draft.items.map((old) => old.id === editingId ? item : old) : [...draft.items, item] });
      setCoupon(null); setEditingId(null); setStep("cart");
    } catch { setError("No se pudo guardar el equipo en este dispositivo."); }
    finally { setBusy(false); }
  }

  function editItem(item: CartItem) {
    setConfig({ machine: item.machine, addons: item.addons, variants: item.variants });
    setEditingId(item.id); setVariantId(item.machineVariantId); setQuantity(item.quantity);
    setQuantities(item.addonQuantities); setCoupon(null); setStep("configure"); setError("");
  }

  async function removeItem(item: CartItem) {
    if (!draft || !window.confirm(`¿Eliminar ${item.machine.name} de la cotización?`)) return;
    setBusy(true);
    try { await persist({ ...draft, items: draft.items.filter((old) => old.id !== item.id) }); setCoupon(null); }
    catch { setError("No se pudo eliminar el equipo."); }
    finally { setBusy(false); }
  }

  function catalog() { if (onChangeMachine) onChangeMachine(); else router.push("/seller"); }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft?.items.length || !offline?.sellerId) return;
    setBusy(true); setError("");
    const input = { items, machineId: items[0].machineId, machineVariantId: items[0].machineVariantId,
      addonQuantities: items[0].addonQuantities, customerName: draft.customer.name, customerCompany: draft.customer.company,
      customerWhatsapp: draft.customer.whatsapp, customerEmail: draft.customer.email, deliveryType: delivery,
      couponCode: coupon?.couponCode ?? "", salespersonId: offline.salespersonId, clientGeneratedId: draft.clientGeneratedId };
    try {
      await persist(draft);
      const result = offline.isOnline ? await createQuote(input) : null;
      if (result?.error && !result.retryable) throw new Error(result.error);
      if (result?.quoteId) setCreated(result);
      else {
        const saved = await createOfflineQuote({ ...input, sellerId: offline.sellerId });
        setLocal(saved); await offline.refreshOfflineState();
      }
      await offlineDb.metadata.delete(draftKey!);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear la cotización. Puedes volver a intentar."); }
    finally { setBusy(false); }
  }

  if ((isExpoAccount || offline?.accountRole === "expo") && !offline?.salespersonId) return <main className={panelClass}>Selecciona quién está atendiendo antes de cotizar.<Link href="/seller">Elegir vendedor</Link></main>;
  if (!draft) return <main className="p-8">{error || "Preparando cotización…"}</main>;
  const pdf = local?.pdfSnapshot ?? created?.pdfSnapshot;
  if (local || created?.quoteId) return <main className="mx-auto grid max-w-3xl gap-5 p-6">
    <h1 className="text-3xl font-black">Cotización creada{local ? " en este dispositivo" : ""}</h1>
    <p>{local?.folio ?? created?.folio} · {equipmentCount} equipos</p><p className="text-3xl font-black">{money(local?.pdfSnapshot.total ?? created?.total ?? 0)}</p>
    {pdf ? <QuotePdfDownloadButton snapshot={pdf} /> : null}
    {local ? <><p>Pendiente de sincronización</p><OfflineWhatsAppQueueButton onQueued={offline?.refreshOfflineState} quoteLocalId={local.localId} sellerId={offline!.sellerId!} /><button className={secondaryButtonClass} onClick={() => onViewPending ? onViewPending() : router.push("/seller/offline")}>Ver pendientes</button></> : <QuoteWhatsAppButton quoteId={created!.quoteId!} />}
    <button className={primaryButtonClass} onClick={catalog}>Nueva cotización</button>
  </main>;

  return <main className="mx-auto grid max-w-5xl gap-6 px-5 py-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-black">Cotización · {equipmentCount} equipos</h1>
      {draft.items.length > 0 && step === "configure" ? <button className={secondaryButtonClass} onClick={() => setStep("cart")}>Ver cotización</button> : null}</header>
    {error ? <p role="alert" className="rounded-xl bg-danger/10 p-4 text-danger">{error}</p> : null}
    {step === "configure" ? <section className={panelClass}>
      <div className="grid gap-5 sm:grid-cols-[12rem_1fr]"><MachineThumbnail className="aspect-video rounded-xl" name={config.machine.name} imageUrl={config.machine.imageUrl} /><div><h2 className="text-2xl font-black">{config.machine.name}</h2><p>{config.machine.shortDescription}</p><p className="mt-3 font-bold">{money(grossToNet(unitPrice))} por unidad</p></div></div>
      {allowed.length > 0 && config.machine.variantSelectionRequired ? <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-3 font-bold">Versión</legend>{allowed.map((v) => <button type="button" key={v.id} aria-pressed={variantId === v.id} disabled={!v.active || !v.price} className={`rounded-2xl border-2 p-4 text-left ${variantId === v.id ? "border-primary bg-primary/5" : "border-border"}`} onClick={() => setVariantId(v.id)}><strong>{v.displayName}</strong><p>{v.active && v.price ? money(grossToNet(v.price)) : "No disponible"}</p><p className="mt-2 text-sm text-muted">{v.description}</p></button>)}</fieldset> : variant ? <p>{variant.displayName} · {variant.description}</p> : null}
      <label className="grid max-w-48 gap-2 font-bold">Cantidad de equipos<input aria-label="Cantidad de equipos" type="number" min={1} max={10000} step={1} className={inputClass} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label>
      {config.addons.length ? <fieldset className="grid gap-3"><legend className="mb-3 font-bold">Add-ons por máquina</legend>{config.addons.map((addon) => <label key={addon.id} className="flex items-center justify-between gap-4 rounded-xl border border-border p-4"><span><strong>{addon.name}</strong><span className="block text-sm text-muted">{addon.description}</span><span className="block">{money(grossToNet(addon.unitPrice))}{addon.calculationType === "PER_BASE" ? ` × ${config.machine.numberOfBases} bases × ${quantity} equipos` : " por unidad"}</span></span>{addon.calculationType === "QUANTITY" ? <input aria-label={`Cantidad de ${addon.name} por máquina`} className={`${inputClass} max-w-24`} type="number" min={addon.required ? 1 : 0} step={1} value={quantities[addon.id] ?? 0} onChange={(e) => setQuantities(updateQuantity(quantities, addon.id, Number(e.target.value)))} /> : <input aria-label={addon.name} type="checkbox" disabled={addon.required} checked={(quantities[addon.id] ?? 0) > 0} onChange={(e) => setQuantities(updateQuantity(quantities, addon.id, e.target.checked ? 1 : 0))} />}</label>)}</fieldset> : null}
      <p className="text-xl font-black">Equipo configurado: {money(grossToNet(gross))}</p>
      <div className="flex flex-wrap gap-3"><button className={secondaryButtonClass} onClick={catalog}>Cambiar máquina</button><button disabled={busy} className={primaryButtonClass} onClick={addItem}>{editingId ? "Guardar cambios" : "Agregar equipo a la cotización"}</button></div>
    </section> : <>
      <section className={panelClass}><h2 className="text-xl font-black">{step === "cart" ? "Equipo agregado a la cotización" : "Equipos"}</h2>
        {draft.items.map((item, index) => <article className="grid gap-3 border-b border-border pb-4" key={item.id}><div className="flex justify-between gap-4"><div><h3 className="font-bold">{index + 1}. {item.quantity} × {item.machine.name}</h3><p>{item.variant?.displayName}</p>{item.addons.filter((a) => item.addonQuantities[a.id]).map((a) => <p className="text-sm text-muted" key={a.id}>{a.name} · {item.quantity * (a.calculationType === "PER_BASE" ? item.machine.numberOfBases ?? 0 : item.addonQuantities[a.id])} unidades</p>)}</div><p className="font-bold">{money(grossToNet(item.gross))}</p></div><div className="flex gap-3"><button className={secondaryButtonClass} disabled={busy} onClick={() => editItem(item)}>Editar</button><button className={secondaryButtonClass} disabled={busy} onClick={() => removeItem(item)}>Eliminar</button></div></article>)}
        <button className={secondaryButtonClass} disabled={busy} onClick={catalog}>+ Agregar otra máquina</button>
        {step === "cart" ? <button className={primaryButtonClass} disabled={!items.length || busy} onClick={() => setStep("customer")}>Continuar con cliente</button> : null}
      </section>
      {items.length ? <><SellerCouponPanel items={items} machineId={items[0].machineId} machineVariantId={items[0].machineVariantId} addonQuantities={items[0].addonQuantities} couponCode={couponCode} appliedCoupon={coupon} onAppliedCoupon={setCoupon} onCouponCodeChange={(value) => { setCouponCode(value); setCoupon(null); }} />
      <section className={panelClass}>{coupon ? <p>Beneficio {coupon.couponName}: −{money(netDiscount(subtotal, total))}</p> : null}<p>Subtotal: <strong>{money(tax.subtotalBeforeTax)}</strong></p><p>IVA 16%: <strong>{money(tax.taxAmount)}</strong></p><p className="text-2xl font-black">TOTAL: {money(total)}</p></section></> : null}
      {step === "customer" ? <form onSubmit={submit} className={panelClass}><h2 className="text-xl font-black">Cliente</h2>{(["name", "company", "whatsapp", "email"] as const).map((key) => <label key={key} className="grid gap-2">{{ name: "Nombre", company: "Empresa (opcional)", whatsapp: "WhatsApp", email: "Correo (opcional)" }[key]}<input className={inputClass} required={key === "name" || key === "whatsapp"} type={key === "email" ? "email" : key === "whatsapp" ? "tel" : "text"} value={draft.customer[key]} onChange={(e) => setDraft({ ...draft, customer: { ...draft.customer, [key]: e.target.value } })} onBlur={() => { void persist(draft).catch(() => setError("No se pudieron guardar los datos del cliente.")); }} /></label>)}
        <label className="grid gap-2">Entrega de equipos sin requisito específico<select className={inputClass} value={delivery} onChange={(e) => setDelivery(e.target.value as typeof delivery)}><option value="LATER">Definir después</option><option value="SHIPPING">Envío — Por cotizar</option><option value="INSTALLATION">Instalación — Por cotizar</option></select></label><p className="text-sm text-muted">Los equipos que requieren envío o instalación conservan ese requisito. La entrega se cotiza por separado.</p>
        <button className={primaryButtonClass} disabled={busy || !items.length} type="submit">{busy ? "Creando cotización…" : "Crear cotización"}</button>
      </form> : null}
    </>}
  </main>;
}

function requiredAddons(addons: SellerAddon[]) { return Object.fromEntries(addons.filter((a) => a.required).map((a) => [a.id, 1])); }
function defaultVariant(machine: SellerMachine, variants: SellerMachineVariant[]) {
  const available = variants.filter((v) => v.active && v.price && machine.allowedVariantTypes.includes(v.variantType));
  return !machine.variantSelectionRequired && available.length === 1 ? available[0].id : null;
}
function updateQuantity(values: Record<string, number>, id: string, quantity: number) {
  const next = { ...values }; if (quantity === 0) delete next[id]; else next[id] = quantity; return next;
}
