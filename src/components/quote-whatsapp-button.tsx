"use client";

import { useState, useTransition } from "react";

import { sendQuoteViaWhatsApp } from "@/app/quotes/whatsapp-actions";

import { primaryButtonClass } from "./ui";

type WhatsAppMessageStatus = "PENDING" | "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

const labels: Record<WhatsAppMessageStatus, string> = {
  PENDING: "Pendiente",
  SENDING: "Enviando",
  SENT: "Enviado",
  DELIVERED: "Entregado",
  READ: "Leído",
  FAILED: "Error",
};

const statusClass: Record<WhatsAppMessageStatus, string> = {
  PENDING: "bg-warning/10 text-warning",
  SENDING: "bg-primary/10 text-primary-hover",
  SENT: "bg-success/10 text-success",
  DELIVERED: "bg-success/10 text-success",
  READ: "bg-success/10 text-success",
  FAILED: "bg-danger/10 text-danger",
};

function isTerminal(status: WhatsAppMessageStatus | null) {
  return status === "SENT" || status === "DELIVERED" || status === "READ";
}

export function QuoteWhatsAppButton({
  quoteId,
  initialStatus = null,
  initialDestination = null,
  initialError = null,
}: {
  quoteId: string;
  initialStatus?: WhatsAppMessageStatus | null;
  initialDestination?: string | null;
  initialError?: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<WhatsAppMessageStatus | null>(initialStatus);
  const [destination, setDestination] = useState(initialDestination);
  const [message, setMessage] = useState(initialError);

  const send = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await sendQuoteViaWhatsApp(quoteId);
      if (result.status) setStatus(result.status);
      if (result.destination) setDestination(result.destination);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      setMessage("Cotización enviada por WhatsApp.");
    });
  };

  const terminal = isTerminal(status);
  const displayStatus = status ?? "PENDING";
  const buttonLabel = isPending || status === "SENDING"
    ? "Enviando por WhatsApp..."
    : status === "FAILED"
      ? "Reintentar envío"
      : terminal
        ? "Cotización enviada"
        : "Enviar por WhatsApp";

  return (
    <div className="grid gap-3">
      <button
        className={primaryButtonClass}
        disabled={isPending || status === "SENDING" || terminal}
        onClick={send}
        type="button"
      >
        {buttonLabel}
      </button>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-full px-3 py-1 font-bold ${statusClass[displayStatus]}`}>
          WhatsApp: {labels[displayStatus]}
        </span>
        {destination ? <span className="text-muted">{destination}</span> : null}
      </div>
      {message ? (
        <p className={`text-sm font-semibold ${status === "FAILED" ? "text-danger" : "text-success"}`} role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
