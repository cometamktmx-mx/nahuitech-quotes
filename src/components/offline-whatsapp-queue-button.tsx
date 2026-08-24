"use client";

import { useState, useTransition } from "react";

import { queueOfflineWhatsAppSend } from "@/lib/offline/offline-whatsapp";

import { useSellerOffline } from "./seller-offline-provider";
import { primaryButtonClass } from "./ui";

export function OfflineWhatsAppQueueButton({
  sellerId,
  quoteLocalId,
  onQueued,
}: {
  sellerId: string;
  quoteLocalId: string;
  onQueued?: () => void | Promise<void>;
}) {
  const offline = useSellerOffline();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  const queue = () => {
    setMessage("");
    startTransition(async () => {
      try {
        await queueOfflineWhatsAppSend(sellerId, quoteLocalId);
        if (offline?.isOnline) {
          await offline.syncNow();
        }
        await onQueued?.();
        setMessage("Envío pendiente. Se enviará cuando la cotización se sincronice.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "No se pudo preparar el envío offline.");
      }
    });
  };

  return (
    <div className="grid gap-2">
      <button className={primaryButtonClass} disabled={isPending} onClick={queue} type="button">
        {isPending ? "Preparando envío..." : "Enviar cuando haya conexión"}
      </button>
      {message ? <p className="text-sm font-semibold text-muted" role="status">{message}</p> : null}
    </div>
  );
}
