import "server-only";
import { randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin.server";

export const DELIVERY_TOKEN_TTL_HOURS = 48;
export function newDeliveryToken() { return randomBytes(12).toString("base64url"); }

export async function getOrCreateDeliveryToken(quoteId: string) {
  const admin = createSupabaseAdminClient();
  const existing = await admin.from("quote_delivery_tokens").select("token, expires_at").eq("quote_id", quoteId).maybeSingle();
  if (existing.error) { console.error("[customer initiated token error]", { code: existing.error.code, message: existing.error.message, hint: existing.error.hint }); throw new Error("No se pudo preparar el código de WhatsApp."); }
  if (existing.data && new Date(existing.data.expires_at).getTime() > Date.now()) return existing.data;
  const row = { quote_id: quoteId, token: newDeliveryToken(), expires_at: new Date(Date.now() + DELIVERY_TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString() };
  const inserted = await admin.from("quote_delivery_tokens").upsert(row, { onConflict: "quote_id" }).select("token, expires_at").single();
  if (inserted.error || !inserted.data) { console.error("[customer initiated token error]", { code: inserted.error?.code, message: inserted.error?.message, hint: inserted.error?.hint }); throw new Error("No se pudo generar el código de WhatsApp."); }
  return inserted.data;
}
