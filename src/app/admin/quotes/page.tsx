import Link from "next/link";

import { AdminNav } from "@/components/admin-nav";
import { requireRole } from "@/lib/auth/require-role";
import { asCatalogNumber } from "@/lib/seller-catalog";
import { createClient } from "@/lib/supabase/server";

const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

export default async function AdminQuotesPage() {
  const profile = await requireRole("admin");
  const supabase = await createClient();
  const { data: quoteRows, error: quotesError } = await supabase
    .from("quotes")
    .select("id, folio, customer_id, salesperson_name_snapshot, machine_name_snapshot, machine_variant_name_snapshot, total, status, created_at")
    .order("created_at", { ascending: false });

  if (quotesError) {
    throw new Error("No se pudieron cargar las cotizaciones.");
  }

  const customerIds = (quoteRows ?? []).map((quote) => quote.customer_id);
  const { data: customerRows, error: customersError } = customerIds.length
    ? await supabase.from("customers").select("id, name").in("id", customerIds)
    : { data: [], error: null };

  if (customersError) {
    throw new Error("No se pudieron cargar los datos relacionados.");
  }

  const customerNames = new Map(
    (customerRows ?? []).map((customer) => [customer.id, customer.name])
  );
  return (
    <div className="min-h-screen bg-background">
      <AdminNav active="quotes" userName={profile.full_name} />
      <main className="mx-auto grid max-w-7xl gap-8 px-5 py-8 md:px-8 md:py-12">
        <header><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Comercial</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-foreground sm:text-4xl">Cotizaciones</h1><p className="mt-3 text-base leading-7 text-muted">Consulta las cotizaciones creadas por el equipo comercial.</p></header>
        {(quoteRows ?? []).length > 0 ? <section className="grid gap-3">{(quoteRows ?? []).map((quote) => <Link className="grid min-h-28 gap-3 rounded-3xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] transition active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-center md:gap-6" href={`/admin/quotes/${quote.id}`} key={quote.id}><div className="min-w-0"><p className="font-bold text-foreground">{quote.folio}</p><p className="mt-1 text-xs text-muted">{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(quote.created_at))}</p></div><p className="truncate text-sm font-semibold text-foreground">{customerNames.get(quote.customer_id) ?? "Cliente"}</p><div className="min-w-0"><p className="truncate text-sm text-muted">{quote.salesperson_name_snapshot ?? "Vendedor"}</p><p className="mt-1 truncate text-sm text-muted">{quote.machine_name_snapshot}{quote.machine_variant_name_snapshot ? ` · ${quote.machine_variant_name_snapshot}` : ""}</p></div><p className="font-black text-foreground">{currencyFormatter.format(asCatalogNumber(quote.total))}</p><p className="text-xs font-bold uppercase tracking-[0.12em] text-success">{quote.status === "CREATED" ? "Creada" : quote.status}</p></Link>)}</section> : <section className="rounded-3xl border border-border bg-surface p-8 text-center shadow-[var(--shadow-card)]"><p className="text-lg font-bold text-foreground">Aún no hay cotizaciones.</p><p className="mt-2 text-sm text-muted">Las cotizaciones creadas por vendedores aparecerán aquí.</p></section>}
      </main>
    </div>
  );
}
