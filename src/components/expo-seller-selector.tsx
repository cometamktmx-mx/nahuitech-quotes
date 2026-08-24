"use client";

import { useSellerOffline } from "./seller-offline-provider";

type SalespersonOption = { id: string; fullName: string };

export function ExpoSellerSelector({
  salespeople,
  children,
}: {
  salespeople: SalespersonOption[];
  children: React.ReactNode;
}) {
  const offline = useSellerOffline();

  if (!offline || offline.accountRole !== "expo" || offline.salespersonId) {
    return <>{children}</>;
  }

  return (
    <main className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-5xl content-center gap-7 px-5 py-10 md:px-8">
      <header className="max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
          Terminal de expo
        </p>
        <h1 className="mt-3 text-4xl font-black tracking-[-0.04em] text-foreground sm:text-5xl">
          ¿Quién está atendiendo?
        </h1>
        <p className="mt-4 text-base leading-7 text-muted">
          Selecciona tu nombre para comenzar.
        </p>
      </header>
      <section
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Vendedores activos"
      >
        {salespeople.map((salesperson) => (
          <button
            className="flex min-h-32 flex-col justify-between rounded-3xl border border-border bg-surface p-6 text-left shadow-[var(--shadow-card)] transition active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            key={salesperson.id}
            onClick={() =>
              void offline.selectSalesperson(
                salesperson.id,
                salesperson.fullName
              )
            }
            type="button"
          >
            <span className="text-xl font-black tracking-[-0.02em] text-foreground">
              {salesperson.fullName}
            </span>
            <span className="mt-5 text-sm font-bold text-primary-hover">
              Seleccionar →
            </span>
          </button>
        ))}
      </section>
      {salespeople.length === 0 ? (
        <p className="rounded-2xl bg-surface-muted px-5 py-4 text-sm text-muted">
          No hay vendedores activos disponibles. Conéctate para actualizar el dispositivo.
        </p>
      ) : null}
    </main>
  );
}
