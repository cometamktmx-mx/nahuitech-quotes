"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { QuotePdfDownloadButton } from "@/components/quote-pdf-download-button";
import { OfflineWhatsAppQueueButton } from "@/components/offline-whatsapp-queue-button";
import { listOfflineQuotes } from "@/lib/offline/offline-quotes";
import type { OfflineQuote } from "@/lib/offline/offline-types";

const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

const statusLabel: Record<OfflineQuote["syncStatus"], string> = {
  PENDING: "Pendiente",
  SYNCED: "Sincronizada",
  SYNC_CONFLICT: "Conflicto",
};

const statusClass: Record<OfflineQuote["syncStatus"], string> = {
  PENDING: "bg-warning/10 text-warning",
  SYNCED: "bg-success/10 text-success",
  SYNC_CONFLICT: "bg-danger/10 text-danger",
};

const whatsappLabel: Record<NonNullable<OfflineQuote["whatsappStatus"]>, string> = {
  NONE: "Sin envío solicitado",
  PENDING: "Envío pendiente",
  SENT: "WhatsApp enviado",
  FAILED: "Error de envío",
};

export function OfflineQuoteList({ sellerId, onBack }: { sellerId: string; onBack?: () => void }) {
  const [quotes, setQuotes] = useState<OfflineQuote[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadQuotes = useCallback(async () => {
    setIsLoading(true);
    setQuotes(await listOfflineQuotes(sellerId));
    setIsLoading(false);
  }, [sellerId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadQuotes();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadQuotes]);

  return (
    <main className="mx-auto grid max-w-5xl gap-7 px-5 py-8 md:px-8 md:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Modo offline</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-foreground sm:text-4xl">Cotizaciones de este dispositivo</h1>
          <p className="mt-3 text-sm leading-6 text-muted">Se conservan aquí hasta que puedan validarse y sincronizarse.</p>
        </div>
        {onBack ? <button className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold text-primary-hover" onClick={onBack} type="button">Volver al catálogo</button> : <Link className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold text-primary-hover" href="/seller">Volver al catálogo</Link>}
      </div>

      {isLoading ? <p className="rounded-3xl bg-surface-muted px-5 py-6 text-sm text-muted">Cargando cotizaciones locales...</p> : null}
      {!isLoading && quotes.length === 0 ? <section className="rounded-3xl border border-border bg-surface p-8 text-center shadow-[var(--shadow-card)]"><p className="text-lg font-bold text-foreground">No hay cotizaciones locales.</p><p className="mt-2 text-sm text-muted">Las cotizaciones creadas sin conexión aparecerán aquí.</p></section> : null}
      <section className="grid gap-4">
        {quotes.map((quote) => (
          <article className="grid gap-4 rounded-3xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={quote.localId}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold text-foreground">{quote.folio}</p>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass[quote.syncStatus]}`}>{statusLabel[quote.syncStatus]}</span>
              </div>
              <p className="mt-2 truncate text-sm text-muted">{quote.pdfSnapshot.customer.name} · {quote.pdfSnapshot.machine.name}</p>
              <p className="mt-1 text-xs text-muted">{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(quote.createdAt))}</p>
              {quote.syncError ? <p className="mt-3 text-sm font-semibold text-danger">{quote.syncError}</p> : null}
              <p className={`mt-2 text-xs font-bold ${(quote.whatsappStatus ?? "NONE") === "FAILED" ? "text-danger" : "text-muted"}`}>
                WhatsApp: {whatsappLabel[quote.whatsappStatus ?? "NONE"]}
              </p>
              {quote.whatsappError ? <p className="mt-1 text-xs font-semibold text-danger">{quote.whatsappError}</p> : null}
            </div>
            <div className="grid gap-3 sm:justify-items-end">
              <p className="text-xl font-black tracking-[-0.03em] text-foreground">{currencyFormatter.format(quote.pdfSnapshot.total)} MXN</p>
              <QuotePdfDownloadButton className="w-full sm:w-auto" snapshot={quote.pdfSnapshot} />
              {(quote.whatsappStatus ?? "NONE") !== "SENT" ? <OfflineWhatsAppQueueButton onQueued={loadQuotes} quoteLocalId={quote.localId} sellerId={sellerId} /> : null}
              {quote.remoteId ? <Link className="text-sm font-bold text-primary-hover" href={`/seller/quotes/${quote.remoteId}`}>Ver cotización sincronizada</Link> : null}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
