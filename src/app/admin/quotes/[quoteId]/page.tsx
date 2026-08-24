import { notFound } from "next/navigation";

import { AdminNav } from "@/components/admin-nav";
import { QuoteDetailCard } from "@/components/quote-detail-card";
import { requireRole } from "@/lib/auth/require-role";
import { asCatalogNumber } from "@/lib/seller-catalog";
import { createClient } from "@/lib/supabase/server";

type AdminQuoteDetailPageProps = {
  params: Promise<{ quoteId: string }>;
};

export default async function AdminQuoteDetailPage({
  params,
}: AdminQuoteDetailPageProps) {
  const [{ quoteId }, profile] = await Promise.all([
    params,
    requireRole("admin"),
  ]);
  const supabase = await createClient();
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "folio, customer_id, seller_id, status, machine_name_snapshot, machine_base_price_snapshot, machine_number_of_bases_snapshot, machine_image_url_snapshot, delivery_type, delivery_note, subtotal, discount_amount, coupon_code_snapshot, coupon_name_snapshot, coupon_discount_type_snapshot, coupon_discount_value_snapshot, notes, total, created_at"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    throw new Error("No se pudo cargar la cotización.");
  }

  if (!quote) {
    notFound();
  }

  const [customerResult, sellerResult, addonsResult, whatsappResult] = await Promise.all([
    supabase
      .from("customers")
      .select("name, company, whatsapp, email")
      .eq("id", quote.customer_id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", quote.seller_id)
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

  if (customerResult.error || sellerResult.error || addonsResult.error || whatsappResult.error) {
    throw new Error("No se pudieron cargar los detalles de la cotización.");
  }

  if (!customerResult.data) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminNav active="quotes" userName={profile.full_name} />
      <QuoteDetailCard
        addons={(addonsResult.data ?? []).map((addon) => ({
          id: addon.id,
          addonName: addon.addon_name_snapshot,
          description: addon.description_snapshot,
          calculationType: addon.calculation_type_snapshot,
          unitPrice: asCatalogNumber(addon.unit_price_snapshot),
          quantity: addon.quantity,
          lineTotal: asCatalogNumber(addon.line_total),
        }))}
        backHref="/admin/quotes"
        backLabel="Cotizaciones"
        customer={customerResult.data}
        quote={{
          folio: quote.folio,
          status: quote.status,
          createdAt: quote.created_at,
          machineName: quote.machine_name_snapshot,
          machineBasePrice: asCatalogNumber(quote.machine_base_price_snapshot),
          machineNumberOfBases: quote.machine_number_of_bases_snapshot,
          machineImageUrl: quote.machine_image_url_snapshot,
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
        sellerName={sellerResult.data?.full_name ?? "Vendedor"}
        whatsapp={{
          quoteId,
          status: whatsappResult.data?.status ?? null,
          destination: whatsappResult.data?.customer_whatsapp_snapshot ?? null,
          error: whatsappResult.data?.error_message ?? null,
        }}
      />
    </div>
  );
}
