import { loadQuoteItems } from "@/lib/quotes/load-items";
import { notFound } from "next/navigation";

import { AdminNav } from "@/components/admin-nav";
import { QuoteDetailCard } from "@/components/quote-detail-card";
import { requireRole } from "@/lib/auth/require-role";
import { asCatalogNumber } from "@/lib/seller-catalog";
import { createClient } from "@/lib/supabase/server";

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

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
      "folio, customer_id, salesperson_name_snapshot, status, machine_name_snapshot, machine_base_price_snapshot, machine_number_of_bases_snapshot, machine_image_url_snapshot, machine_variant_type_snapshot, machine_variant_name_snapshot, machine_variant_price_snapshot, machine_variant_description_snapshot, delivery_type, delivery_note, subtotal, subtotal_before_tax_snapshot, tax_rate_snapshot, tax_amount_snapshot, discount_amount, coupon_code_snapshot, coupon_name_snapshot, coupon_discount_type_snapshot, coupon_discount_value_snapshot, notes, total, created_at"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    throw new Error("No se pudo cargar la cotización.");
  }

  if (!quote) {
    notFound();
  }

  const [customerResult, addonsResult, whatsappResult] = await Promise.all([
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

  if (customerResult.error || addonsResult.error || whatsappResult.error) {
    throw new Error("No se pudieron cargar los detalles de la cotización.");
  }

  if (!customerResult.data) {
    notFound();
  }

  const items = await loadQuoteItems(supabase, quoteId);

  return (
    <div className="min-h-screen bg-background">
      <AdminNav active="quotes" userName={profile.full_name} />
      <QuoteDetailCard items={items}
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
          machineVariantType: quote.machine_variant_type_snapshot,
          machineVariantName: quote.machine_variant_name_snapshot,
          machineVariantPrice: quote.machine_variant_price_snapshot === null ? null : asNumber(quote.machine_variant_price_snapshot),
          machineVariantDescription: quote.machine_variant_description_snapshot,
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
          subtotalBeforeTax: quote.subtotal_before_tax_snapshot === null ? null : asCatalogNumber(quote.subtotal_before_tax_snapshot),
          taxRate: quote.tax_rate_snapshot === null ? null : asNumber(quote.tax_rate_snapshot),
          taxAmount: quote.tax_amount_snapshot === null ? null : asCatalogNumber(quote.tax_amount_snapshot),
        }}
        sellerName={quote.salesperson_name_snapshot ?? "Vendedor"}
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
