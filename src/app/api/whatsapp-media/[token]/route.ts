import { NextResponse } from "next/server";

import { createSupabaseAdminClient, hasSupabaseAdminConfiguration } from "@/lib/supabase/admin.server";
import { verifyWhatsAppMediaToken } from "@/lib/whatsapp/media-token.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bucket = "quote-pdfs";

type RouteContext = { params: Promise<{ token: string }> };

async function resolvePath(token: string) {
  if (token === "sample-cotizacion.pdf") return "quote-pdfs/samples/cotizacion-nahuitech.pdf";
  return verifyWhatsAppMediaToken(token)?.path ?? null;
}

async function fileExists(path: string) {
  const separator = path.lastIndexOf("/");
  const folder = path.slice("quote-pdfs/".length, separator);
  const filename = path.slice(separator + 1);
  const { data, error } = await createSupabaseAdminClient().storage.from(bucket).list(folder, { search: filename, limit: 20 });
  if (error) return false;
  return (data ?? []).some((entry) => entry.name === filename);
}

export async function HEAD(_request: Request, context: RouteContext) {
  if (!hasSupabaseAdminConfiguration()) return new NextResponse(null, { status: 503 });
  const path = await resolvePath((await context.params).token);
  if (!path || !(await fileExists(path))) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=0, no-store" },
  });
}

export async function GET(_request: Request, context: RouteContext) {
  if (!hasSupabaseAdminConfiguration()) return new NextResponse("Media no disponible.", { status: 503 });
  const path = await resolvePath((await context.params).token);
  if (!path) return new NextResponse("Media no encontrada.", { status: 404 });
  const { data, error } = await createSupabaseAdminClient().storage.from(bucket).download(path.slice(`${bucket}/`.length));
  if (error || !data) {
    console.error("[whatsapp media error]", { path, message: error?.message ?? "empty response" });
    return new NextResponse("Media no encontrada.", { status: 404 });
  }
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=\"cotizacion-nahuitech.pdf\"",
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
