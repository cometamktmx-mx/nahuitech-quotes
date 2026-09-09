import "server-only";
import twilio from "twilio";
import { normalizeWhatsAppPhone } from "./phone";

export class TwilioConfigurationError extends Error {}
type TwilioWhatsAppConfiguration = { accountSid: string; authToken: string; from: string; contentSid: string; statusCallbackUrl: string };
type SendQuoteWhatsAppInput = { customerName: string; customerWhatsApp: string; folio: string; machineName: string; total: string; sellerName: string | null; mediaUrl: string };

function requiredEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new TwilioConfigurationError(`Falta configurar ${name}.`);
  return value;
}
function appUrl() {
  const value = process.env.APP_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!value) throw new TwilioConfigurationError("Falta configurar APP_URL para recibir estados de WhatsApp.");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new TwilioConfigurationError("APP_URL debe ser una URL pública HTTPS válida."); }
  if (parsed.protocol !== "https:") throw new TwilioConfigurationError("APP_URL debe usar HTTPS para los callbacks de Twilio.");
  return parsed.toString().replace(/\/$/, "");
}
function normalizedFrom(value: string) { return normalizeWhatsAppPhone(value.replace(/^whatsapp:/i, "")).whatsappAddress; }
export function getTwilioStatusCallbackUrl() { return `${appUrl()}/api/webhooks/twilio/whatsapp`; }
export function getTwilioWhatsAppConfiguration(): TwilioWhatsAppConfiguration {
  const contentSid = requiredEnvironmentValue("TWILIO_CONTENT_SID");
  if (!/^HX[a-f0-9]{32}$/i.test(contentSid)) throw new TwilioConfigurationError("TWILIO_CONTENT_SID no tiene un formato de Content Template válido.");
  return { accountSid: requiredEnvironmentValue("TWILIO_ACCOUNT_SID"), authToken: requiredEnvironmentValue("TWILIO_AUTH_TOKEN"), from: normalizedFrom(requiredEnvironmentValue("TWILIO_WHATSAPP_FROM")), contentSid, statusCallbackUrl: getTwilioStatusCallbackUrl() };
}
function mediaVariableValue(mediaUrl: string) {
  let parsed: URL;
  try { parsed = new URL(mediaUrl); } catch { throw new TwilioConfigurationError("El enlace temporal del PDF no es válido."); }
  if (parsed.protocol !== "https:") throw new TwilioConfigurationError("El enlace temporal del PDF debe usar HTTPS.");
  const marker = "/storage/v1/object/sign/quote-pdfs/";
  const index = parsed.pathname.indexOf(marker);
  const path = index < 0 ? "" : parsed.pathname.slice(index + marker.length);
  if (!path.endsWith(".pdf") || !parsed.search) throw new TwilioConfigurationError("El enlace temporal del PDF no tiene el formato esperado.");
  return `${path}${parsed.search}`;
}
export async function sendQuoteWhatsAppWithTwilio(input: SendQuoteWhatsAppInput) {
  const configuration = getTwilioWhatsAppConfiguration();
  const destination = normalizeWhatsAppPhone(input.customerWhatsApp);
  const message = await twilio(configuration.accountSid, configuration.authToken).messages.create({
    to: destination.whatsappAddress, from: configuration.from, statusCallback: configuration.statusCallbackUrl,
    contentSid: configuration.contentSid,
    contentVariables: JSON.stringify({ 1: input.customerName.replace(/[\r\n]/g, " ").trim(), 2: mediaVariableValue(input.mediaUrl) }),
  });
  return { destination: destination.e164, providerMessageId: message.sid };
}
