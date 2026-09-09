"use server";

import { logMachineImageStorageError, uploadMachineImage } from "@/lib/machine-images.server";

import { revalidatePath } from "next/cache";

import { getAdminClient } from "@/lib/auth/get-admin-client";

export type CatalogActionResult = { error?: string };

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

function optionalText(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function optionalUuid(value: FormDataEntryValue | null) {
  const id = optionalText(value);

  if (id && !uuidPattern.test(id)) {
    throw new ValidationError("El identificador no es válido.");
  }

  return id;
}

function nonNegativePrice(value: FormDataEntryValue | null, fieldName: string) {
  const price = requiredText(value, fieldName);

  if (!/^\d+(?:\.\d{1,2})?$/.test(price)) {
    throw new ValidationError(`${fieldName} debe ser un número con hasta dos decimales.`);
  }

  const numericPrice = Number(price);

  if (!Number.isFinite(numericPrice) || numericPrice > 9_999_999_999.99) {
    throw new ValidationError(`${fieldName} no es válido.`);
  }

  return price;
}

function positiveInteger(value: FormDataEntryValue | null, fieldName: string) {
  const number = requiredText(value, fieldName);

  if (!/^[1-9]\d*$/.test(number)) {
    throw new ValidationError(`${fieldName} debe ser un entero mayor que cero.`);
  }

  const parsed = Number(number);

  if (!Number.isSafeInteger(parsed)) {
    throw new ValidationError(`${fieldName} no es válido.`);
  }

  return parsed;
}

function optionalPositiveInteger(value: FormDataEntryValue | null, fieldName: string) {
  const text = optionalText(value);
  if (!text) return null;
  return positiveInteger(text, fieldName);
}

function nonNegativeInteger(value: FormDataEntryValue | null, fieldName: string) {
  const number = requiredText(value, fieldName);

  if (!/^\d+$/.test(number)) {
    throw new ValidationError(`${fieldName} debe ser un entero igual o mayor que cero.`);
  }

  const parsed = Number(number);

  if (!Number.isSafeInteger(parsed)) {
    throw new ValidationError(`${fieldName} no es válido.`);
  }

  return parsed;
}

function actionError(error: unknown, fallback: string): CatalogActionResult {
  if (error instanceof ValidationError) {
    return { error: error.message };
  }

  return { error: fallback };
}

function assertUuid(value: unknown) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new ValidationError("El identificador no es válido.");
  }

  return value;
}

function optionalOverride(value: FormDataEntryValue | null, fieldName: string) {
  const text = optionalText(value);
  return text ? nonNegativePrice(text, fieldName) : null;
}

function allowedVariantTypes(value: FormDataEntryValue | null) {
  const raw = typeof value === "string" ? value : "AUTOMATIC,SEMI_AUTOMATIC";
  const types = raw
    .split(",")
    .map((type) => type.trim())
    .filter((type): type is "AUTOMATIC" | "SEMI_AUTOMATIC" =>
      type === "AUTOMATIC" || type === "SEMI_AUTOMATIC"
    );

  if (types.length === 0) {
    throw new ValidationError("La máquina debe permitir al menos una versión comercial.");
  }

  return [...new Set(types)];
}

async function syncAddonMachines(addonId: string, formData: FormData, selectedMachineIds: string[]) {
  const supabase = await getAdminClient();
  const uniqueMachineIds = [...new Set(selectedMachineIds)];

  if (uniqueMachineIds.some((machineId) => !uuidPattern.test(machineId))) {
    throw new ValidationError("Una de las máquinas seleccionadas no es válida.");
  }

  if (uniqueMachineIds.length > 0) {
    const { data: matchingMachines, error: machinesError } = await supabase
      .from("machines")
      .select("id, supports_addons")
      .in("id", uniqueMachineIds);

    if (machinesError || matchingMachines.length !== uniqueMachineIds.length || matchingMachines.some((machine) => !machine.supports_addons)) {
      throw new ValidationError("Una de las máquinas seleccionadas no existe.");
    }
  }

  const { data: currentRelations, error: currentRelationsError } = await supabase
    .from("machine_addons")
    .select("machine_id")
    .eq("addon_id", addonId);

  if (currentRelationsError) {
    throw new Error("No se pudieron consultar las compatibilidades.");
  }

  const selectedIds = new Set(uniqueMachineIds);
  const relationIdsToDelete = currentRelations
    .map((relation) => relation.machine_id)
    .filter((machineId) => !selectedIds.has(machineId));

  if (relationIdsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("machine_addons")
      .delete()
      .eq("addon_id", addonId)
      .in("machine_id", relationIdsToDelete);

    if (deleteError) {
      throw new Error("No se pudieron actualizar las compatibilidades.");
    }
  }

  if (uniqueMachineIds.length > 0) {
    const { error: upsertError } = await supabase
      .from("machine_addons")
      .upsert(
        uniqueMachineIds.map((machineId) => ({
          machine_id: machineId,
          addon_id: addonId,
          active: true,
          unit_price_override: optionalOverride(formData.get(`unitPriceOverride:${machineId}`), "El precio especial"),
          description_override: optionalText(formData.get(`descriptionOverride:${machineId}`)),
        })),
        { onConflict: "machine_id,addon_id" }
      );

    if (upsertError) {
      throw new Error("No se pudieron actualizar las compatibilidades.");
    }
  }
}

