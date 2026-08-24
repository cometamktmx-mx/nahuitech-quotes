"use server";

import { revalidatePath } from "next/cache";

import { getAdminClient } from "@/lib/auth/get-admin-client";
import {
  createSupabaseAdminClient,
  isMissingSupabaseAdminConfiguration,
} from "@/lib/supabase/admin.server";

export type SellerActionResult = { error?: string };

class ValidationError extends Error {}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value: FormDataEntryValue | null, fieldName: string) {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text) {
    throw new ValidationError(`${fieldName} es obligatorio.`);
  }

  return text;
}

function sellerName(value: FormDataEntryValue | null) {
  const name = requiredText(value, "El nombre completo");

  if (name.length > 120) {
    throw new ValidationError("El nombre completo no puede exceder 120 caracteres.");
  }

  return name;
}

function sellerEmail(value: FormDataEntryValue | null) {
  const email = requiredText(value, "El correo").toLowerCase();

  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("Ingresa un correo válido.");
  }

  return email;
}

function temporaryPassword(value: FormDataEntryValue | null) {
  const password = requiredText(value, "La contraseña temporal");

  if (password.length < 8) {
    throw new ValidationError("La contraseña temporal debe tener al menos 8 caracteres.");
  }

  if (password.length > 128) {
    throw new ValidationError("La contraseña temporal no puede exceder 128 caracteres.");
  }

  return password;
}

function sellerId(value: FormDataEntryValue | null) {
  const id = requiredText(value, "El identificador del vendedor");

  if (!uuidPattern.test(id)) {
    throw new ValidationError("El identificador del vendedor no es válido.");
  }

  return id;
}

function actionError(error: unknown, fallback: string): SellerActionResult {
  if (error instanceof ValidationError || isMissingSupabaseAdminConfiguration(error)) {
    return { error: error.message };
  }

  return { error: fallback };
}

function refreshSellerViews() {
  revalidatePath("/admin");
  revalidatePath("/admin/sellers");
}

async function getAuthorizedAdminClient() {
  await getAdminClient();
  return createSupabaseAdminClient();
}

export async function createSeller(
  formData: FormData
): Promise<SellerActionResult> {
  try {
    const fullName = sellerName(formData.get("fullName"));
    const email = sellerEmail(formData.get("email"));
    const password = temporaryPassword(formData.get("temporaryPassword"));
    const active = formData.get("active") === "on";
    const supabase = await getAuthorizedAdminClient();

    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

    if (authError || !authData.user) {
      if (/already registered|already been registered|duplicate/i.test(authError?.message ?? "")) {
        throw new ValidationError("Ya existe un usuario con este correo.");
      }

      throw new Error("No se pudo crear el usuario de acceso.");
    }

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        id: authData.user.id,
        full_name: fullName,
        role: "seller",
        active,
      },
      { onConflict: "id" }
    );

    if (profileError) {
      throw new Error("El usuario se creó, pero no se pudo preparar su perfil de vendedor.");
    }

    refreshSellerViews();
    return {};
  } catch (error) {
    return actionError(error, "No se pudo crear el vendedor.");
  }
}

export async function updateSeller(
  formData: FormData
): Promise<SellerActionResult> {
  try {
    const id = sellerId(formData.get("id"));
    const fullName = sellerName(formData.get("fullName"));
    const active = formData.get("active") === "on";
    const supabase = await getAuthorizedAdminClient();

    const { data: existingProfile, error: existingProfileError } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", id)
      .maybeSingle();

    if (existingProfileError || !existingProfile) {
      throw new ValidationError("El vendedor no existe.");
    }

    if (existingProfile.role !== "seller") {
      throw new ValidationError("Solo se pueden administrar perfiles con rol vendedor.");
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: fullName, active })
      .eq("id", id);

    if (updateError) {
      throw new Error("No se pudo actualizar el vendedor.");
    }

    refreshSellerViews();
    return {};
  } catch (error) {
    return actionError(error, "No se pudo actualizar el vendedor.");
  }
}
