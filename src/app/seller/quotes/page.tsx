import Link from "next/link";

import { SellerOfflineProvider } from "@/components/seller-offline-provider";
import { SellerShellHeader } from "@/components/seller-shell-header";
import { requireSellerFlowRole } from "@/lib/auth/require-role";
import { asCatalogNumber } from "@/lib/seller-catalog";
import { createClient } from "@/lib/supabase/server";

const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

export default async function SellerQuotesPage() {
  const profile = await requireSellerFlowRole();
  const supabase = await createClient();
  const { data: quoteRows, error: quotesError } = await supabase
    .from("quotes")
    .select(
      "id, folio, customer_id, salesperson_name_snapshot, machine_name_snapshot, total, status, created_at"
    )
    .order("created_at", { ascending: false });

  if (quotesError) throw new Error("No se pudieron cargar las cotizaciones.");

  const customerIds = (quoteRows ?? []).map((quote) => quote.customer_id);
  const { data: customerRows, error: customersError } = customerIds.length
    ? await supabase.from("customers").select("id, name").in("id", customerIds)
    : { data: [], error: null };
  if (customersError) throw new Error("No se pudieron cargar los clientes.");

  const customerNames = new Map(
    (customerRows ?? []).map((customer) => [customer.id, customer.name])
  );

  return (
    <SellerOfflineProvider initialAccountRole={profile.role}>
      <div className="min-h-screen bg-background">
        <SellerShellHeader accountRole={profile.role} userName={profile.full_name} />
        <main className="mx-auto grid max-w-5xl gap-7 px-5 py-8 md:px-8 md:py-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                Historial
              </p>
              <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-foreground sm:text-4xl">
                Tus cotizaciones
              </h1>
            </div>
            <Link className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-[var(--shadow-primary)]" href="/seller">
              Nueva cotización
            </Link>
          </div>
          {(quoteRows ?? []).length > 0 ? (
            <section className="grid gap-3">
              {(quoteRows ?? []).map((quote) => (
                <Link className="grid min-h-24 gap-3 rounded-3xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] transition active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6" href={`/seller/quotes/${quote.id}`} key={quote.id}>
                  <div className="min-w-0">
                    <p className="font-bold text-foreground">{quote.folio}</p>
                    <p className="mt-1 truncate text-sm text-muted">
                      {customerNames.get(quote.customer_id) ?? "Cliente"} · {quote.machine_name_snapshot} · {quote.salesperson_name_snapshot ?? "Vendedor"}
                    </p>
                  </div>
                  <p className="font-black text-foreground">
                    {currencyFormatter.format(asCatalogNumber(quote.total))}
                  </p>
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-success">
                    {quote.status === "CREATED" ? "Creada" : quote.status}
                  </p>
                </Link>
              ))}
            </section>
          ) : (
            <section className="rounded-3xl border border-border bg-surface p-8 text-center shadow-[var(--shadow-card)]">
              <p className="text-lg font-bold text-foreground">Aún no hay cotizaciones.</p>
              <p className="mt-2 text-sm text-muted">Crea una desde el cotizador Expo.</p>
            </section>
          )}
        </main>
      </div>
    </SellerOfflineProvider>
  );
}
