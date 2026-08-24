"use server";

import { revalidatePath } from "next/cache";

import { getSellerClient } from "@/lib/auth/get-seller-client";
import type { QuotePdfSnapshot } from "@/lib/pdf/quote-pdf-types";

type DeliveryType = "SHIPPING" | "INSTALLATION" | "LATER";

type CreateQuoteInput = {
  machineId: string;
  addonQuantities: Record<string, number>;
  customerName: string;
  customerCompany: string;
  customerWhatsapp: string;
  customerEmail: string;
  deliveryType: DeliveryType;
  couponCode: string;
  clientGeneratedId?: string;
  clientGeneratedFolio?: string;
  machineImageUrlSnapshot?: string | null;
};

export type CreateQuoteResult = {
  error?: string;
  retryable?: boolean;
  quoteId?: string;
  folio?: string;
  total?: number;
  pdfSnapshot?: QuotePdfSnapshot;
};

export type CouponPreviewResult = {
  error?: string;
  retryable?: boolean;
  subtotal?: number;
  discountAmount?: number;
  total?: number;
  couponCode?: string;
  couponName?: string;
  couponDiscountType?: "FIXED_AMOUNT" | "PERCENTAGE";
  couponDiscountValue?: number;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ValidationError extends Error {}

function requiredText(value: unknown, fieldName: string) {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text) {
    throw new ValidationError(`${fieldName} es obligatorio.`);
  }

  return text;
}

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validateConfiguration(machineId: unknown, addonQuantities: unknown) {
  if (typeof machineId !== "string" || !uuidPattern.test(machineId)) {
    throw new ValidationError("La máquina seleccionada no es válida.");
  }

  if (typeof addonQuantities !== "object" || addonQuantities === null || Array.isArray(addonQuantities)) {
    throw new ValidationError("La configuración de add-ons no es válida.");
  }

  for (const [addonId, quantity] of Object.entries(addonQuantities)) {
    if (!uuidPattern.test(addonId) || !Number.isSafeInteger(quantity) || quantity < 1) {
      throw new ValidationError("Uno de los add-ons o su cantidad no es válido.");
    }
  }
}

function validateMachineImageUrlSnapshot(value: unknown) {
  if (value === undefined || value === null || value === "") return null;

  if (
    typeof value !== "string" ||
    !/^\/machines\/[a-z0-9-]+\.(?:png|jpe?g)$/i.test(value)
  ) {
    throw new ValidationError("La imagen de la máquina no es válida.");
  }

  return value;
}

function couponErrorMessage(error: unknown) {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  const message = rawMessage.toLowerCase();

  if (message.includes("coupon code was not found")) return "Código no encontrado.";
  if (message.includes("coupon is inactive")) return "Cupón inactivo.";
  if (message.includes("coupon is not active yet")) return "Cupón todavía no está activo.";
  if (message.includes("coupon has expired")) return "Cupón vencido.";
  if (message.includes("coupon is not valid for the selected machine")) {
    return "Cupón no válido para esta máquina.";
  }

  return null;
}

function validateInput(input: CreateQuoteInput) {
  validateConfiguration(input.machineId, input.addonQuantities);

  requiredText(input.customerName, "El nombre");
  requiredText(input.customerWhatsapp, "WhatsApp");

  if (!(["SHIPPING", "INSTALLATION", "LATER"] as const).includes(input.deliveryType)) {
    throw new ValidationError("El tipo de entrega no es válido.");
  }

  if (input.clientGeneratedId && !uuidPattern.test(input.clientGeneratedId)) {
    throw new ValidationError("El identificador local de la cotización no es válido.");
  }

  if (
    input.clientGeneratedFolio &&
    !/^NH-[0-9]{6}-[A-F0-9]{6}$/.test(input.clientGeneratedFolio)
  ) {
    throw new ValidationError("El folio local de la cotización no es válido.");
  }
}

function isRetryableInfrastructureError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return ["fetch failed", "network", "timeout", "connection", "temporarily unavailable"].some(
    (fragment) => message.includes(fragment)
  );
}

async function loadCreatedQuotePdfSnapshot(
  supabase: Awaited<ReturnType<typeof getSellerClient>>,
  quoteId: string
): Promise<QuotePdfSnapshot | undefined> {
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "folio, customer_id, seller_id, machine_name_snapshot, machine_base_price_snapshot, machine_number_of_bases_snapshot, machine_image_url_snapshot, delivery_type, delivery_note, subtotal, discount_amount, coupon_code_snapshot, coupon_name_snapshot, coupon_discount_type_snapshot, coupon_discount_value_snapshot, notes, total, created_at"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError || !quote) return undefined;

  const [customerResult, sellerResult, addonsResult] = await Promise.all([
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
  ]);

  if (customerResult.error || sellerResult.error || addonsResult.error || !customerResult.data) {
    return undefined;
  }

  const asNumber = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  const couponDiscountValue = quote.coupon_discount_value_snapshot === null
    ? null
    : asNumber(quote.coupon_discount_value_snapshot);

  return {
    folio: quote.folio,
    createdAt: quote.created_at,
    customer: customerResult.data,
    sellerName: sellerResult.data?.full_name ?? null,
    machine: {
      name: quote.machine_name_snapshot,
      basePrice: asNumber(quote.machine_base_price_snapshot),
      numberOfBases: quote.machine_number_of_bases_snapshot,
      imageUrl: quote.machine_image_url_snapshot,
    },
    addons: (addonsResult.data ?? []).map((addon) => ({
      id: addon.id,
      name: addon.addon_name_snapshot,
      description: addon.description_snapshot,
      calculationType: addon.calculation_type_snapshot,
      unitPrice: asNumber(addon.unit_price_snapshot),
      quantity: addon.quantity,
      lineTotal: asNumber(addon.line_total),
    })),
    subtotal: asNumber(quote.subtotal),
    discountAmount: asNumber(quote.discount_amount),
    total: asNumber(quote.total),
    coupon:
      quote.coupon_code_snapshot &&
      quote.coupon_name_snapshot &&
      quote.coupon_discount_type_snapshot &&
      couponDiscountValue !== null
        ? {
            code: quote.coupon_code_snapshot,
            name: quote.coupon_name_snapshot,
            discountType: quote.coupon_discount_type_snapshot,
            discountValue: couponDiscountValue,
            discountAmount: asNumber(quote.discount_amount),
          }
        : null,
    delivery: {
      type: quote.delivery_type,
      note: quote.delivery_note,
    },
    notes: quote.notes,
  };
}

