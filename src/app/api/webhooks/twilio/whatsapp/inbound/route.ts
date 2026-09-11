import { NextResponse } from "next/server";
import twilio from "twilio";
import { createSupabaseAdminClient } from "@/lib/supabase/admin.server";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp/phone";
import { getOrCreateWhatsAppMediaUrl, loadQuoteSnapshot } from "@/app/quotes/whatsapp-actions";
import { sendCustomerInitiatedWhatsAppWithTwilio, getTwilioInboundWebhookUrl, getTwilioWhatsAppConfiguration } from "@/lib/whatsapp/twilio.server";
import { sendInboundAutoReply } from "@/lib/whatsapp/inbound-auto-reply.server";

function xml() { return new NextResponse("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } }); }
function partial(value: string) { return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "…"; }

export async function POST(request: Request) {
  const body = await request.text();
  const params = Object.fromEntries(new URLSearchParams(body).entries());
  let configuration: ReturnType<typeof getTwilioWhatsAppConfiguration>;
  try { configuration = getTwilioWhatsAppConfiguration(); } catch { return new NextResponse("Service unavailable", { status: 503 }); }
  const signature = request.headers.get("x-twilio-signature") || "";
  if (!twilio.validateRequest(configuration.authToken, signature, getTwilioInboundWebhookUrl(), params)) return new NextResponse("Forbidden", { status: 403 });
  const fromRaw = params.From?.trim() || "";
  const toRaw = params.To?.trim() || "";
  const messageSid = params.MessageSid?.trim() || "";
  const configuredFrom = configuration.from.toLowerCase();
  if (!messageSid || !fromRaw || fromRaw.toLowerCase() === configuredFrom || toRaw.toLowerCase() !== configuredFrom) return xml();
  const fromPhone = normalizeWhatsAppPhone(fromRaw.replace(/^whatsapp:/i, "")).e164;
  const toPhone = normalizeWhatsAppPhone(toRaw.replace(/^whatsapp:/i, "")).e164;
  const admin = createSupabaseAdminClient();
  const claimed = await admin.from("whatsapp_inbound_auto_replies").insert({ message_sid: messageSid, from_phone: fromPhone, to_phone: toPhone, status: "RECEIVED" }).select("id").single();
  if (claimed.error) {
    const duplicate = await admin.from("whatsapp_inbound_auto_replies").select("id").eq("message_sid", messageSid).maybeSingle();
    if (duplicate.data) return xml();
    return xml();
  }
  const replyId = claimed.data.id;
  const candidates = (params.Body || "").match(/[A-Za-z0-9_-]{10,32}/g) || [];
  let tokenRow: { token: string; quote_id: string; expires_at: string; used_at: string | null } | null = null;
  for (const candidate of candidates) {
    const found = await admin.from("quote_delivery_tokens").select("token, quote_id, expires_at, used_at").eq("token", candidate).maybeSingle();
    if (found.data) { tokenRow = found.data; break; }
  }
  console.info("[inbound whatsapp]", { messageSid: partial(messageSid), fromMasked: partial(fromPhone), tokenFound: Boolean(tokenRow), quoteResolved: Boolean(tokenRow?.quote_id) });
  if (tokenRow && new Date(tokenRow.expires_at).getTime() > Date.now()) {
    await admin.from("whatsapp_inbound_auto_replies").update({ status: "SKIPPED_TOKEN" }).eq("id", replyId);
    const quoteOwner = await admin.from("quotes").select("seller_id").eq("id", tokenRow.quote_id).maybeSingle();
    if (!quoteOwner.data?.seller_id) return xml();
    const existing = await admin.from("whatsapp_messages").select("id,status").eq("quote_id", tokenRow.quote_id).maybeSingle();
    if (existing.data && ["SENT", "DELIVERED", "READ", "SENDING"].includes(existing.data.status)) return xml();
    const phone = normalizeWhatsAppPhone(fromPhone);
    const snapshot = await loadQuoteSnapshot(tokenRow.quote_id);
    const mediaUrl = await getOrCreateWhatsAppMediaUrl(tokenRow.quote_id, snapshot.folio, snapshot);
    if (existing.data) await admin.from("whatsapp_messages").update({ status: "SENDING", delivery_method: "CUSTOMER_INITIATED", inbound_message_sid: messageSid, inbound_phone: phone.e164, error_code: null, error_message: null }).eq("id", existing.data.id);
    else { const inserted = await admin.from("whatsapp_messages").insert({ quote_id: tokenRow.quote_id, seller_id: quoteOwner.data.seller_id, customer_whatsapp_snapshot: phone.e164, provider: "TWILIO", status: "SENDING", delivery_method: "CUSTOMER_INITIATED", inbound_message_sid: messageSid, inbound_phone: phone.e164 }); if (inserted.error) return xml(); }
    try { const sent = await sendCustomerInitiatedWhatsAppWithTwilio({ customerName: snapshot.customer.name, customerWhatsApp: phone.e164, mediaUrl }); await admin.from("whatsapp_messages").update({ status: "SENT", provider_message_id: sent.providerMessageId, sent_at: new Date().toISOString() }).eq("quote_id", tokenRow.quote_id); await admin.from("quote_delivery_tokens").update({ used_at: new Date().toISOString() }).eq("token", tokenRow.token); } catch (error) { await admin.from("whatsapp_messages").update({ status: "FAILED", error_code: "TWILIO_SEND_FAILED", error_message: error instanceof Error ? error.message.slice(0, 500) : "send failed" }).eq("quote_id", tokenRow.quote_id); }
    return xml();
  }
  const recent = await admin.from("whatsapp_inbound_auto_replies").select("id").eq("from_phone", fromPhone).gte("received_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).in("status", ["SENT", "SENDING", "RECEIVED"]).limit(1);
  if (recent.data?.length) { await admin.from("whatsapp_inbound_auto_replies").update({ status: "SKIPPED_RATE_LIMIT" }).eq("id", replyId); return xml(); }
  await admin.from("whatsapp_inbound_auto_replies").update({ status: "SENDING" }).eq("id", replyId);
  try { const sent = await sendInboundAutoReply(fromPhone); await admin.from("whatsapp_inbound_auto_replies").update({ status: "SENT", replied_at: new Date().toISOString(), reply_message_sid: sent.providerMessageId }).eq("id", replyId); } catch (error) { await admin.from("whatsapp_inbound_auto_replies").update({ status: "FAILED", error_code: "TWILIO_SEND_FAILED", error_message: error instanceof Error ? error.message.slice(0, 500) : "send failed" }).eq("id", replyId); }
  return xml();
}
