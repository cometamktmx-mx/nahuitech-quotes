import { SellerMachineCard } from "@/components/seller-machine-card";
import { ExpoSellerSelector } from "@/components/expo-seller-selector";
import { SellerOfflineMode } from "@/components/seller-offline-mode";
import { SellerOfflineProvider } from "@/components/seller-offline-provider";
import { SellerShellHeader } from "@/components/seller-shell-header";
import { requireSellerFlowRole } from "@/lib/auth/require-role";
import { asCatalogNumber, type SellerMachine } from "@/lib/seller-catalog";
import { createClient } from "@/lib/supabase/server";

export default async function SellerPage() {
  const profile = await requireSellerFlowRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("machines")
    .select(
      "id, name, slug, short_description, base_price, number_of_bases, supports_addons, delivery_policy, image_url, sort_order"
    )
    .eq("active", true)
    .order("sort_order")
    .order("name");

  if (error) {
    throw new Error("No se pudieron cargar las máquinas disponibles.");
  }

  const machines: SellerMachine[] = (data ?? []).map((machine) => ({
    id: machine.id,
    name: machine.name,
    slug: machine.slug,
    shortDescription: machine.short_description,
    basePrice: asCatalogNumber(machine.base_price),
    numberOfBases: machine.number_of_bases,
    supportsAddons: machine.supports_addons,
    deliveryPolicy: machine.delivery_policy,
    imageUrl: machine.image_url,
    sortOrder: machine.sort_order,
  }));

  const { data: recentQuoteRows, error: recentQuotesError } = await supabase
    .from("quotes")
    .select("id, folio, customer_id, salesperson_name_snapshot, machine_name_snapshot, total, status, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  if (recentQuotesError) {
    throw new Error("No se pudieron cargar las cotizaciones recientes.");
  }

  const customerIds = (recentQuoteRows ?? []).map((quote) => quote.customer_id);
  const { data: customerRows, error: customersError } = customerIds.length
    ? await supabase.from("customers").select("id, name").in("id", customerIds)
    : { data: [], error: null };

  if (customersError) {
    throw new Error("No se pudieron cargar los clientes recientes.");
  }

  const customerNames = new Map(
    (customerRows ?? []).map((customer) => [customer.id, customer.name])
  );
  const recentQuotes = (recentQuoteRows ?? []).map((quote) => ({
    id: quote.id,
    folio: quote.folio,
    customerName: customerNames.get(quote.customer_id) ?? "Cliente",
    salespersonName: quote.salesperson_name_snapshot ?? "Vendedor",
    machineName: quote.machine_name_snapshot,
    total: asCatalogNumber(quote.total),
    status: quote.status,
    createdAt: new Intl.DateTimeFormat("es-MX", {
      day: "2-digit",
      month: "short",
    }).format(new Date(quote.created_at)),
  }));

  const { data: salespeople } = profile.role === "expo"
    ? await supabase
        .from("salespeople")
        .select("id, full_name, sort_order")
        .eq("active", true)
        .order("sort_order")
        .order("full_name")
    : { data: [] };

  return (
    <SellerOfflineProvider>
      <div className="min-h-screen bg-background">
        <SellerShellHeader userName={profile.full_name} />
        <ExpoSellerSelector salespeople={(salespeople ?? []).map((salesperson) => ({ id: salesperson.id, fullName: salesperson.full_name }))}>
        <main className="mx-auto grid max-w-7xl gap-8 px-5 py-8 md:px-8 md:py-12">
        <header className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Cotizador Expo</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.04em] text-foreground sm:text-5xl">¿Qué máquina quieres cotizar?</h1>
          <p className="mt-4 text-base leading-7 text-muted">Selecciona un equipo para comenzar una configuración rápida y clara.</p>
        </header>

        <section aria-label="Máquinas disponibles" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {machines.map((machine) => <SellerMachineCard key={machine.id} machine={machine} />)}
        </section>

        <section aria-label="Cotizaciones recientes" className="rounded-3xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Historial</p><h2 className="mt-2 text-2xl font-black tracking-[-0.03em] text-foreground">Cotizaciones recientes</h2></div>
            <Link className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href="/seller/quotes">Ver historial</Link>
          </div>
          {recentQuotes.length > 0 ? (
            <div className="mt-5 grid gap-3">
              {recentQuotes.map((quote) => <Link className="grid min-h-20 gap-2 rounded-2xl border border-border bg-surface-muted/40 px-4 py-3 transition active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-5" href={`/seller/quotes/${quote.id}`} key={quote.id}><div className="min-w-0"><p className="truncate font-bold text-foreground">{quote.folio}</p><p className="mt-1 truncate text-sm text-muted">{quote.customerName} · {quote.machineName} · {quote.createdAt}</p></div><p className="text-sm font-bold text-foreground">{new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(quote.total)}</p><p className="text-xs font-bold uppercase tracking-[0.12em] text-success">{quote.status === "CREATED" ? "Creada" : quote.status}</p></Link>)}
            </div>
          ) : <p className="mt-5 rounded-2xl bg-surface-muted px-4 py-5 text-sm text-muted">Aún no tienes cotizaciones creadas.</p>}
        </section>
        </main>
        </ExpoSellerSelector>
        <SellerOfflineMode />
      </div>
    </SellerOfflineProvider>
  );
}
import Link from "next/link";