export async function validateCoupon(
  input: Pick<CreateQuoteInput, "machineId" | "addonQuantities" | "couponCode">
): Promise<CouponPreviewResult> {
  try {
    validateConfiguration(input.machineId, input.addonQuantities);
    const couponCode = optionalText(input.couponCode).toUpperCase();

    if (!couponCode) {
      throw new ValidationError("Ingresa un código de cupón.");
    }

    if (!/^[A-Z0-9-]+$/.test(couponCode) || couponCode.length > 64) {
      throw new ValidationError("El código de cupón no es válido.");
    }

    const supabase = await getSellerClient();
    const { data, error } = await supabase.rpc("preview_quote_coupon", {
      p_machine_id: input.machineId,
      p_addon_quantities: input.addonQuantities,
      p_coupon_code: couponCode,
    });
    const preview = Array.isArray(data) ? data[0] : null;

    if (error) {
      throw error;
    }

    if (!preview || typeof preview.coupon_code !== "string" || typeof preview.coupon_name !== "string") {
      throw new Error("La respuesta del cupón no es válida.");
    }

    const subtotal = Number(preview.subtotal);
    const discountAmount = Number(preview.discount_amount);
    const total = Number(preview.total);
    const discountValue = Number(preview.coupon_discount_value);

    if (
      !Number.isFinite(subtotal) ||
      !Number.isFinite(discountAmount) ||
      !Number.isFinite(total) ||
      !Number.isFinite(discountValue) ||
      (preview.coupon_discount_type !== "FIXED_AMOUNT" && preview.coupon_discount_type !== "PERCENTAGE")
    ) {
      throw new Error("La respuesta del cupón no es válida.");
    }

    return {
      subtotal,
      discountAmount,
      total,
      couponCode: preview.coupon_code,
      couponName: preview.coupon_name,
      couponDiscountType: preview.coupon_discount_type,
      couponDiscountValue: discountValue,
    };
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.message };
    return {
      error: couponErrorMessage(error) ?? "No se pudo validar el cupón.",
      retryable: isRetryableInfrastructureError(error),
    };
  }
}

export async function createQuote(
  input: CreateQuoteInput
): Promise<CreateQuoteResult> {
  try {
    validateInput(input);

    const supabase = await getSellerClient();
    const { data, error } = await supabase.rpc("create_quote", {
      p_machine_id: input.machineId,
      p_addon_quantities: input.addonQuantities,
      p_customer_name: requiredText(input.customerName, "El nombre"),
      p_customer_company: optionalText(input.customerCompany) || null,
      p_customer_whatsapp: requiredText(input.customerWhatsapp, "WhatsApp"),
      p_customer_email: optionalText(input.customerEmail) || null,
      p_delivery_type: input.deliveryType,
      p_coupon_code: optionalText(input.couponCode).toUpperCase() || null,
      p_client_generated_id: input.clientGeneratedId ?? null,
      p_client_generated_folio: input.clientGeneratedFolio ?? null,
      p_machine_image_url_snapshot: validateMachineImageUrlSnapshot(input.machineImageUrlSnapshot),
    });

    const quote = Array.isArray(data) ? data[0] : null;

    if (error) {
      throw error;
    }

    if (!quote || typeof quote.quote_id !== "string") {
      throw new Error("No se pudo crear la cotización.");
    }

    const total = Number(quote.total);

    if (!Number.isFinite(total) || typeof quote.folio !== "string") {
      throw new Error("La cotización creada no es válida.");
    }

    revalidatePath("/seller");
    revalidatePath("/seller/quotes");
    revalidatePath("/admin/quotes");
    const pdfSnapshot = await loadCreatedQuotePdfSnapshot(supabase, quote.quote_id);

    return {
      quoteId: quote.quote_id,
      folio: quote.folio,
      total,
      pdfSnapshot,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { error: error.message };
    }

    return {
      error:
        couponErrorMessage(error) ??
        "No se pudo crear la cotización. Revisa que la máquina y los add-ons sigan disponibles.",
      retryable: isRetryableInfrastructureError(error),
    };
  }
}