export async function saveMachine(
  formData: FormData
): Promise<CatalogActionResult> {
  try {
    const id = optionalUuid(formData.get("id"));
    const name = requiredText(formData.get("name"), "El nombre");
    const slug = requiredText(formData.get("slug"), "El slug");

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new ValidationError(
        "El slug solo puede usar minúsculas, números y guiones."
      );
    }

    const payload = {
      name,
      slug,
      short_description: requiredText(
        formData.get("shortDescription"),
        "La descripción corta"
      ),
      base_price: nonNegativePrice(formData.get("basePrice"), "El precio base"),
      number_of_bases: optionalPositiveInteger(
        formData.get("numberOfBases"),
        "El número de bases"
      ),
      supports_addons: formData.get("supportsAddons") === "on",
      delivery_policy: requiredText(formData.get("deliveryPolicy"), "La política de entrega"),
      variant_selection_required: formData.get("variantSelectionRequired") === "on",
      allowed_variant_types: allowedVariantTypes(formData.get("allowedVariantTypes")),

      active: formData.get("active") === "on",
      sort_order: nonNegativeInteger(formData.get("sortOrder"), "El orden"),
    };
    const supabase = await getAdminClient();
    if (!["FLEXIBLE", "INSTALLATION_REQUIRED", "SHIPPING_ONLY"].includes(payload.delivery_policy)) {
      throw new ValidationError("La política de entrega no es válida.");
    }
    let savedMachineId = id ?? crypto.randomUUID();
    const photo = formData.get("machinePhoto");
    let uploaded: { path: string; url: string } | undefined;
    if (photo instanceof File && photo.size > 0) {
      try { uploaded = await uploadMachineImage(supabase, savedMachineId, photo); }
      catch (error) { throw new ValidationError(error instanceof Error ? error.message : "No se pudo procesar la fotografía."); }
    }
    const imageChange = uploaded ? { image_url: uploaded.url }
      : formData.get("removePhoto") === "yes" ? { image_url: null } : {};
    const machinePayload = { ...payload, ...imageChange };

    if (id) {
      const { data, error } = await supabase
        .from("machines")
        .update(machinePayload)
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (error || !data) {
        if (uploaded) {
          const { error: cleanupError } = await supabase.storage.from("machine-images").remove([uploaded.path]);
          if (cleanupError) logMachineImageStorageError('[machine image cleanup error]', cleanupError);
        }
        throw new Error("No se pudo actualizar la máquina.");
      }
      savedMachineId = data.id;
    } else {
      const { data, error } = await supabase.from("machines").insert({ ...machinePayload, id: savedMachineId }).select("id").single();

      if (error || !data) {
        if (uploaded) {
          const { error: cleanupError } = await supabase.storage.from("machine-images").remove([uploaded.path]);
          if (cleanupError) logMachineImageStorageError('[machine image cleanup error]', cleanupError);
        }
        throw new Error("No se pudo crear la máquina.");
      }
      savedMachineId = data.id;
    }

    for (const value of formData.getAll("variantIds")) {
      const variantId = assertUuid(value);
      const variantType = requiredText(
        formData.get(`variantType:${variantId}`),
        "El tipo de versión"
      );
      if (variantType !== "AUTOMATIC" && variantType !== "SEMI_AUTOMATIC") {
        throw new ValidationError("El tipo de versión no es válido.");
      }
      const isAllowed = payload.allowed_variant_types.includes(variantType);
      const priceText = optionalText(formData.get(`variantPrice:${variantId}`));
      const active = formData.get(`variantActive:${variantId}`) === "on";
      if (active && !isAllowed) {
        throw new ValidationError("Esta versión no aplica comercialmente para la máquina.");
      }
      if (active && !priceText) throw new ValidationError("Asigna un precio antes de activar una versión.");
      const price = priceText ? nonNegativePrice(priceText, "El precio de la versión") : null;
      if (price !== null && Number(price) <= 0) throw new ValidationError("El precio de la versión debe ser mayor que cero.");
      const description = optionalText(formData.get(`variantDescription:${variantId}`));
      const { error } = await supabase.from("machine_variants").update({ price, active, description }).eq("id", variantId).eq("machine_id", savedMachineId!);
      if (error) throw new Error("No se pudo guardar una versión de máquina.");
    }

    revalidatePath("/seller", "layout");
    revalidatePath("/admin/catalog");
    return {};
  } catch (error) {
    return actionError(error, "No se pudo guardar la máquina.");
  }
}

