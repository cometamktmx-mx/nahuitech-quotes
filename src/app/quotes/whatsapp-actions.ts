"use server";

import { revalidatePath } from "next/cache";

import { generateQuotePdfOnServer } from "@/lib/pdf/quote-pdf-server";
import type { QuotePdfSnapshot } from "@/lib/pdf/quote-pdf-types";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminConfiguration,
} from "@/lib/supabase/admin.server";
import { createClient } from "@/lib/supabase/server";
import { normalizeWhatsAppPhone, WhatsAppPhoneValidationError } from "@/lib/whatsapp/phone";
import {
  getTwilioWhatsAppConfiguration,
  sendQuoteWhatsAppWithTwilio,
  TwilioConfigurationError,
} from "@/lib/whatsapp/twilio.server";

type WhatsAppMessageStatus = "PENDING" | "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

export type SendQuoteViaWhatsAppResult = {
  error?: string;
  retryable?: boolean;
  configurationRequired?: boolean;
  status?: WhatsAppMessageStatus;
  destination?: string;
};

type AuthorizedQuote = {
  id: string;
  folio: string;
  customerId: string;
  sellerId: string;
  viewerRole: "admin" | "seller";
};

const quoteIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pdfBucket = "quote-pdfs";
const signedUrlLifetimeSeconds = 60 * 60 * 24;

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asMoney(value: number) {
  return `${new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} MXN`;
}

function isTerminalStatus(status: WhatsAppMessageStatus) {
  return status === "SENT" || status === "DELIVERED" || status === "READ";
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 700);
  }
  return "No se pudo completar el envío por WhatsApp.";
}

function publicSendError(error: unknown) {
  if (error instanceof WhatsAppPhoneValidationError) {
    return { code: "INVALID_PHONE", message: error.message, retryable: false };
  }

  if (error instanceof TwilioConfigurationError) {
    return { code: "CONFIGURATION", message: "El envío por WhatsApp está pendiente de configuración.", retryable: false };
  }

  const message = safeErrorMessage(error).toLowerCase();
  if (/24.?hour|template|content sid|outside.*window/.test(message)) {
    return {
      code: "TEMPLATE_REQUIRED",
      message: "Twilio requiere una plantilla aprobada para enviar este mensaje fuera de la ventana de 24 horas.",
      retryable: false,
    };
  }

  if (/timeout|network|fetch|temporar/.test(message)) {
    return {
      code: "NETWORK",
      message: "No se pudo conectar con WhatsApp. Puedes reintentar.",
      retryable: true,
    };
  }

  return {
    code: "TWILIO_SEND_FAILED",
    message: "Twilio no pudo enviar la cotización. Puedes reintentar.",
    retryable: true,
  };
}

