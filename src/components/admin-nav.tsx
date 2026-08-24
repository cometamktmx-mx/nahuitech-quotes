import Link from "next/link";

import { BrandMark } from "./ui";

type AdminNavProps = {
  active: "overview" | "catalog" | "sellers" | "quotes" | "coupons";
  userName?: string;
};

function initials(name?: string) {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "AD";
}

function navLinkClass(isActive: boolean) {
  return isActive
    ? "inline-flex min-h-11 items-center rounded-xl bg-on-graphite/10 px-4 text-sm font-semibold text-on-graphite"
    : "inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-on-graphite-muted transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
}

export function AdminNav({ active, userName }: AdminNavProps) {
  return (
    <header className="border-b border-on-graphite/10 bg-graphite text-on-graphite">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <Link className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary" href="/admin">
            <span className="[&>div>span:last-child]:text-on-graphite"><BrandMark /></span>
          </Link>
          <div className="flex items-center gap-3 lg:hidden">
            <span className="grid size-9 place-items-center rounded-full bg-primary text-xs font-black text-primary-foreground">
              {initials(userName)}
            </span>
          </div>
        </div>

        <nav aria-label="Navegación de administración" className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1 lg:pb-0">
          <Link className={navLinkClass(active === "overview")} href="/admin">
            Control center
          </Link>
          <Link className={navLinkClass(active === "catalog")} href="/admin/catalog">
            Catálogo
          </Link>
          <Link className={navLinkClass(active === "sellers")} href="/admin/sellers">
            Vendedores
          </Link>
          <Link className={navLinkClass(active === "quotes")} href="/admin/quotes">
            Cotizaciones
          </Link>
          <Link className={navLinkClass(active === "coupons")} href="/admin/coupons">
            Cupones
          </Link>
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <span className="grid size-9 place-items-center rounded-full bg-primary text-xs font-black text-primary-foreground">
            {initials(userName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-on-graphite">{userName || "Administrador"}</p>
            <p className="text-xs text-on-graphite-muted">Sesión activa</p>
          </div>
        </div>
      </div>
    </header>
  );
}
