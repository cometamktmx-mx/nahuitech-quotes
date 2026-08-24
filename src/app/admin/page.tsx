import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { AdminNav } from "@/components/admin-nav";
import { PageHeader, SectionCard } from "@/components/ui";

function ControlIcon({ type }: { type: "catalog" | "team" | "quotes" | "coupon" }) {
  const paths = {
    catalog: <><path d="M5 6.5h14v13H5z" /><path d="M8 3.5h8v3H8zM8 11h8M8 15h5" /></>,
    team: <><circle cx="9" cy="9" r="3" /><path d="M3.5 20c.7-3.1 2.6-4.7 5.5-4.7s4.8 1.6 5.5 4.7M16 7.5c2.5.2 3.9 1.5 4.3 4M16.6 15.5c2.1.5 3.4 1.9 3.9 4.2" /></>,
    quotes: <><path d="M6 3.5h9l4 4V20.5H6z" /><path d="M15 3.5v4h4M9 12h6M9 16h6" /></>,
    coupon: <><path d="M4 9V5.5h16V9a2.5 2.5 0 0 0 0 5v4.5H4V14a2.5 2.5 0 0 0 0-5Z" /><path d="M12 7.5v1M12 11.5v1M12 15.5v1" /></>,
  };

  return (
    <svg aria-hidden="true" className="size-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      {paths[type]}
    </svg>
  );
}

export default async function AdminPage() {
  const profile = await requireRole("admin");

  return (
    <div className="min-h-screen bg-background">
      <AdminNav active="overview" userName={profile.full_name} />
      <main className="mx-auto grid max-w-7xl gap-8 px-5 py-8 md:px-8 md:py-12">
        <PageHeader
          description="Administra el catálogo y prepara las herramientas comerciales de Nahuitech desde un solo lugar."
          eyebrow="Centro de control"
          title="Panel administrador"
        />

        <section aria-label="Módulos administrativos" className="grid gap-5 md:grid-cols-2">
          <Link className="group min-h-64 rounded-2xl bg-graphite p-6 text-on-graphite shadow-[var(--shadow-graphite)] transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary active:scale-[0.99] md:p-7" href="/admin/catalog">
            <div className="flex h-full flex-col">
              <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-primary)]"><ControlIcon type="catalog" /></span>
              <div className="mt-auto">
                <h2 className="text-2xl font-bold tracking-[-0.02em]">Catálogo</h2>
                <p className="mt-2 max-w-sm text-base leading-7 text-on-graphite-muted">Máquinas, add-ons y compatibilidades.</p>
                <span className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary">Gestionar catálogo <span aria-hidden="true">→</span></span>
              </div>
            </div>
          </Link>

          <Link className="min-h-64 overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)] transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary active:scale-[0.99] md:p-7" href="/admin/sellers">
            <div className="flex h-full flex-col">
              <span className="grid size-12 place-items-center rounded-2xl bg-surface-muted text-foreground"><ControlIcon type="team" /></span>
              <div className="mt-auto">
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.02em] text-foreground">Vendedores</h2>
                <p className="mt-2 max-w-sm text-base leading-7 text-muted">Administra el equipo comercial.</p>
                <span className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary">Gestionar vendedores <span aria-hidden="true">→</span></span>
              </div>
            </div>
          </Link>

          <SectionCard className="min-h-56 overflow-hidden p-6 md:p-7">
            <div className="flex h-full flex-col">
              <span className="grid size-12 place-items-center rounded-2xl bg-surface-muted text-foreground"><ControlIcon type="quotes" /></span>
              <div className="mt-auto">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Próximamente</p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.02em] text-foreground">Cotizaciones</h2>
                <p className="mt-2 max-w-sm text-base leading-7 text-muted">Consulta actividad comercial.</p>
              </div>
            </div>
          </SectionCard>

          <Link className="min-h-56 overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)] transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary active:scale-[0.99] md:p-7" href="/admin/coupons">
            <div className="flex h-full flex-col">
              <span className="grid size-12 place-items-center rounded-2xl bg-surface-muted text-foreground"><ControlIcon type="coupon" /></span>
              <div className="mt-auto">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Próximamente</p>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.02em] text-foreground">Cupones</h2>
                <p className="mt-2 max-w-sm text-base leading-7 text-muted">Promociones especiales por expo.</p>
              </div>
            </div>
          </Link>
        </section>
      </main>
    </div>
  );
}