async function getAuthorizedQuote(quoteId: string): Promise<AuthorizedQuote> {
  if (!quoteIdPattern.test(quoteId)) {
    throw new Error("La cotización no es válida.");
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims.sub === "string" ? claimsData.claims.sub : null;

  if (claimsError || !userId) {
    throw new Error("No autorizado.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, active, salesperson_id")
    .eq("id", userId)
    .maybeSingle();

  if (
    profileError ||
    !profile ||
    !profile.active ||
    (profile.role !== "admin" && profile.role !== "seller")
  ) {
    throw new Error("No autorizado.");
  }

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, folio, customer_id, seller_id, salesperson_id")
    .eq("id", quoteId)
    .maybeSingle();

  if (
    quoteError ||
    !quote ||
    (profile.role === "seller" &&
      quote.seller_id !== userId &&
      (!profile.salesperson_id || quote.salesperson_id !== profile.salesperson_id))
  ) {
    throw new Error("No tienes acceso a esta cotización.");
  }

  return {
    id: quote.id,
    folio: quote.folio,
    customerId: quote.customer_id,
    sellerId: quote.seller_id,
    viewerRole: profile.role,
  };
}

async function loadQuoteSnapshot(quoteId: string): Promise<QuotePdfSnapshot> {
  const supabase = createSupabaseAdminClient();
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "folio, customer_id, salesperson_name_snapshot, machine_name_snapshot, machine_base_price_snapshot, machine_number_of_bases_snapshot, machine_image_url_snapshot, machine_variant_type_snapshot, machine_variant_name_snapshot, machine_variant_price_snapshot, delivery_type, delivery_note, subtotal, discount_amount, coupon_code_snapshot, coupon_name_snapshot, coupon_discount_type_snapshot, coupon_discount_value_snapshot, notes, total, created_at"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError || !quote) {
    throw new Error("No se pudo cargar la cotización para WhatsApp.");
  }

  const [customerResult, addonsResult] = await Promise.all([
    supabase
      .from("customers")
      .select("name, company, whatsapp, email")
      .eq("id", quote.customer_id)
      .maybeSingle(),
    supabase
      .from("quote_addons")
      .select("id, addon_name_snapshot, description_snapshot, calculation_type_snapshot, unit_price_snapshot, quantity, line_total")
      .eq("quote_id", quoteId)
      .order("created_at"),
  ]);

  if (customerResult.error || addonsResult.error || !customerResult.data) {
    throw new Error("No se pudieron cargar los snapshots de la cotización.");
  }

  const couponDiscountValue = quote.coupon_discount_value_snapshot === null
    ? null
    : asNumber(quote.coupon_discount_value_snapshot);

  return {
    folio: quote.folio,
    createdAt: quote.created_at,
    customer: customerResult.data,
    sellerName: quote.salesperson_name_snapshot ?? null,
    machine: {
      name: quote.machine_name_snapshot,
      basePrice: asNumber(quote.machine_base_price_snapshot),
      numberOfBases: quote.machine_number_of_bases_snapshot,
      imageUrl: quote.machine_image_url_snapshot,
      variant: quote.machine_variant_type_snapshot && quote.machine_variant_name_snapshot && quote.machine_variant_price_snapshot !== null ? { type: quote.machine_variant_type_snapshot, name: quote.machine_variant_name_snapshot, price: asNumber(quote.machine_variant_price_snapshot) } : null,
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

async function getOrCreateSignedPdfUrl(quoteId: string, folio: string, snapshot: QuotePdfSnapshot) {
  const supabase = createSupabaseAdminClient();
  const objectPath = `quotes/${quoteId}/${folio}.pdf`;
  const storage = supabase.storage.from(pdfBucket);

  const existing = await storage.createSignedUrl(objectPath, signedUrlLifetimeSeconds);
  if (existing.data?.signedUrl && !existing.error) {
    return existing.data.signedUrl;
  }

  const pdfBytes = await generateQuotePdfOnServer(snapshot);
  const upload = await storage.upload(objectPath, pdfBytes, {
    cacheControl: "private, max-age=0",
    contentType: "application/pdf",
    upsert: false,
  });

  if (upload.error && !/already exists|duplicate|409/i.test(upload.error.message)) {
    throw new Error("No se pudo guardar el PDF de la cotización.");
  }

  const signed = await storage.createSignedUrl(objectPath, signedUrlLifetimeSeconds);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error("No se pudo crear un enlace temporal para el PDF.");
  }

  return signed.data.signedUrl;
}

export async function sendQuoteViaWhatsApp(
  quoteId: string
): Promise<SendQuoteViaWhatsAppResult> {
  let authorizedQuote: AuthorizedQuote | null = null;

  try {
    authorizedQuote = await getAuthorizedQuote(quoteId);

    if (!hasSupabaseAdminConfiguration()) {
      return {
        error: "El envío por WhatsApp está pendiente de configuración del servidor.",
        configurationRequired: true,
      };
    }

    // Validate all server-only Twilio settings before creating storage objects or a send record.
    getTwilioWhatsAppConfiguration();

    const snapshot = await loadQuoteSnapshot(authorizedQuote.id);
    const destination = normalizeWhatsAppPhone(snapshot.customer.whatsapp);
    const admin = createSupabaseAdminClient();
    const { data: existing, error: existingError } = await admin
      .from("whatsapp_messages")
      .select("id, status, customer_whatsapp_snapshot")
      .eq("quote_id", authorizedQuote.id)
      .maybeSingle();

    if (existingError) throw new Error("No se pudo revisar el estado de WhatsApp.");

    if (existing && isTerminalStatus(existing.status)) {
      return {
        status: existing.status,
        destination: existing.customer_whatsapp_snapshot,
      };
    }

    if (existing?.status === "SENDING") {
      return {
        error: "El envío ya está en proceso. Espera un momento antes de reintentar.",
        status: "SENDING",
        retryable: true,
      };
    }

    if (existing) {
      const { error: restartError } = await admin
        .from("whatsapp_messages")
        .update({
          status: "SENDING",
          customer_whatsapp_snapshot: destination.e164,
          error_code: null,
          error_message: null,
        })
        .eq("id", existing.id);

      if (restartError) throw new Error("No se pudo preparar el reintento de WhatsApp.");
    } else {
      const { error: insertError } = await admin.from("whatsapp_messages").insert({
        quote_id: authorizedQuote.id,
        seller_id: authorizedQuote.sellerId,
        customer_whatsapp_snapshot: destination.e164,
        provider: "TWILIO",
        status: "SENDING",
      });

      if (insertError) {
        if (insertError.code === "23505") {
          return {
            error: "El envío ya está en proceso. Espera un momento antes de reintentar.",
            status: "SENDING",
            retryable: true,
          };
        }
        throw new Error("No se pudo registrar el envío de WhatsApp.");
      }
    }

    const signedPdfUrl = await getOrCreateSignedPdfUrl(
      authorizedQuote.id,
      authorizedQuote.folio,
      snapshot
    );
    const sent = await sendQuoteWhatsAppWithTwilio({
      customerName: snapshot.customer.name,
      customerWhatsApp: snapshot.customer.whatsapp,
      folio: snapshot.folio,
      machineName: snapshot.machine.name,
      total: asMoney(snapshot.total),
      sellerName: snapshot.sellerName,
      mediaUrl: signedPdfUrl,
    });

    const { error: updateError } = await admin
      .from("whatsapp_messages")
      .update({
        status: "SENT",
        provider_message_id: sent.providerMessageId,
        customer_whatsapp_snapshot: sent.destination,
        error_code: null,
        error_message: null,
        sent_at: new Date().toISOString(),
      })
      .eq("quote_id", authorizedQuote.id);

    if (updateError) {
      throw new Error("Twilio aceptó el envío, pero no se pudo guardar su estado.");
    }

    revalidatePath(`/seller/quotes/${authorizedQuote.id}`);
    revalidatePath(`/admin/quotes/${authorizedQuote.id}`);
    return { status: "SENT", destination: sent.destination };
  } catch (error) {
    const normalized = publicSendError(error);

    if (authorizedQuote && hasSupabaseAdminConfiguration()) {
      const admin = createSupabaseAdminClient();
      await admin
        .from("whatsapp_messages")
        .update({
          status: "FAILED",
          error_code: normalized.code,
          error_message: normalized.message,
        })
        .eq("quote_id", authorizedQuote.id)
        .eq("status", "SENDING");
      revalidatePath(`/seller/quotes/${authorizedQuote.id}`);
      revalidatePath(`/admin/quotes/${authorizedQuote.id}`);
    }

    return {
      error: normalized.message,
      retryable: normalized.retryable,
      configurationRequired: normalized.code === "CONFIGURATION",
      status: "FAILED",
    };
  }
}
