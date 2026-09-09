import { NextResponse } from "next/server";
import twilio from "twilio";

import { createSupabaseAdminClient, hasSupabaseAdminConfiguration } from "@/lib/supabase/admin.server";
import {
  getTwilioStatusCallbackUrl,
  getTwilioWhatsAppConfiguration,
  TwilioConfigurationError,
} from "@/lib/whatsapp/twilio.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WhatsAppMessageStatus = "PENDING" | "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

const rank: Record<WhatsAppMessageStatus, number> = {
  PENDING: 0,
  SENDING: 1,
  SENT: 2,
  FAILED: 2,
  DELIVERED: 3,
  READ: 4,
};

function response(status = 204) {
  return new NextResponse(null, { status });
}

function mappedStatus(messageStatus: string | null, eventType: string | null): WhatsAppMessageStatus | null {
  if (eventType?.toUpperCase() === "READ") return "READ";

  switch (messageStatus?.toLowerCase()) {
    case "queued":
    case "sending":
      return "SENDING";
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "read":
      return "READ";
    case "failed":
    case "undelivered":
      return "FAILED";
    default:
      return null;
  }
}

export async function POST(request: Request) {
  if (!hasSupabaseAdminConfiguration()) {
    return response(503);
  }

  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return response(403);

  let configuration: ReturnType<typeof getTwilioWhatsAppConfiguration>;
  try {
    configuration = getTwilioWhatsAppConfiguration();
  } catch (error) {
    if (error instanceof TwilioConfigurationError) return response(503);
    return response(500);
  }

  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });

  const isValid = twilio.validateRequest(
    configuration.authToken,
    signature,
    getTwilioStatusCallbackUrl(),
    params
  );
  if (!isValid) return response(403);

  const providerMessageId = params.MessageSid?.trim();
  const nextStatus = mappedStatus(params.MessageStatus, params.EventType);
  if (!providerMessageId || !nextStatus) return response();

  const admin = createSupabaseAdminClient();
  const { data: message, error: messageError } = await admin
    .from("whatsapp_messages")
    .select("id, status, sent_at, delivered_at, read_at")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();

  if (messageError) return response(500);
  if (!message) return response();

  const currentStatus = message.status as WhatsAppMessageStatus;
  const shouldKeepCurrent =
    (currentStatus === "DELIVERED" || currentStatus === "READ") &&
    (nextStatus === "SENDING" || nextStatus === "SENT" || nextStatus === "FAILED") ||
    (nextStatus !== "FAILED" && rank[nextStatus] < rank[currentStatus]);

  if (shouldKeepCurrent) return response();

  const occurredAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("whatsapp_messages")
    .update({
      status: nextStatus,
      error_code: nextStatus === "FAILED" ? params.ErrorCode || null : null,
      error_message:
        nextStatus === "FAILED"
          ? "No se pudo entregar la cotización por WhatsApp."
          : null,
      sent_at: nextStatus === "SENT" ? message.sent_at ?? occurredAt : message.sent_at,
      delivered_at: nextStatus === "DELIVERED" ? message.delivered_at ?? occurredAt : message.delivered_at,
      read_at: nextStatus === "READ" ? message.read_at ?? occurredAt : message.read_at,
      failed_at: nextStatus === "FAILED" ? occurredAt : null,
    })
    .eq("id", message.id);

  return response(updateError ? 500 : 204);
}
