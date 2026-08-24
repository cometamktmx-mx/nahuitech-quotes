"use client";

import { useCallback, useEffect, useState } from "react";

import { getOfflineCatalog } from "@/lib/offline/offline-catalog";
import { offlineDb } from "@/lib/offline/offline-db";
import type {
  OfflineAddon,
  OfflineMachine,
  OfflineMachineAddon,
  OfflineMachineVariant,
} from "@/lib/offline/offline-types";

import { MachineThumbnail } from "./machine-thumbnail";
import { OfflineQuoteList } from "./offline-quote-list";
import { SellerQuoteConfigurator } from "./seller-quote-configurator";
import { useSellerOffline } from "./seller-offline-provider";

const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

type OfflineScreen = "catalog" | "pending";

export function SellerOfflineMode() {
  const offline = useSellerOffline();
  const sellerId = offline?.sellerId ?? null;
  const isOnline = offline?.isOnline ?? true;
  const [machines, setMachines] = useState<OfflineMachine[]>([]);
  const [addons, setAddons] = useState<OfflineAddon[]>([]);
  const [relations, setRelations] = useState<OfflineMachineAddon[]>([]);
  const [variants, setVariants] = useState<OfflineMachineVariant[]>([]);
  const [salespeople, setSalespeople] = useState<
    Array<{ id: string; fullName: string }>
  >([]);
  const [selectedMachine, setSelectedMachine] = useState<OfflineMachine | null>(null);
  const [screen, setScreen] = useState<OfflineScreen>(() =>
    typeof window !== "undefined" && window.location.pathname === "/seller/offline"
      ? "pending"
      : "catalog"
  );
  const [isLoading, setIsLoading] = useState(true);

  const loadCatalog = useCallback(async () => {
    if (!sellerId) {
      setMachines([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const [catalog, storedSalespeople] = await Promise.all([
      getOfflineCatalog(sellerId),
      offlineDb.salespeople.toArray(),
    ]);
    setMachines(catalog.machines);
    setAddons(catalog.addons);
    setRelations(catalog.relations);
    setVariants(catalog.variants);
    setSalespeople(
      storedSalespeople
        .filter((salesperson) => salesperson.active)
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder || left.fullName.localeCompare(right.fullName)
        )
        .map((salesperson) => ({
          id: salesperson.id,
          fullName: salesperson.fullName,
        }))
    );
    setIsLoading(false);
  }, [sellerId]);

  useEffect(() => {
    if (isOnline) return;
    const timeout = window.setTimeout(() => {
      void loadCatalog();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [isOnline, loadCatalog]);

  if (!offline || isOnline) return null;

  if (!offline.sellerId) {
    return (
      <OfflineGate message="No hay una sesión local válida. Conéctate e inicia sesión antes de usar el cotizador sin conexión." />
    );
  }

  if (isLoading) {
    return <OfflineGate message="Preparando el catálogo almacenado en este dispositivo..." />;
  }

  if (!offline.lastSyncedAt || machines.length === 0) {
    return (
      <OfflineGate message="Necesitas conectarte al menos una vez para preparar el modo offline." />
    );
  }

  if (offline.accountRole === "expo" && !offline.salespersonId) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-background px-5 py-10">
        <main className="mx-auto grid max-w-5xl gap-7">
          <header>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
              Modo offline
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-[-0.04em] text-foreground">
              ¿Quién está atendiendo?
            </h1>
            <p className="mt-3 text-muted">
              Selecciona un vendedor ya sincronizado en este dispositivo.
            </p>
          </header>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {salespeople.map((salesperson) => (
              <button
                className="min-h-28 rounded-3xl border border-border bg-surface p-5 text-left shadow-[var(--shadow-card)]"
                key={salesperson.id}
                onClick={() =>
                  void offline.selectSalesperson(
                    salesperson.id,
                    salesperson.fullName
                  )
                }
                type="button"
              >
                <p className="text-lg font-black text-foreground">
                  {salesperson.fullName}
                </p>
                <p className="mt-3 text-sm font-bold text-primary">Seleccionar →</p>
              </button>
            ))}
          </section>
        </main>
      </div>
    );
  }

  if (screen === "pending") {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
        <OfflineQuoteList onBack={() => setScreen("catalog")} sellerId={offline.sellerId} />
      </div>
    );
  }

  if (selectedMachine) {
    const compatibleRelationByAddon = new Map(
      relations
        .filter(
          (relation) =>
            relation.machineId === selectedMachine.id && relation.active
        )
        .map((relation) => [relation.addonId, relation] as const)
    );
    const compatibleAddons = addons
      .filter((addon) => compatibleRelationByAddon.has(addon.id))
      .map((addon) => {
        const relation = compatibleRelationByAddon.get(addon.id);
        return {
          ...addon,
          unitPrice: relation?.unitPriceOverride ?? addon.unitPrice,
          description: relation?.descriptionOverride ?? addon.description,
        };
      });

    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
        <div className="border-b border-border bg-graphite px-5 py-4 text-on-graphite md:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            Nahuitech · Modo offline
          </p>
        </div>
        <SellerQuoteConfigurator
          addons={compatibleAddons}
          machine={selectedMachine}
          onChangeMachine={() => setSelectedMachine(null)}
          onViewPending={() => setScreen("pending")}
          variants={variants.filter(
            (variant) => variant.machineId === selectedMachine.id
          )}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <header className="border-b border-on-graphite/10 bg-graphite px-5 py-5 text-on-graphite md:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
              NAHUITECH
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-[-0.03em]">
              Cotizador Expo
            </h1>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-primary">Modo offline</p>
            <p className="mt-1 text-xs text-on-graphite-muted">
              Última sincronización: {new Intl.DateTimeFormat("es-MX", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(offline.lastSyncedAt))}
            </p>
            <button
              className="mt-2 text-xs font-bold text-primary"
              onClick={() => setScreen("pending")}
              type="button"
            >
              {offline.pendingQuoteCount} pendiente
              {offline.pendingQuoteCount === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl gap-7 px-5 py-8 md:px-8 md:py-12">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            Catálogo disponible sin conexión
          </p>
          <h2 className="mt-3 text-4xl font-black tracking-[-0.04em] text-foreground sm:text-5xl">
            ¿Qué máquina quieres cotizar?
          </h2>
        </header>
        <section
          aria-label="Máquinas disponibles offline"
          className="grid gap-5 md:grid-cols-2 xl:grid-cols-3"
        >
          {machines.map((machine) => (
            <button
              className="flex min-h-80 flex-col overflow-hidden rounded-3xl border border-border bg-surface text-left shadow-[var(--shadow-card)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              key={machine.id}
              onClick={() => setSelectedMachine(machine)}
              type="button"
            >
              <MachineThumbnail
                className="aspect-[16/9] w-full shrink-0"
                imageUrl={machine.imageUrl}
                name={machine.name}
              />
              <span className="flex flex-1 flex-col p-5 sm:p-6">
                <span className="text-xl font-bold tracking-[-0.02em] text-foreground">
                  {machine.name}
                </span>
                <span className="mt-2 line-clamp-2 text-sm leading-6 text-muted">
                  {machine.shortDescription}
                </span>
                <span className="mt-auto pt-6 text-2xl font-black tracking-[-0.04em] text-foreground">
                  {currencyFormatter.format(machine.basePrice)}
                </span>
              </span>
            </button>
          ))}
        </section>
      </main>
    </div>
  );
}

function OfflineGate({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background px-5">
      <section className="max-w-md rounded-3xl border border-border bg-surface p-7 text-center shadow-[var(--shadow-card)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
          Modo offline
        </p>
        <h1 className="mt-3 text-2xl font-black tracking-[-0.03em] text-foreground">
          Cotizador Expo
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted">{message}</p>
      </section>
    </div>
  );
}
