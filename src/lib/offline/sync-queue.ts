"use client";

import { createQuote } from "@/app/seller/quote/actions";

import { offlineDb } from "./offline-db";
import { syncPendingOfflineWhatsAppTasks } from "./offline-whatsapp";

const maxQuotesPerAttempt = 10;

export async function syncPendingOfflineQuotes(sellerId: string) {
  const queue = await offlineDb.syncQueue.where("sellerId").equals(sellerId).toArray();
  const entries = queue
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, maxQuotesPerAttempt);
  let synced = 0;
  let conflicts = 0;
  let pending = 0;

  for (const entry of entries) {
    const quote = await offlineDb.offlineQuotes.get(entry.quoteLocalId);

    if (!quote || quote.syncStatus !== "PENDING") {
      await offlineDb.syncQueue.delete(entry.localId);
      continue;
    }

    const attemptAt = new Date().toISOString();

    try {
      const result = await createQuote({
        items: quote.items,
        machineId: quote.machineId,
        addonQuantities:
          quote.selectedAddonQuantities ??
          Object.fromEntries((quote.selectedAddonIds ?? []).map((addonId) => [addonId, 1])),
        customerName: quote.pdfSnapshot.customer.name,
        customerCompany: quote.pdfSnapshot.customer.company ?? "",
        customerWhatsapp: quote.pdfSnapshot.customer.whatsapp,
        customerEmail: quote.pdfSnapshot.customer.email ?? "",
        deliveryType: quote.deliveryType,
        couponCode: quote.couponCode ?? "",
        clientGeneratedId: quote.clientGeneratedId,
        clientGeneratedFolio: quote.folio,
        machineImageUrlSnapshot: quote.pdfSnapshot.machine.imageUrl,
        machineVariantId: quote.machineVariantId,
        salespersonId: quote.salespersonId ?? null,
      });

      if (result.quoteId && result.folio && result.total !== undefined) {
        await offlineDb.transaction("rw", [offlineDb.offlineQuotes, offlineDb.syncQueue], async () => {
          await offlineDb.offlineQuotes.update(quote.localId, {
            syncStatus: "SYNCED",
            syncError: null,
            remoteId: result.quoteId,
            updatedAt: attemptAt,
          });
          await offlineDb.syncQueue.delete(entry.localId);
        });
        synced += 1;
        continue;
      }

      if (result.retryable) {
        await offlineDb.syncQueue.update(entry.localId, {
          attempts: entry.attempts + 1,
          lastAttemptAt: attemptAt,
          lastError: result.error ?? "La conexión no está disponible.",
          updatedAt: attemptAt,
        });
        pending += 1;
        continue;
      }

      await offlineDb.transaction("rw", [offlineDb.offlineQuotes, offlineDb.syncQueue], async () => {
        await offlineDb.offlineQuotes.update(quote.localId, {
          syncStatus: "SYNC_CONFLICT",
          syncError: result.error ?? "La validación remota no aceptó esta cotización.",
          updatedAt: attemptAt,
        });
        await offlineDb.syncQueue.delete(entry.localId);
      });
      conflicts += 1;
    } catch {
      await offlineDb.syncQueue.update(entry.localId, {
        attempts: entry.attempts + 1,
        lastAttemptAt: attemptAt,
        lastError: "No se pudo conectar para sincronizar. Se reintentará cuando vuelva la conexión.",
        updatedAt: attemptAt,
      });
      pending += 1;
    }
  }

  const whatsapp = await syncPendingOfflineWhatsAppTasks(sellerId);
  return { synced, conflicts, pending, whatsapp };
}
