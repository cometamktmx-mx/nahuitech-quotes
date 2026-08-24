import { notFound } from "next/navigation";

import { QuoteDetailCard } from "@/components/quote-detail-card";
import { SellerShellHeader } from "@/components/seller-shell-header";
import { SellerOfflineProvider } from "@/components/seller-offline-provider";
import { requireSellerFlowRole } from "@/lib/auth/require-role";
import { asCatalogNumber } from "@/lib/seller-catalog";
import { createClient } from "@/lib/supabase/server";

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

type SellerQuoteDetailPageProps = {
  params: Promise<{ quoteId: string }>;
};

export default async function SellerQuoteDetailPage({
  params,
}: SellerQuoteDetailPageProps) {
  const [{ quoteId }, profile] = await Promise.all([
    params,
    requireSellerFlowRole(),
  ]);
  const supabase = await createClient();
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "folio, customer_id, salesperson_name_snapshot, status, machine_name_snapshot, machine_base_price_snapshot, machine_number_of_bases_snapshot, machine_image_url_snapshot, machine_variant_type_snapshot, machine_variant_name_snapshot, machine_variant_price_snapshot, delivery_type, delivery_note, subtotal, discount_amount, coupon_code_snapshot, coupon_name_snapshot, coupon_discount_type_snapshot, coupon_discount_value_snapshot, notes, total, created_at"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    throw new Error("No se pudo cargar la cotización.");
  }

  if (!quote) {
    notFound();
  }

  const [
    { data: customer, error: customerError },
    { data: addonRows, error: addonsError },
    { data: whatsappMessage, error: whatsappError },
  ] =
    await Promise.all([
      supabase
        .from("customers")
        .select("name, company, whatsapp, email")
        .eq("id", quote.customer_id)
        .maybeSingle(),
      supabase
        .from("quote_addons")
        .select(
          "id, addon_name_snapshot, description_snapshot, calculation_type_snapshot, unit_price_snapshot, quantity, line_total"
        )
        .eq("quote_id", quoteId)
        .order("created_at"),
      supabase
        .from("whatsapp_messages")
        .select("status, customer_whatsapp_snapshot, error_message")
        .eq("quote_id", quoteId)
        .maybeSingle(),
    ]);

  if (customerError || addonsError || whatsappError) {
    throw new Error("No se pudieron cargar los detalles de la cotización.");
  }

  if (!customer) {
    notFound();
  }

  return (
    <SellerOfflineProvider>
      <div className="min-h-screen bg-background">
        <SellerShellHeader userName={profile.full_name} />
        <QuoteDetailCard
        addons={(addonRows ?? []).map((addon) => ({
          id: addon.id,
          addonName: addon.addon_name_snapshot,
          description: addon.description_snapshot,
          calculationType: addon.calculation_type_snapshot,
          unitPrice: asCatalogNumber(addon.unit_price_snapshot),
          quantity: addon.quantity,
          lineTotal: asCatalogNumber(addon.line_total),
        }))}
        backHref="/seller/quotes"
        backLabel="Tus cotizaciones"
        customer={customer}
        quote={{
          folio: quote.folio,
          status: quote.status,
          createdAt: quote.created_at,
          machineName: quote.machine_name_snapshot,
          machineBasePrice: asCatalogNumber(quote.machine_base_price_snapshot),
          machineNumberOfBases: quote.machine_number_of_bases_snapshot,
          machineImageUrl: quote.machine_image_url_snapshot,
          machineVariantType: quote.machine_variant_type_snapshot,
          machineVariantName: quote.machine_variant_name_snapshot,
          machineVariantPrice: quote.machine_variant_price_snapshot === null ? null : asNumber(quote.machine_variant_price_snapshot),
          deliveryType: quote.delivery_type,
          deliveryNote: quote.delivery_note,
          subtotal: asCatalogNumber(quote.subtotal),
          discountAmount: asCatalogNumber(quote.discount_amount),
          couponCode: quote.coupon_code_snapshot,
          couponName: quote.coupon_name_snapshot,
          couponDiscountType: quote.coupon_discount_type_snapshot,
          couponDiscountValue: quote.coupon_discount_value_snapshot === null ? null : asCatalogNumber(quote.coupon_discount_value_snapshot),
          notes: quote.notes,
          total: asCatalogNumber(quote.total),
        }}
        sellerName={quote.salesperson_name_snapshot ?? "Vendedor"}
        whatsapp={{
          quoteId,
          status: whatsappMessage?.status ?? null,
          destination: whatsappMessage?.customer_whatsapp_snapshot ?? null,
          error: whatsappMessage?.error_message ?? null,
        }}
        />
      </div>
    </SellerOfflineProvider>
  );
}
