"use server";

import { revalidatePath } from "next/cache";

import { getAdminClient } from "@/lib/auth/get-admin-client";

export type CouponActionResult = { error?: string };

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

function optionalUuid(value: FormDataEntryValue | null) {
  const id = optionalText(value);
  if (id && !uuidPattern.test(id)) throw new ValidationError("El identificador no es válido.");
  return id;
}

function validUuid(value: unknown) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new ValidationError("El identificador no es válido.");
  }
  return value;
}

function positiveMoney(value: FormDataEntryValue | null) {
  const money = requiredText(value, "El valor del descuento");
  if (!/^\d+(?:\.\d{1,2})?$/.test(money)) {
    throw new ValidationError("El valor del descuento debe ser un número con hasta dos decimales.");
  }
  const numericValue = Number(money);
  if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue > 9_999_999_999.99) {
    throw new ValidationError("El valor del descuento no es válido.");
  }
  return money;
}

function couponCode(value: FormDataEntryValue | null) {
  const code = requiredText(value, "El código").toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(code)) {
    throw new ValidationError("El código solo puede usar letras, números y guiones.");
  }
  return code;
}

function dateAtBoundary(value: FormDataEntryValue | null, endOfDay: boolean) {
  const date = optionalText(value);
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("La fecha no es válida.");

  const parsed = new Date(`${date}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ValidationError("La fecha no es válida.");
  }
  return parsed.toISOString();
}

function actionError(error: unknown, fallback: string): CouponActionResult {
  return error instanceof ValidationError ? { error: error.message } : { error: fallback };
}

function refreshCouponViews() {
  revalidatePath("/admin");
  revalidatePath("/admin/coupons");
  revalidatePath("/seller");
  revalidatePath("/seller/quote/[machineSlug]", "page");
}

async function syncCouponMachines(couponId: string, selectedMachineIds: string[]) {
  const uniqueMachineIds = [...new Set(selectedMachineIds)];
  if (uniqueMachineIds.some((machineId) => !uuidPattern.test(machineId))) {
    throw new ValidationError("Una de las máquinas seleccionadas no es válida.");
  }

  const supabase = await getAdminClient();
  if (uniqueMachineIds.length > 0) {
    const { data: matchingMachines, error: machinesError } = await supabase
      .from("machines")
      .select("id")
      .eq("active", true)
      .in("id", uniqueMachineIds);
    if (machinesError || matchingMachines.length !== uniqueMachineIds.length) {
      throw new ValidationError("Una de las máquinas seleccionadas no está disponible.");
    }
  }

  const { data: currentRelations, error: relationsError } = await supabase
    .from("coupon_machines")
    .select("machine_id")
    .eq("coupon_id", couponId);
  if (relationsError) throw new Error("No se pudieron consultar las máquinas del cupón.");

  if (uniqueMachineIds.length > 0) {
    const { error: upsertError } = await supabase.from("coupon_machines").upsert(
      uniqueMachineIds.map((machineId) => ({ coupon_id: couponId, machine_id: machineId })),
      { onConflict: "coupon_id,machine_id" }
    );
    if (upsertError) throw new Error("No se pudieron guardar las máquinas del cupón.");
  }

  const selectedIds = new Set(uniqueMachineIds);
  const relationIdsToDelete = (currentRelations ?? [])
    .map((relation) => relation.machine_id)
    .filter((machineId) => !selectedIds.has(machineId));
  if (relationIdsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("coupon_machines")
      .delete()
      .eq("coupon_id", couponId)
      .in("machine_id", relationIdsToDelete);
    if (deleteError) throw new Error("No se pudieron actualizar las máquinas del cupón.");
  }
}

export async function saveCoupon(formData: FormData): Promise<CouponActionResult> {
  try {
    const id = optionalUuid(formData.get("id"));
    const discountType = requiredText(formData.get("discountType"), "El tipo");
    if (discountType !== "FIXED_AMOUNT" && discountType !== "PERCENTAGE") {
      throw new ValidationError("El tipo de descuento no es válido.");
    }

    const discountValue = positiveMoney(formData.get("discountValue"));
    if (discountType === "PERCENTAGE" && Number(discountValue) > 100) {
      throw new ValidationError("El porcentaje no puede ser mayor a 100.");
    }

    const startsAt = dateAtBoundary(formData.get("startsAt"), false);
    const endsAt = dateAtBoundary(formData.get("endsAt"), true);
    if (startsAt && endsAt && startsAt > endsAt) {
      throw new ValidationError("La fecha de inicio debe ser anterior a la fecha de fin.");
    }

    const appliesToAllMachines = formData.get("appliesTo") === "all";
    const selectedMachineIds = formData
      .getAll("machineIds")
      .filter((value): value is string => typeof value === "string");
    if (!appliesToAllMachines && selectedMachineIds.length === 0) {
      throw new ValidationError("Selecciona al menos una máquina para este cupón.");
    }

    const payload = {
      name: requiredText(formData.get("name"), "El nombre de la promoción"),
      code: couponCode(formData.get("code")),
      description: optionalText(formData.get("description")),
      discount_type: discountType,
      discount_value: discountValue,
      active: formData.get("active") === "on",
      starts_at: startsAt,
      ends_at: endsAt,
      event_name: optionalText(formData.get("eventName")),
      applies_to_all_machines: appliesToAllMachines,
    };

    const supabase = await getAdminClient();
    let couponId = id;
    if (couponId) {
      const { data, error } = await supabase
        .from("coupons")
        .update(payload)
        .eq("id", couponId)
        .select("id")
        .maybeSingle();
      if (error?.code === "23505") throw new ValidationError("Ya existe un cupón con ese código.");
      if (error || !data) throw new Error("No se pudo actualizar el cupón.");
    } else {
      const { data, error } = await supabase
        .from("coupons")
        .insert(payload)
        .select("id")
        .single();
      if (error?.code === "23505") throw new ValidationError("Ya existe un cupón con ese código.");
      if (error || !data) throw new Error("No se pudo crear el cupón.");
      couponId = data.id;
    }

    if (!couponId) throw new Error("No se pudo identificar el cupón.");
    await syncCouponMachines(couponId, appliesToAllMachines ? [] : selectedMachineIds);
    refreshCouponViews();
    return {};
  } catch (error) {
    return actionError(error, "No se pudo guardar el cupón.");
  }
}

export async function setCouponActive(id: string, active: boolean): Promise<CouponActionResult> {
  try {
    const couponId = validUuid(id);
    if (typeof active !== "boolean") throw new ValidationError("El estado no es válido.");
    const supabase = await getAdminClient();
    const { error } = await supabase.from("coupons").update({ active }).eq("id", couponId);
    if (error) throw new Error("No se pudo actualizar el cupón.");
    refreshCouponViews();
    return {};
  } catch (error) {
    return actionError(error, "No se pudo actualizar el cupón.");
  }
}

export async function deleteCoupon(id: string): Promise<CouponActionResult> {
  try {
    const couponId = validUuid(id);
    const supabase = await getAdminClient();
    const { error } = await supabase.from("coupons").delete().eq("id", couponId);
    if (error) throw new Error("No se pudo eliminar el cupón.");
    refreshCouponViews();
    return {};
  } catch (error) {
    return actionError(error, "No se pudo eliminar el cupón.");
  }
}
