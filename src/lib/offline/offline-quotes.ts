"use client";

import type { QuotePdfSnapshot } from "@/lib/pdf/quote-pdf-types";

import { offlineDb } from "./offline-db";
import { calculateConfiguration, OfflineQuoteValidationError, validateOfflineCoupon } from "./quote-calculation";
import type { OfflineCustomer, OfflineQuote, SyncQueueEntry } from "./offline-types";

type OfflineQuoteInput = {
  sellerId: string;
  machineId: string;
  addonQuantities: Record<string, number>;
  customerName: string;
  customerCompany: string;
  customerWhatsapp: string;
  customerEmail: string;
  deliveryType: "SHIPPING" | "INSTALLATION" | "LATER";
  couponCode: string;
};

function roundedMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function newUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new OfflineQuoteValidationError(
      "Este navegador no puede generar un identificador seguro para la cotización offline."
    );
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createOfflineFolio(now = new Date()) {
  const datePart = [
    String(now.getFullYear()).slice(-2),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const segment = newUuid().replaceAll("-", "").slice(0, 6).toUpperCase();

  return `NH-${datePart}-${segment}`;
}

function requiredText(value: string, label: string) {
  const text = value.trim();
  if (!text) throw new OfflineQuoteValidationError(`${label} es obligatorio.`);
  return text;
}

function optionalText(value: string) {
  return value.trim() || null;
}

function normalizedWhatsapp(value: string) {
  const normalized = value.replace(/\D/g, "");
  if (normalized.length < 7 || normalized.length > 15) {
    throw new OfflineQuoteValidationError("WhatsApp debe tener entre 7 y 15 dígitos.");
  }
  return normalized;
}

function normalizedEmail(value: string) {
  const email = optionalText(value)?.toLowerCase() ?? null;
  if (email && !email.includes("@")) {
    throw new OfflineQuoteValidationError("El correo no es válido.");
  }
  return email;
}

function deliveryNote(type: OfflineQuoteInput["deliveryType"]) {
  if (type === "LATER") return "Por definir";
  return "Por cotizar";
}

function addonIdsFromQuantities(addonQuantities: Record<string, number>) {
  return Object.keys(addonQuantities);
}

function validateDeliveryPolicy(
  machine: { deliveryPolicy: "FLEXIBLE" | "INSTALLATION_REQUIRED" | "SHIPPING_ONLY" },
  deliveryType: OfflineQuoteInput["deliveryType"]
) {
  if (machine.deliveryPolicy === "INSTALLATION_REQUIRED" && deliveryType !== "INSTALLATION") {
    throw new OfflineQuoteValidationError("Esta mÃ¡quina requiere instalaciÃ³n.");
  }
  if (machine.deliveryPolicy === "SHIPPING_ONLY" && deliveryType !== "SHIPPING") {
    throw new OfflineQuoteValidationError("Esta mÃ¡quina requiere envÃ­o.");
  }
}

async function loadOfflineConfiguration(machineId: string, addonQuantities: Record<string, number>) {
  const [machine, relations] = await Promise.all([
    offlineDb.machines.get(machineId),
    offlineDb.machineAddons.where("machineId").equals(machineId).toArray(),
  ]);

  if (!machine || !machine.active) {
    throw new OfflineQuoteValidationError("La máquina no está disponible en el catálogo local.");
  }

  const addonIds = addonIdsFromQuantities(addonQuantities);
  const addons = await offlineDb.addons.bulkGet(addonIds);
  const activeAddons = addons.filter((addon): addon is NonNullable<typeof addon> => Boolean(addon?.active));
  const compatibleRelations = new Map(
    relations
      .filter((relation) => relation.active)
      .map((relation) => [relation.addonId, relation] as const)
  );

  return {
    machine,
    configuration: calculateConfiguration(machine, activeAddons, addonQuantities, compatibleRelations),
  };
}

export async function previewOfflineCoupon({
  machineId,
  addonQuantities,
  couponCode,
}: Pick<OfflineQuoteInput, "machineId" | "addonQuantities" | "couponCode">) {
  const normalizedCode = couponCode.trim().toUpperCase();
  if (!normalizedCode) throw new OfflineQuoteValidationError("Ingresa un código de cupón.");

  const [{ machine, configuration }, storedCoupon] = await Promise.all([
    loadOfflineConfiguration(machineId, addonQuantities),
    offlineDb.coupons.where("code").equals(normalizedCode).first(),
  ]);

  if (!storedCoupon) {
    throw new OfflineQuoteValidationError("Código no encontrado en el catálogo offline.");
  }

  const couponMachines = await offlineDb.couponMachines
    .where("couponId")
    .equals(storedCoupon.id)
    .toArray();
  const coupon = validateOfflineCoupon(
    storedCoupon,
    machine.id,
    new Set(couponMachines.map((relation) => relation.machineId)),
    configuration.subtotal
  );

  return {
    subtotal: configuration.subtotal,
    discountAmount: coupon.discountAmount,
    total: roundedMoney(configuration.subtotal - coupon.discountAmount),
    couponCode: coupon.code,
    couponName: coupon.name,
    couponDiscountType: coupon.discountType,
    couponDiscountValue: coupon.discountValue,
  };
}

export async function createOfflineQuote(input: OfflineQuoteInput) {
  const [profile, loadedConfiguration] = await Promise.all([
    offlineDb.sellerProfiles.get(input.sellerId),
    loadOfflineConfiguration(input.machineId, input.addonQuantities),
  ]);

  if (!profile || !profile.active || profile.role !== "seller") {
    throw new OfflineQuoteValidationError(
      "Necesitas una sesión de vendedor preparada en este dispositivo para cotizar sin conexión."
    );
  }

  const { machine, configuration } = loadedConfiguration;
  validateDeliveryPolicy(machine, input.deliveryType);

  let coupon = null;
  const couponCode = input.couponCode.trim().toUpperCase();

  if (couponCode) {
    const storedCoupon = await offlineDb.coupons.where("code").equals(couponCode).first();
    if (!storedCoupon) {
      throw new OfflineQuoteValidationError("Código no encontrado en el catálogo offline.");
    }

    const couponMachines = await offlineDb.couponMachines
      .where("couponId")
      .equals(storedCoupon.id)
      .toArray();
    coupon = validateOfflineCoupon(
      storedCoupon,
      machine.id,
      new Set(couponMachines.map((relation) => relation.machineId)),
      configuration.subtotal
    );
  }

  const createdAt = new Date().toISOString();
  const localId = newUuid();
  const clientGeneratedId = newUuid();
  const customer: OfflineCustomer = {
    localId: newUuid(),
    sellerId: input.sellerId,
    name: requiredText(input.customerName, "El nombre"),
    company: optionalText(input.customerCompany),
    whatsapp: normalizedWhatsapp(input.customerWhatsapp),
    email: normalizedEmail(input.customerEmail),
    createdAt,
  };
  const total = roundedMoney(configuration.subtotal - (coupon?.discountAmount ?? 0));
  const pdfSnapshot: QuotePdfSnapshot = {
    folio: createOfflineFolio(new Date(createdAt)),
    createdAt,
    customer: {
      name: customer.name,
      company: customer.company,
      whatsapp: customer.whatsapp,
      email: customer.email,
    },
    sellerName: profile.fullName,
    machine: {
      name: machine.name,
      basePrice: machine.basePrice,
      numberOfBases: machine.numberOfBases,
      imageUrl: machine.imageUrl,
    },
    addons: configuration.quoteAddons,
    subtotal: configuration.subtotal,
    discountAmount: coupon?.discountAmount ?? 0,
    total,
    coupon,
    delivery: {
      type: input.deliveryType,
      note: deliveryNote(input.deliveryType),
    },
    notes: null,
  };
  const quote: OfflineQuote = {
    localId,
    clientGeneratedId,
    sellerId: input.sellerId,
    customerLocalId: customer.localId,
    folio: pdfSnapshot.folio,
    machineId: machine.id,
    selectedAddonQuantities: { ...input.addonQuantities },
    couponCode: coupon?.code ?? null,
    deliveryType: input.deliveryType,
    syncStatus: "PENDING",
    syncError: null,
    remoteId: null,
    whatsappStatus: "NONE",
    whatsappError: null,
    createdAt,
    updatedAt: createdAt,
    pdfSnapshot,
  };
  const queueEntry: SyncQueueEntry = {
    localId,
    quoteLocalId: localId,
    sellerId: input.sellerId,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    createdAt,
    updatedAt: createdAt,
  };

  await offlineDb.transaction(
    "rw",
    [offlineDb.offlineCustomers, offlineDb.offlineQuotes, offlineDb.syncQueue],
    async () => {
      await offlineDb.offlineCustomers.put(customer);
      await offlineDb.offlineQuotes.put(quote);
      await offlineDb.syncQueue.put(queueEntry);
    }
  );

  return quote;
}

export async function listOfflineQuotes(sellerId: string) {
  const quotes = await offlineDb.offlineQuotes.where("sellerId").equals(sellerId).toArray();
  return quotes.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getOfflineQuote(localId: string) {
  return offlineDb.offlineQuotes.get(localId);
}

export async function getPendingOfflineQuoteCount(sellerId: string) {
  const quotes = await offlineDb.offlineQuotes.where("sellerId").equals(sellerId).toArray();
  return quotes.filter((quote) => quote.syncStatus === "PENDING").length;
}
