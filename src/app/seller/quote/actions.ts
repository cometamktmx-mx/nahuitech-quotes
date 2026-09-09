"use server";

import { revalidatePath } from "next/cache";

import { getSellerClient } from "@/lib/auth/get-seller-client";
import type { QuotePdfSnapshot } from "@/lib/pdf/quote-pdf-types";
import { calculateIncludedTaxBreakdown } from "@/lib/quotes/tax";

import { rpcItems, type QuoteItemInput } from "@/lib/quotes/items";
import { loadQuoteItems } from "@/lib/quotes/load-items";

type DeliveryType = "SHIPPING" | "INSTALLATION" | "LATER";

type CreateQuoteInput = {
  items?: QuoteItemInput[];
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
  machineVariantId?: string | null;
  salespersonId?: string | null;
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

function isMachineStorageUrl(value: string) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  try {
    const url = new URL(value);
    return url.origin === new URL(base).origin && /^\/storage\/v1\/object\/public\/machine-images\/machines\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}

function validateMachineImageUrlSnapshot(value: unknown) {
  if (value === undefined || value === null || value === "") return null;

  if (
    typeof value !== "string" ||
    (!/^\/machines\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/i.test(value) && !isMachineStorageUrl(value))
  ) {
    throw new ValidationError("La imagen de la máquina no es válida.");
  }

  return value;
}

function couponErrorMessage(error: unknown) {
  const rawMessage = getErrorMessage(error);
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "";
}

function createQuoteErrorMessage(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();

  if (
    message.includes("could not find the function public.create_quote") ||
    (message.includes("schema cache") && message.includes("create_quote"))
  ) {
    return "El servidor de cotizaciones necesita actualizarse. Pide aplicar las migraciones pendientes y vuelve a intentar.";
  }

  if (message.includes("a machine variant is required")) {
    return "Selecciona una versión de la máquina antes de crear la cotización.";
  }

  if (message.includes("selected machine variant is not available")) {
    return "La versión seleccionada ya no está disponible. Vuelve a elegirla.";
  }

  if (message.includes("selected machine does not have variants")) {
    return "La versión seleccionada no corresponde a esta máquina.";
  }

  if (message.includes("selected machine is not available")) {
    return "La máquina seleccionada ya no está disponible.";
  }

  if (message.includes("one or more selected add-ons are not compatible")) {
    return "Uno o más add-ons ya no son compatibles con esta máquina.";
  }

  if (message.includes("a required add-on is missing")) {
    return "Falta un add-on obligatorio para esta configuración.";
  }

  if (message.includes("does not support add-ons")) {
    return "La máquina seleccionada no admite add-ons.";
  }

  if (message.includes("per_base add-on requires")) {
    return "Esta configuración requiere una máquina con número de bases válido.";
  }

  if (message.includes("fixed and per_base add-ons must be selected once")) {
    return "Un add-on fijo o por base tiene una cantidad no válida.";
  }

  if (message.includes("an expo account must select an active salesperson")) {
    return "Selecciona quién está atendiendo antes de crear la cotización.";
  }

  if (message.includes("selected salesperson is not available")) {
    return "El asesor seleccionado ya no está disponible. Elige otro para continuar.";
  }

  if (
    message.includes("individual seller can only use their linked salesperson") ||
    message.includes("linked salesperson is not active")
  ) {
    return "Tu cuenta no tiene un asesor comercial activo vinculado.";
  }

  if (message.includes("installation is required")) {
    return "Esta máquina requiere instalación. La entrega debe quedar como Por cotizar.";
  }

  if (message.includes("shipping is required")) {
    return "Esta máquina requiere envío. La entrega debe quedar como Por cotizar.";
  }

  if (message.includes("only active seller flow accounts can create quotes")) {
    return "Tu sesión no tiene permiso para crear cotizaciones.";
  }

  if (message.includes("failed to find server action")) {
    return "La aplicación se actualizó. Recarga la página e intenta nuevamente.";
  }

  return couponErrorMessage(error);
}

function validateItems(items: QuoteItemInput[]) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) throw new ValidationError("Agrega entre 1 y 100 equipos.");
  for (const item of items) {
    validateConfiguration(item.machineId, item.addonQuantities);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) throw new ValidationError("Cantidad de equipos inválida.");
    if (item.machineVariantId && !uuidPattern.test(item.machineVariantId)) throw new ValidationError("Versión inválida.");
  }
}

