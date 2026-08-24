export class WhatsAppPhoneValidationError extends Error {}

export type NormalizedWhatsAppPhone = {
  e164: string;
  whatsappAddress: string;
};

/**
 * Normalizes a customer phone number without guessing an international prefix.
 * Ten digit input is treated as Mexico (+52). Longer stored digit-only values are
 * retained as international input because historical customer records omit `+`.
 */
export function normalizeWhatsAppPhone(input: string): NormalizedWhatsAppPhone {
  const source = input.trim();

  if (!source) {
    throw new WhatsAppPhoneValidationError("WhatsApp es obligatorio.");
  }

  const compact = source.replace(/[\s()\-\.]/g, "");
  const hasLeadingPlus = compact.startsWith("+");
  const hasInternationalPrefix = compact.startsWith("00");
  const body = hasLeadingPlus ? compact.slice(1) : hasInternationalPrefix ? compact.slice(2) : compact;

  if (!/^\d+$/.test(body)) {
    throw new WhatsAppPhoneValidationError("El número de WhatsApp contiene caracteres no válidos.");
  }

  const digits = !hasLeadingPlus && !hasInternationalPrefix && body.length === 10
    ? `52${body}`
    : body;

  if (!hasLeadingPlus && !hasInternationalPrefix && (body.length < 10 || body.length > 15)) {
    throw new WhatsAppPhoneValidationError(
      "Usa un número internacional con + o un número mexicano de 10 dígitos."
    );
  }

  if (!/^[1-9]\d{6,14}$/.test(digits)) {
    throw new WhatsAppPhoneValidationError("El número de WhatsApp no tiene una longitud internacional válida.");
  }

  const e164 = `+${digits}`;
  return { e164, whatsappAddress: `whatsapp:${e164}` };
}
