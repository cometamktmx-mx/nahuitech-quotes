"use server";

import { revalidatePath } from "next/cache";

import { getAdminClient } from "@/lib/auth/get-admin-client";
import {
  createSupabaseAdminClient,
  isMissingSupabaseAdminConfiguration,
} from "@/lib/supabase/admin.server";

export type SalespersonActionResult = { error?: string; created?: number };

class ValidationError extends Error {}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value: FormDataEntryValue | null, fieldName: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ValidationError(`${fieldName} es obligatorio.`);
  return text;
}

function optionalText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function salespersonName(value: FormDataEntryValue | null) {
  const name = requiredText(value, "El nombre completo").replace(/\s+/g, " ");
  if (name.length > 120) {
    throw new ValidationError("El nombre completo no puede exceder 120 caracteres.");
  }
  return name;
}

function salespersonEmail(value: FormDataEntryValue | null) {
  const email = optionalText(value)?.toLowerCase() ?? null;
  if (email && (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new ValidationError("Ingresa un correo válido o déjalo vacío.");
  }
  return email;
}

function salespersonPhone(value: FormDataEntryValue | null) {
  const phone = optionalText(value);
  if (phone && phone.length > 40) {
    throw new ValidationError("El teléfono no puede exceder 40 caracteres.");
  }
  return phone;
}

function salespersonSortOrder(value: FormDataEntryValue | null) {
  const raw = typeof value === "string" && value.trim() ? Number(value) : 0;
  if (!Number.isSafeInteger(raw) || raw < 0 || raw > 100000) {
    throw new ValidationError("El orden debe ser un entero entre 0 y 100000.");
  }
  return raw;
}

function salespersonId(value: FormDataEntryValue | null) {
  const id = requiredText(value, "El identificador del vendedor");
  if (!uuidPattern.test(id)) {
    throw new ValidationError("El identificador del vendedor no es válido.");
  }
  return id;
}

function actionError(error: unknown, fallback: string): SalespersonActionResult {
  if (error instanceof ValidationError || isMissingSupabaseAdminConfiguration(error)) {
    return { error: error.message };
  }
  return { error: fallback };
}

function refreshSellerViews() {
  revalidatePath("/admin");
  revalidatePath("/admin/sellers");
  revalidatePath("/seller");
}

export async function createSalesperson(
  formData: FormData
): Promise<SalespersonActionResult> {
  try {
    const supabase = await getAdminClient();
    const { error } = await supabase.from("salespeople").insert({
      full_name: salespersonName(formData.get("fullName")),
      email: salespersonEmail(formData.get("email")),
      phone: salespersonPhone(formData.get("phone")),
      active: formData.get("active") === "on",
      sort_order: salespersonSortOrder(formData.get("sortOrder")),
    });
    if (error) throw new Error(error.message);
    refreshSellerViews();
    return {};
  } catch (error) {
    return actionError(error, "No se pudo crear el vendedor comercial.");
  }
}

export async function updateSalesperson(
  formData: FormData
): Promise<SalespersonActionResult> {
  try {
    const id = salespersonId(formData.get("id"));
    const supabase = await getAdminClient();
    const { error } = await supabase
      .from("salespeople")
      .update({
        full_name: salespersonName(formData.get("fullName")),
        email: salespersonEmail(formData.get("email")),
        phone: salespersonPhone(formData.get("phone")),
        active: formData.get("active") === "on",
        sort_order: salespersonSortOrder(formData.get("sortOrder")),
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
    refreshSellerViews();
    return {};
  } catch (error) {
    return actionError(error, "No se pudo actualizar el vendedor comercial.");
  }
}

export async function addSalespeopleInBulk(
  formData: FormData
): Promise<SalespersonActionResult> {
  try {
    const raw = requiredText(formData.get("names"), "Agrega al menos un nombre");
    const parsedNames = raw
      .split(/\r?\n/)
      .map((name) => name.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    if (!parsedNames.length) {
      throw new ValidationError("Agrega al menos un nombre.");
    }
    if (parsedNames.some((name) => name.length > 120)) {
      throw new ValidationError("Cada nombre debe tener máximo 120 caracteres.");
    }

    const normalize = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-MX");
    const uniqueNames = Array.from(
      new Map(parsedNames.map((name) => [normalize(name), name])).values()
    );
    const supabase = await getAdminClient();
    const { data: existing, error: existingError } = await supabase
      .from("salespeople")
      .select("full_name, sort_order");
    if (existingError) throw new Error(existingError.message);

    const existingNames = new Set((existing ?? []).map((row) => normalize(row.full_name)));
    const namesToCreate = uniqueNames.filter((name) => !existingNames.has(normalize(name)));
    if (!namesToCreate.length) {
      return { error: "Todos esos vendedores ya existen." };
    }

    const initialOrder = Math.max(0, ...(existing ?? []).map((row) => row.sort_order)) + 1;
    const { error: insertError } = await supabase.from("salespeople").insert(
      namesToCreate.map((full_name, index) => ({
        full_name,
        active: true,
        sort_order: initialOrder + index,
      }))
    );
    if (insertError) throw new Error(insertError.message);
    refreshSellerViews();
    return { created: namesToCreate.length };
  } catch (error) {
    return actionError(error, "No se pudieron agregar los vendedores.");
  }
}

/**
 * Prepared for the future individual-login workflow. It is deliberately not
 * used by the commercial salesperson UI and keeps the privileged key server-only.
 */
export async function createSellerAccessForSalesperson(
  formData: FormData
): Promise<SalespersonActionResult> {
  try {
    const linkedSalespersonId = salespersonId(formData.get("salespersonId"));
    const fullName = salespersonName(formData.get("fullName"));
    const email = requiredText(formData.get("email"), "El correo").toLowerCase();
    const password = requiredText(formData.get("temporaryPassword"), "La contraseña temporal");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ValidationError("Ingresa un correo válido.");
    }
    if (password.length < 8 || password.length > 128) {
      throw new ValidationError("La contraseña temporal debe tener entre 8 y 128 caracteres.");
    }

    await getAdminClient();
    const admin = createSupabaseAdminClient();
    const { data: salesperson, error: salespersonError } = await admin
      .from("salespeople")
      .select("id")
      .eq("id", linkedSalespersonId)
      .maybeSingle();
    if (salespersonError || !salesperson) {
      throw new ValidationError("El vendedor comercial no existe.");
    }

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (authError || !authData.user) {
      throw new Error(authError?.message ?? "No se pudo crear la cuenta de acceso.");
    }
    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: authData.user.id,
        full_name: fullName,
        role: "seller",
        active: true,
        salesperson_id: linkedSalespersonId,
      },
      { onConflict: "id" }
    );
    if (profileError) throw new Error(profileError.message);
    refreshSellerViews();
    return {};
  } catch (error) {
    return actionError(error, "No se pudo crear la cuenta de acceso del vendedor.");
  }
}