export async function setMachineActive(
  id: string,
  active: boolean
): Promise<CatalogActionResult> {
  try {
    const machineId = assertUuid(id);

    if (typeof active !== "boolean") {
      throw new ValidationError("El estado no es válido.");
    }

    const supabase = await getAdminClient();
    const { error } = await supabase
      .from("machines")
      .update({ active })
      .eq("id", machineId);

    if (error) {
      throw new Error("No se pudo actualizar el estado de la máquina.");
    }

    revalidatePath("/admin/catalog");
    return {};
  } catch (error) {
    return actionError(error, "No se pudo actualizar la máquina.");
  }
}

export async function deleteMachine(id: string): Promise<CatalogActionResult> {
  try {
    const machineId = assertUuid(id);
    const supabase = await getAdminClient();
    const { error } = await supabase.from("machines").delete().eq("id", machineId);

    if (error) {
      throw new Error("No se pudo eliminar la máquina.");
    }

    revalidatePath("/admin/catalog");
    return {};
  } catch (error) {
    return actionError(error, "No se pudo eliminar la máquina.");
  }
}

export async function saveAddon(formData: FormData): Promise<CatalogActionResult> {
  try {
    const id = optionalUuid(formData.get("id"));
    const calculationType = requiredText(
      formData.get("calculationType"),
      "El tipo de cálculo"
    );

    if (calculationType !== "FIXED" && calculationType !== "PER_BASE" && calculationType !== "QUANTITY") {
      throw new ValidationError("El tipo de cálculo no es válido.");
    }

    const payload = {
      name: requiredText(formData.get("name"), "El nombre"),
      description: optionalText(formData.get("description")),
      unit_price: nonNegativePrice(
        formData.get("unitPrice"),
        "El precio unitario"
      ),
      calculation_type: calculationType,
      required: formData.get("required") === "on",
      active: formData.get("active") === "on",
    };
    const selectedMachineIds = formData
      .getAll("machineIds")
      .filter((value): value is string => typeof value === "string");
    const supabase = await getAdminClient();
    let addonId = id;

    if (addonId) {
      const { data, error } = await supabase
        .from("addons")
        .update(payload)
        .eq("id", addonId)
        .select("id")
        .maybeSingle();

      if (error || !data) {
        throw new Error("No se pudo actualizar el add-on.");
      }
    } else {
      const { data, error } = await supabase
        .from("addons")
        .insert(payload)
        .select("id")
        .single();

      if (error || !data) {
        throw new Error("No se pudo crear el add-on.");
      }

      addonId = data.id;
    }

    if (!addonId) {
      throw new Error("No se pudo identificar el add-on.");
    }

    await syncAddonMachines(addonId, formData, selectedMachineIds);

    revalidatePath("/admin/catalog");
    return {};
  } catch (error) {
    return actionError(error, "No se pudo guardar el add-on.");
  }
}

export async function setAddonActive(
  id: string,
  active: boolean
): Promise<CatalogActionResult> {
  try {
    const addonId = assertUuid(id);

    if (typeof active !== "boolean") {
      throw new ValidationError("El estado no es válido.");
    }

    const supabase = await getAdminClient();
    const { error } = await supabase
      .from("addons")
      .update({ active })
      .eq("id", addonId);

    if (error) {
      throw new Error("No se pudo actualizar el estado del add-on.");
    }

    revalidatePath("/admin/catalog");
    return {};
  } catch (error) {
    return actionError(error, "No se pudo actualizar el add-on.");
  }
}

export async function deleteAddon(id: string): Promise<CatalogActionResult> {
  try {
    const addonId = assertUuid(id);
    const supabase = await getAdminClient();
    const { error } = await supabase.from("addons").delete().eq("id", addonId);

    if (error) {
      throw new Error("No se pudo eliminar el add-on.");
    }

    revalidatePath("/admin/catalog");
    return {};
  } catch (error) {
    return actionError(error, "No se pudo eliminar el add-on.");
  }
}