function validateInput(input: CreateQuoteInput) {
  validateConfiguration(input.machineId, input.addonQuantities);
  if (input.items) validateItems(input.items);

  requiredText(input.customerName, "El nombre");
  requiredText(input.customerWhatsapp, "WhatsApp");

  if (!(["SHIPPING", "INSTALLATION", "LATER"] as const).includes(input.deliveryType)) {
    throw new ValidationError("El tipo de entrega no es válido.");
  }

  if (input.clientGeneratedId && !uuidPattern.test(input.clientGeneratedId)) {
    throw new ValidationError("El identificador local de la cotización no es válido.");
  }

  if (input.machineVariantId && !uuidPattern.test(input.machineVariantId)) {
    throw new ValidationError("La versión seleccionada no es válida.");
  }

  if (input.salespersonId && !uuidPattern.test(input.salespersonId)) {
    throw new ValidationError("El vendedor seleccionado no es válido.");
  }

  if (
    input.clientGeneratedFolio &&
    !/^NH-[0-9]{6}-[A-F0-9]{6}$/.test(input.clientGeneratedFolio)
  ) {
    throw new ValidationError("El folio local de la cotización no es válido.");
  }
}

async function validateMachineVariantSelection(
  supabase: Awaited<ReturnType<typeof getSellerClient>>,
  machineId: string,
  machineVariantId: string | null | undefined
) {
  const [machineResult, variantsResult] = await Promise.all([
    supabase
      .from("machines")
      .select("allowed_variant_types")
      .eq("id", machineId)
      .maybeSingle(),
    supabase
      .from("machine_variants")
      .select("id, variant_type, active, price")
      .eq("machine_id", machineId),
  ]);

  if (machineResult.error || variantsResult.error || !machineResult.data) {
    throw new Error("No se pudo validar la versión seleccionada.");
  }

  const machine = machineResult.data;
  const machineVariants = (variantsResult.data ?? []).filter((variant) =>
    machine.allowed_variant_types.includes(variant.variant_type)
  );

  if (machineVariants.length === 0) {
    if (machineVariantId) {
      throw new ValidationError("La versión seleccionada no corresponde a esta máquina.");
    }
    return;
  }

  if (!machineVariantId) {
    throw new ValidationError(
      "Selecciona una versión de la máquina antes de crear la cotización."
    );
  }

  const selectedVariant = machineVariants.find(
    (variant) => variant.id === machineVariantId
  );

  if (!selectedVariant) {
    throw new ValidationError("La versión seleccionada no corresponde a esta máquina.");
  }

  const price = Number(selectedVariant.price);
  if (!selectedVariant.active || !Number.isFinite(price) || price <= 0) {
    throw new ValidationError("La versión seleccionada ya no está disponible.");
  }
}

