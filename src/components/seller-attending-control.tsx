"use client";

import { useSellerOffline } from "./seller-offline-provider";

export function SellerAttendingControl({
  userName,
  accountRole,
}: {
  userName: string;
  accountRole: "admin" | "seller" | "expo";
}) {
  const offline = useSellerOffline();
  const isExpo = accountRole === "expo" || accountRole === "admin";
  const name = isExpo ? offline?.salespersonName ?? null : offline?.salespersonName ?? userName;

  if (isExpo && !name) {
    return (
      <div className="min-w-0 text-right">
        <p className="text-sm font-bold text-on-graphite">{accountRole === "admin" ? "Administrador" : "Terminal Expo"}</p>
        <p className="mt-1 text-xs text-on-graphite-muted">Selecciona asesor</p>
      </div>
    );
  }

  return (
    <div className="min-w-0 text-right">
      <p className="truncate text-sm font-bold text-on-graphite">Atendiendo: {name}</p>
      <div className="mt-1 flex justify-end gap-2">
        <p className="text-xs text-on-graphite-muted">
          {accountRole === "admin" ? "Administrador" : isExpo ? "Cuenta Expo" : "Vendedor"}
        </p>
        {isExpo ? (
          <button
            className="text-xs font-bold text-primary"
            onClick={() => void offline?.clearSalesperson()}
            type="button"
          >
            Cambiar
          </button>
        ) : null}
      </div>
    </div>
  );
}
