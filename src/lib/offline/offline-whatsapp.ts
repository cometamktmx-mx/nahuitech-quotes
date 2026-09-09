"use client";

import { sendQuoteViaWhatsApp } from "@/app/quotes/whatsapp-actions";

import { offlineDb } from "./offline-db";
import type { OfflineWhatsAppTask } from "./offline-types";

const maxTasksPerAttempt = 10;

function newLocalId() {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("Este navegador no puede preparar el envío offline.");
  }
  return crypto.randomUUID();
}

export async function queueOfflineWhatsAppSend(sellerId: string, quoteLocalId: string) {
  const quote = await offlineDb.offlineQuotes.get(quoteLocalId);
  if (!quote || quote.sellerId !== sellerId) {
    throw new Error("La cotización local no está disponible para enviar.");
  }

  if (quote.whatsappStatus === "SENT") return quote;

  const now = new Date().toISOString();
  const existing = await offlineDb.offlineWhatsAppTasks.where("quoteLocalId").equals(quoteLocalId).first();
  const task: OfflineWhatsAppTask = existing ?? {
    localId: newLocalId(),
    quoteLocalId,
    sellerId,
    status: "PENDING",
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };

  await offlineDb.transaction("rw", [offlineDb.offlineQuotes, offlineDb.offlineWhatsAppTasks], async () => {
    await offlineDb.offlineWhatsAppTasks.put({
      ...task,
      status: "PENDING",
      lastError: null,
      updatedAt: now,
    });
    await offlineDb.offlineQuotes.update(quoteLocalId, {
      whatsappStatus: "PENDING",
      whatsappError: null,
      updatedAt: now,
    });
  });

  return { ...quote, whatsappStatus: "PENDING" as const, whatsappError: null };
}

export async function syncPendingOfflineWhatsAppTasks(sellerId: string) {
  const tasks = await offlineDb.offlineWhatsAppTasks.where("sellerId").equals(sellerId).toArray();
  const pendingTasks = tasks
    .filter((task) => task.status === "PENDING")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, maxTasksPerAttempt);
  let sent = 0;
  let pending = 0;
  let failed = 0;

  for (const task of pendingTasks) {
    const quote = await offlineDb.offlineQuotes.get(task.quoteLocalId);
    const now = new Date().toISOString();

    if (!quote || quote.sellerId !== sellerId) {
      await offlineDb.offlineWhatsAppTasks.delete(task.localId);
      continue;
    }

    if (quote.syncStatus === "SYNC_CONFLICT") {
      await offlineDb.transaction("rw", [offlineDb.offlineQuotes, offlineDb.offlineWhatsAppTasks], async () => {
        await offlineDb.offlineWhatsAppTasks.update(task.localId, {
          status: "FAILED",
          lastAttemptAt: now,
          lastError: "La cotización tiene un conflicto y no se puede enviar.",
          updatedAt: now,
        });
        await offlineDb.offlineQuotes.update(quote.localId, {
          whatsappStatus: "FAILED",
          whatsappError: "La cotización tiene un conflicto y no se puede enviar.",
          updatedAt: now,
        });
      });
      failed += 1;
      continue;
    }

    if (!quote.remoteId || quote.syncStatus !== "SYNCED") {
      pending += 1;
      continue;
    }

    try {
      const result = await sendQuoteViaWhatsApp(quote.remoteId);

      if (result.status === "SENT" || result.status === "DELIVERED" || result.status === "READ") {
        await offlineDb.transaction("rw", [offlineDb.offlineQuotes, offlineDb.offlineWhatsAppTasks], async () => {
          await offlineDb.offlineWhatsAppTasks.update(task.localId, {
            status: "SENT",
            lastAttemptAt: now,
            lastError: null,
            updatedAt: now,
          });
          await offlineDb.offlineQuotes.update(quote.localId, {
            whatsappStatus: "SENT",
            whatsappError: null,
            updatedAt: now,
          });
        });
        sent += 1;
        continue;
      }

      if (result.retryable) {
        await offlineDb.offlineWhatsAppTasks.update(task.localId, {
          attempts: task.attempts + 1,
          lastAttemptAt: now,
          lastError: result.error ?? "El envío sigue pendiente.",
          updatedAt: now,
        });
        await offlineDb.offlineQuotes.update(quote.localId, {
          whatsappStatus: "PENDING",
          whatsappError: result.error ?? null,
          updatedAt: now,
        });
        pending += 1;
        continue;
      }

      await offlineDb.transaction("rw", [offlineDb.offlineQuotes, offlineDb.offlineWhatsAppTasks], async () => {
        await offlineDb.offlineWhatsAppTasks.update(task.localId, {
          status: "FAILED",
          attempts: task.attempts + 1,
          lastAttemptAt: now,
          lastError: result.error ?? "No se pudo enviar la cotización.",
          updatedAt: now,
        });
        await offlineDb.offlineQuotes.update(quote.localId, {
          whatsappStatus: "FAILED",
          whatsappError: result.error ?? "No se pudo enviar la cotización.",
          updatedAt: now,
        });
      });
      failed += 1;
    } catch {
      await offlineDb.offlineWhatsAppTasks.update(task.localId, {
        attempts: task.attempts + 1,
        lastAttemptAt: now,
        lastError: "No se pudo conectar para enviar por WhatsApp.",
        updatedAt: now,
      });
      await offlineDb.offlineQuotes.update(quote.localId, {
        whatsappStatus: "PENDING",
        whatsappError: "No se pudo conectar para enviar por WhatsApp.",
        updatedAt: now,
      });
      pending += 1;
    }
  }

  return { sent, pending, failed };
}
