"use client";

import { useSellerOffline } from "./seller-offline-provider";

export function SellerAttendingControl({ userName }: { userName: string }) {
  const offline = useSellerOffline();
  const name = offline?.salespersonName ?? userName;
  const isExpo = offline?.accountRole === "expo";

  return (
    <div className="min-w-0 text-right">
      <p className="truncate text-sm font-bold text-on-graphite">Atendiendo: {name}</p>
      <div className="mt-1 flex justify-end gap-2">
        <p className="text-xs text-on-graphite-muted">
          {isExpo ? "Cuenta Expo" : "Vendedor"}
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
