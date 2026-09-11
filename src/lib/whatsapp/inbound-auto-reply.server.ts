import "server-only";
import twilio from "twilio";
import { normalizeWhatsAppPhone } from "./phone";
import { getTwilioWhatsAppConfiguration } from "./twilio.server";

export const inboundAutoReplyBody = `Hola
Este número se utiliza únicamente para el envío automático de cotizaciones de Nahuitech.
Para dudas, cambios o seguimiento de tu cotización, escríbenos directamente a nuestro WhatsApp de atención:
445 261 0873
https://wa.me/524452610873
Con gusto continuaremos tu atención por ese medio.`;

export async function sendInboundAutoReply(fromPhone: string) {
  const configuration = getTwilioWhatsAppConfiguration();
  const destination = normalizeWhatsAppPhone(fromPhone);
  const message = await twilio(configuration.accountSid, configuration.authToken).messages.create({
    to: destination.whatsappAddress,
    from: configuration.from,
    body: inboundAutoReplyBody,
  });
  return { destination: destination.e164, providerMessageId: message.sid };
}
