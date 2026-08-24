import type { QuotePdfAddon, QuotePdfCoupon } from "@/lib/pdf/quote-pdf-types";
import type { SellerAddon, SellerMachine } from "@/lib/seller-catalog";

import type { OfflineCoupon, OfflineMachineAddon } from "./offline-types";

export class OfflineQuoteValidationError extends Error {}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateConfiguration(
  machine: SellerMachine,
  addons: SellerAddon[],
  selectedAddonQuantities: Record<string, number>,
  compatibleRelations: ReadonlyMap<string, OfflineMachineAddon>
) {
  const selectedIds = new Set(Object.keys(selectedAddonQuantities));

  if (Object.values(selectedAddonQuantities).some((quantity) => !Number.isSafeInteger(quantity) || quantity < 1)) {
    throw new OfflineQuoteValidationError("La cantidad de cada add-on debe ser un entero positivo.");
  }

  if (!machine.supportsAddons && selectedIds.size > 0) {
    throw new OfflineQuoteValidationError("La máquina seleccionada no admite add-ons.");
  }

  const selectedAddons = addons.filter((addon) => selectedIds.has(addon.id));

  if (selectedAddons.length !== selectedIds.size) {
    throw new OfflineQuoteValidationError("Uno de los add-ons ya no está disponible sin conexión.");
  }

  if (selectedAddons.some((addon) => !compatibleRelations.has(addon.id))) {
    throw new OfflineQuoteValidationError("Uno de los add-ons no es compatible con esta máquina.");
  }

  if (addons.some((addon) => addon.required && !selectedIds.has(addon.id))) {
    throw new OfflineQuoteValidationError("Falta un add-on obligatorio.");
  }

  const quoteAddons: QuotePdfAddon[] = selectedAddons.map((addon) => {
    if (addon.calculationType === "PER_BASE" && machine.numberOfBases === null) {
      throw new OfflineQuoteValidationError(
        "Este add-on requiere una máquina con número de bases."
      );
    }

    const requestedQuantity = selectedAddonQuantities[addon.id];
    if (addon.calculationType !== "QUANTITY" && requestedQuantity !== 1) {
      throw new OfflineQuoteValidationError("Los add-ons fijos y por base se seleccionan una sola vez.");
    }

    const quantity = addon.calculationType === "PER_BASE" ? machine.numberOfBases! : requestedQuantity;
    const relation = compatibleRelations.get(addon.id);
    const unitPrice = relation?.unitPriceOverride ?? addon.unitPrice;
    const lineTotal = money(unitPrice * quantity);

    return {
      id: addon.id,
      name: addon.name,
      calculationType: addon.calculationType,
      description: relation?.descriptionOverride ?? addon.description,
      unitPrice: money(unitPrice),
      quantity,
      lineTotal,
    };
  });

  const subtotal = money(
    machine.basePrice + quoteAddons.reduce((total, addon) => total + addon.lineTotal, 0)
  );

  return { quoteAddons, subtotal };
}

export function validateOfflineCoupon(
  coupon: OfflineCoupon,
  machineId: string,
  couponMachineIds: ReadonlySet<string>,
  subtotal: number,
  now = new Date()
): QuotePdfCoupon {
  if (!coupon.active) {
    throw new OfflineQuoteValidationError("Cupón inactivo.");
  }

  if (coupon.startsAt && now < new Date(coupon.startsAt)) {
    throw new OfflineQuoteValidationError("Cupón todavía no está activo.");
  }

  if (coupon.endsAt && now > new Date(coupon.endsAt)) {
    throw new OfflineQuoteValidationError("Cupón vencido.");
  }

  if (!coupon.appliesToAllMachines && !couponMachineIds.has(machineId)) {
    throw new OfflineQuoteValidationError("Cupón no válido para esta máquina.");
  }

  const discountAmount = coupon.discountType === "PERCENTAGE"
    ? money(subtotal * coupon.discountValue / 100)
    : money(Math.min(coupon.discountValue, subtotal));

  return {
    code: coupon.code,
    name: coupon.name,
    discountType: coupon.discountType,
    discountValue: money(coupon.discountValue),
    discountAmount,
  };
}
