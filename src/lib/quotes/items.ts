import type { QuotePdfSnapshot, QuotePdfItem } from "../pdf/quote-pdf-types";

export type QuoteItemInput = {
  machineId: string;
  machineVariantId: string | null;
  quantity: number;
  /** Add-on quantities per machine. Server expands all types by machine quantity. */
  addonQuantities: Record<string, number>;
  deliveryType?: "SHIPPING" | "INSTALLATION" | "LATER";
};

export function rpcItems(items: QuoteItemInput[]) {
  return items.map((item) => ({
    machine_id: item.machineId,
    machine_variant_id: item.machineVariantId,
    quantity: item.quantity,
    addon_quantities: item.addonQuantities,
    delivery_type: item.deliveryType ?? "LATER",
  }));
}

/** Historical snapshots never consult today's catalog. */
export function snapshotItems(snapshot: QuotePdfSnapshot): QuotePdfItem[] {
  return snapshot.items?.length ? snapshot.items : [{
    machine: snapshot.machine, quantity: 1, addons: snapshot.addons,
    lineGrossTotal: snapshot.subtotal, delivery: snapshot.delivery,
  }];
}
