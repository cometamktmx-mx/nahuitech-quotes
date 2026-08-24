"use client";

import { useSellerOffline } from "./seller-offline-provider";

function formatSyncDate(value: string | null) {
  if (!value) return "Sin catálogo local";

  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function SellerOfflineStatus() {
  const offline = useSellerOffline();

  if (!offline) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right">
      <span className={offline.isOnline ? "inline-flex items-center gap-1.5 text-xs font-bold text-success" : "inline-flex items-center gap-1.5 text-xs font-bold text-primary"}>
        <span aria-hidden="true" className={offline.isOnline ? "size-2 rounded-full bg-success" : "size-2 rounded-full bg-primary"} />
        {offline.isOnline ? "En línea" : "Modo offline"}
      </span>
      <span className="text-xs text-on-graphite-muted">Última sincronización: {formatSyncDate(offline.lastSyncedAt)}</span>
      {offline.pendingQuoteCount > 0 ? <span className="text-xs font-bold text-primary">{offline.pendingQuoteCount} pendiente{offline.pendingQuoteCount === 1 ? "" : "s"}</span> : null}
    </div>
  );
}
