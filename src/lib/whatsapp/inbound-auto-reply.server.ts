import "server-only";
import twilio from "twilio";
import { normalizeWhatsAppPhone } from "./phone";
import { getTwilioWhatsAppConfiguration } from "./twilio.server";

export const inboundAutoReplyBody = "Hola  Este número de Nahuitech se utiliza únicamente para el envío automático de cotizaciones. Para atención, dudas, ajustes o seguimiento, comunícate por WhatsApp al 445 261 0873. Con gusto te atenderemos.";

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
