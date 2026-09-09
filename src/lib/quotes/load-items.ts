import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuotePdfItem } from "../pdf/quote-pdf-types";

export async function loadQuoteItems(client: SupabaseClient, quoteId: string): Promise<QuotePdfItem[]> {
  const [{ data, error }, { data: addonRows, error: addonError }] = await Promise.all([
    client.from("quote_items").select("*").eq("quote_id", quoteId).order("sort_order"),
    client.from("quote_addons").select("*").eq("quote_id", quoteId).not("quote_item_id", "is", null).order("created_at"),
  ]);
  if (error || addonError) throw new Error(`No se pudieron cargar los equipos: ${error?.message ?? addonError?.message}`);
  const addonsByItem = new Map<string, Record<string, unknown>[]>();
  for (const addon of addonRows ?? []) {
    const key = String(addon.quote_item_id);
    addonsByItem.set(key, [...(addonsByItem.get(key) ?? []), addon as Record<string, unknown>]);
  }
  return (data ?? []).map((item) => ({
    id: item.id,
    machine: {
      name: item.machine_name_snapshot,
      basePrice: Number(item.unit_gross_snapshot),
      imageUrl: item.machine_image_url_snapshot,
      numberOfBases: item.machine_number_of_bases_snapshot,
      variant: item.machine_variant_type_snapshot ? {
        type: item.machine_variant_type_snapshot,
        name: item.machine_variant_name_snapshot,
        price: Number(item.machine_variant_price_snapshot),
        description: item.machine_variant_description_snapshot,
      } : null,
    },
    quantity: item.quantity,
    lineGrossTotal: Number(item.line_gross_total),
    delivery: { type: item.delivery_type, note: item.delivery_type === "LATER" ? "Por definir" : "Por cotizar" },
    addons: (addonsByItem.get(String(item.id)) ?? []).map((addon) => ({
      id: String(addon.id), name: String(addon.addon_name_snapshot),
      description: addon.description_snapshot as string | null,
      calculationType: addon.calculation_type_snapshot as "FIXED" | "PER_BASE" | "QUANTITY",
      unitPrice: Number(addon.unit_price_snapshot), quantity: Number(addon.quantity),
      lineTotal: Number(addon.line_total),
    })),
  }));
}
