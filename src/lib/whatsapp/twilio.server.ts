import "server-only";

import twilio from "twilio";

import { normalizeWhatsAppPhone } from "./phone";

export class TwilioConfigurationError extends Error {}

type TwilioWhatsAppConfiguration = {
  accountSid: string;
  authToken: string;
  from: string;
  contentSid: string | null;
  statusCallbackUrl: string;
};

type SendQuoteWhatsAppInput = {
  customerName: string;
  customerWhatsApp: string;
  folio: string;
  machineName: string;
  total: string;
  sellerName: string | null;
  mediaUrl: string;
};

function requiredEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new TwilioConfigurationError(`Falta configurar ${name}.`);
  }
  return value;
}

function appUrl() {
  const configured = process.env.APP_URL?.trim();
  const vercelUrl = process.env.VERCEL_URL?.trim();
  const value = configured || (vercelUrl ? `https://${vercelUrl}` : "");

  if (!value) {
    throw new TwilioConfigurationError(
      "Falta configurar APP_URL para recibir estados de WhatsApp."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TwilioConfigurationError("APP_URL debe ser una URL pública HTTPS válida.");
  }

  if (parsed.protocol !== "https:") {
    throw new TwilioConfigurationError("APP_URL debe usar HTTPS para los callbacks de Twilio.");
  }

  return parsed.toString().replace(/\/$/, "");
}

function normalizedFrom(value: string) {
  const number = value.replace(/^whatsapp:/i, "");
  return normalizeWhatsAppPhone(number).whatsappAddress;
}

export function getTwilioStatusCallbackUrl() {
  return `${appUrl()}/api/webhooks/twilio/whatsapp`;
}

export function getTwilioWhatsAppConfiguration(): TwilioWhatsAppConfiguration {
  return {
    accountSid: requiredEnvironmentValue("TWILIO_ACCOUNT_SID"),
    authToken: requiredEnvironmentValue("TWILIO_AUTH_TOKEN"),
    from: normalizedFrom(requiredEnvironmentValue("TWILIO_WHATSAPP_FROM")),
    contentSid: process.env.TWILIO_CONTENT_SID?.trim() || null,
    statusCallbackUrl: getTwilioStatusCallbackUrl(),
  };
}

function quoteMessage(input: SendQuoteWhatsAppInput) {
  const advisor = input.sellerName ? `\n\nTu asesor:\n${input.sellerName}` : "";
  return `Hola ${input.customerName},\n\nGracias por visitar Nahuitech.\n\nTe compartimos tu cotización ${input.folio} correspondiente a:\n\n${input.machineName}\n\nTotal:\n${input.total}${advisor}\n\nAdjuntamos tu cotización en PDF.\n\nNAHUITECH`;
}

export async function sendQuoteWhatsAppWithTwilio(input: SendQuoteWhatsAppInput) {
  const configuration = getTwilioWhatsAppConfiguration();
  const client = twilio(configuration.accountSid, configuration.authToken);
  const destination = normalizeWhatsAppPhone(input.customerWhatsApp);
  const common = {
    to: destination.whatsappAddress,
    from: configuration.from,
    mediaUrl: [input.mediaUrl],
    statusCallback: configuration.statusCallbackUrl,
  };

  const message = configuration.contentSid
    ? await client.messages.create({
        ...common,
        contentSid: configuration.contentSid,
        contentVariables: JSON.stringify({
          1: input.customerName,
          2: input.folio,
          3: input.machineName,
          4: input.total,
          5: input.sellerName ?? "Nahuitech",
        }),
      })
    : await client.messages.create({
        ...common,
        body: quoteMessage(input),
      });

  return {
    destination: destination.e164,
    providerMessageId: message.sid,
  };
}
