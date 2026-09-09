import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const bucketPrefix = "quote-pdfs/";
const tokenLifetimeSeconds = 60 * 60 * 24;

function tokenSecret() {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Falta configurar SUPABASE_SECRET_KEY para proteger los PDFs de WhatsApp.");
  return secret;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signature(payload: string) {
  return createHmac("sha256", tokenSecret()).update(payload).digest("base64url");
}

function validPdfPath(path: string) {
  return path.startsWith(bucketPrefix) && path.endsWith(".pdf") && !path.includes("..") && !path.includes("\\");
}

export function createWhatsAppMediaToken(storagePath: string, now = Math.floor(Date.now() / 1000)) {
  if (!validPdfPath(storagePath)) throw new Error("El path del PDF no es válido.");
  const payload = JSON.stringify({
    v: 1,
    path: storagePath,
    exp: now + tokenLifetimeSeconds,
    nonce: randomBytes(16).toString("hex"),
  });
  const encoded = encode(payload);
  return `v1.${encoded}.${signature(encoded)}`;
}

export function verifyWhatsAppMediaToken(token: string, now = Math.floor(Date.now() / 1000)) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, encoded, providedSignature] = parts;
  if (!encoded || !providedSignature || !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]+$/.test(providedSignature)) return null;
  const expectedSignature = signature(encoded);
  const expected = Buffer.from(expectedSignature);
  const provided = Buffer.from(providedSignature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { v?: number; path?: unknown; exp?: unknown; nonce?: unknown };
    if (payload.v !== 1 || typeof payload.path !== "string" || typeof payload.exp !== "number" || typeof payload.nonce !== "string" || payload.exp < now || !validPdfPath(payload.path)) return null;
    return { path: payload.path, expiresAt: payload.exp };
  } catch {
    return null;
  }
}

export const whatsappMediaTokenLifetimeSeconds = tokenLifetimeSeconds;