function isRetryableInfrastructureError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
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
      "folio, customer_id, salesperson_name_snapshot, machine_name_snapshot, machine_base_price_snapshot, machine_number_of_bases_snapshot, machine_image_url_snapshot, machine_variant_type_snapshot, machine_variant_name_snapshot, machine_variant_price_snapshot, machine_variant_description_snapshot, delivery_type, delivery_note, subtotal, subtotal_before_tax_snapshot, tax_rate_snapshot, tax_amount_snapshot, discount_amount, coupon_code_snapshot, coupon_name_snapshot, coupon_discount_type_snapshot, coupon_discount_value_snapshot, notes, total, created_at"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError || !quote) return undefined;

  const [customerResult, addonsResult] = await Promise.all([
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
  ]);

  if (customerResult.error || addonsResult.error || !customerResult.data) {
    return undefined;
  }

  const asNumber = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  const couponDiscountValue = quote.coupon_discount_value_snapshot === null
    ? null
    : asNumber(quote.coupon_discount_value_snapshot);
  const historicTax = calculateIncludedTaxBreakdown(asNumber(quote.total));

  return {
    items: await loadQuoteItems(supabase, quoteId),
    folio: quote.folio,
    createdAt: quote.created_at,
    customer: customerResult.data,
    sellerName: quote.salesperson_name_snapshot ?? null,
    machine: {
      name: quote.machine_name_snapshot,
      basePrice: asNumber(quote.machine_base_price_snapshot),
      numberOfBases: quote.machine_number_of_bases_snapshot,
      imageUrl: quote.machine_image_url_snapshot,
      variant: quote.machine_variant_type_snapshot && quote.machine_variant_name_snapshot && quote.machine_variant_price_snapshot !== null ? { type: quote.machine_variant_type_snapshot, name: quote.machine_variant_name_snapshot, price: asNumber(quote.machine_variant_price_snapshot), description: quote.machine_variant_description_snapshot } : null,
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
    tax: quote.subtotal_before_tax_snapshot !== null && quote.tax_rate_snapshot !== null && quote.tax_amount_snapshot !== null
      ? {
          subtotalBeforeTax: asNumber(quote.subtotal_before_tax_snapshot),
          taxRate: asNumber(quote.tax_rate_snapshot),
          taxAmount: asNumber(quote.tax_amount_snapshot),
          totalWithTax: asNumber(quote.total),
        }
      : historicTax,
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
  input: Pick<CreateQuoteInput, "machineId" | "addonQuantities" | "couponCode" | "machineVariantId" | "items">
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
    console.info("[validateCoupon RPC request]", {
      parameterNames: [
        "p_machine_id",
        "p_addon_quantities",
        "p_coupon_code",
        "p_machine_variant_id",
      ],
      machineId: input.machineId,
      machineVariantId: input.machineVariantId ?? null,
      salespersonId: null,
      addonIds: Object.keys(input.addonQuantities),
    });
    const { data, error } = await supabase.rpc(input.items ? "preview_multi_quote_coupon" : "preview_quote_coupon", input.items ? { p_items: rpcItems(input.items), p_coupon_code: couponCode } : {
      p_machine_id: input.machineId,
      p_addon_quantities: input.addonQuantities,
      p_coupon_code: couponCode,
      p_machine_variant_id: input.machineVariantId ?? null,
    });
    const preview = Array.isArray(data) ? data[0] : null;

    if (error) {
      console.error("[validateCoupon RPC error]", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
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
    if (!input.items) await validateMachineVariantSelection(
      supabase,
      input.machineId,
      input.machineVariantId
    );
    console.info("[createQuote RPC request]", {
      parameterNames: [
        "p_machine_id",
        "p_addon_quantities",
        "p_customer_name",
        "p_customer_company",
        "p_customer_whatsapp",
        "p_customer_email",
        "p_delivery_type",
        "p_coupon_code",
        "p_client_generated_id",
        "p_client_generated_folio",
        "p_machine_image_url_snapshot",
        "p_machine_variant_id",
        "p_salesperson_id",
      ],
      machineId: input.machineId,
      machineVariantId: input.machineVariantId ?? null,
      salespersonId: input.salespersonId ?? null,
      addonIds: Object.keys(input.addonQuantities),
    });
    const { data, error } = await supabase.rpc(input.items ? "create_multi_quote" : "create_quote", {
      ...(input.items ? { p_items: rpcItems(input.items) } : {
      p_machine_id: input.machineId,
      p_addon_quantities: input.addonQuantities,
      p_machine_image_url_snapshot: validateMachineImageUrlSnapshot(input.machineImageUrlSnapshot),
      p_machine_variant_id: input.machineVariantId ?? null,
      }),
      p_customer_name: requiredText(input.customerName, "El nombre"),
      p_customer_company: optionalText(input.customerCompany) || null,
      p_customer_whatsapp: requiredText(input.customerWhatsapp, "WhatsApp"),
      p_customer_email: optionalText(input.customerEmail) || null,
      p_delivery_type: input.deliveryType,
      p_coupon_code: optionalText(input.couponCode).toUpperCase() || null,
      p_client_generated_id: input.clientGeneratedId ?? null,
      p_client_generated_folio: input.clientGeneratedFolio ?? null,
      p_salesperson_id: input.salespersonId ?? null,
    });

    const quote = Array.isArray(data) ? data[0] : null;

    if (error) {
      console.error("[createQuote RPC error]", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
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
    const pdfSnapshot = await loadCreatedQuotePdfSnapshot(supabase, quote.quote_id).catch(() => undefined);

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
        createQuoteErrorMessage(error) ??
        "No se pudo crear la cotización. Intenta nuevamente o actualiza la aplicación.",
      retryable: isRetryableInfrastructureError(error),
    };
  }
}
