"use client";

import { createClient } from "@/lib/supabase/client";

import { offlineDb } from "./offline-db";
import type {
  OfflineAddon,
  OfflineCoupon,
  OfflineCouponMachine,
  OfflineMachine,
  OfflineMachineAddon,
  OfflineMachineVariant,
  OfflineSalesperson,
  OfflineSellerProfile,
} from "./offline-types";

const catalogMetadataKey = (accountId: string) => `catalog:${accountId}`;
const sellerSessionMetadataKey = "session:last-seller";
const selectedSalespersonMetadataKey = (accountId: string) =>
  `selected-salesperson:${accountId}`;
let offlineCatalogSyncInFlight: Promise<{ sellerId: string; syncedAt: string }> | null = null;

type OfflineSellerSession = { sellerId: string };

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requireData<T>(
  result: { data: T | null; error: { message: string } | null },
  label: string
) {
  if (result.error) throw new Error(`No se pudo sincronizar ${label}.`);
  return result.data ?? ([] as unknown as T);
}

async function syncOfflineCatalogInternal() {
  const supabase = createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const sellerId =
    typeof claimsData?.claims.sub === "string" ? claimsData.claims.sub : null;

  if (claimsError || !sellerId) {
    throw new Error("Necesitas una sesión activa para preparar el modo offline.");
  }

  const [
    machinesResult,
    variantsResult,
    addonsResult,
    relationsResult,
    couponsResult,
    couponMachinesResult,
    profileResult,
    salespeopleResult,
  ] = await Promise.all([
    supabase
      .from("machines")
      .select(
        "id, name, slug, short_description, base_price, number_of_bases, supports_addons, delivery_policy, variant_selection_required, allowed_variant_types, image_url, sort_order, active"
      )
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("machine_variants")
      .select("id, machine_id, variant_type, display_name, price, description, active, sort_order")
      .order("sort_order"),
    supabase
      .from("addons")
      .select("id, name, description, unit_price, calculation_type, required, active")
      .eq("active", true)
      .order("name"),
    supabase
      .from("machine_addons")
      .select("machine_id, addon_id, active, unit_price_override, description_override")
      .eq("active", true),
    supabase
      .from("coupons")
      .select(
        "id, name, code, description, discount_type, discount_value, active, starts_at, ends_at, event_name, applies_to_all_machines"
      )
      .eq("active", true),
    supabase.from("coupon_machines").select("coupon_id, machine_id"),
    supabase
      .from("profiles")
      .select("full_name, role, active, salesperson_id")
      .eq("id", sellerId)
      .maybeSingle(),
    supabase
      .from("salespeople")
      .select("id, full_name, active, sort_order")
      .eq("active", true)
      .order("sort_order")
      .order("full_name"),
  ]);

  const machineRows = requireData(machinesResult, "las máquinas");
  const variantRows = requireData(variantsResult, "las versiones");
  const addonRows = requireData(addonsResult, "los add-ons");
  const relationRows = requireData(relationsResult, "las compatibilidades");
  const couponRows = requireData(couponsResult, "los cupones");
  const couponMachineRows = requireData(
    couponMachinesResult,
    "las compatibilidades de cupones"
  );
  const salespersonRows = requireData(salespeopleResult, "los vendedores comerciales");

  if (
    profileResult.error ||
    !profileResult.data ||
    !profileResult.data.active ||
    (profileResult.data.role !== "seller" && profileResult.data.role !== "expo")
  ) {
    throw new Error("Tu perfil no está disponible para el modo offline.");
  }

  const syncedAt = new Date().toISOString();
  const machines: OfflineMachine[] = machineRows.map((machine) => ({
    id: machine.id,
    name: machine.name,
    slug: machine.slug,
    shortDescription: machine.short_description,
    basePrice: toNumber(machine.base_price),
    numberOfBases: machine.number_of_bases,
    supportsAddons: machine.supports_addons,
    deliveryPolicy: machine.delivery_policy,
    variantSelectionRequired: machine.variant_selection_required,
    allowedVariantTypes: machine.allowed_variant_types,
    imageUrl: machine.image_url,
    sortOrder: machine.sort_order,
    active: machine.active,
  }));
  const variants: OfflineMachineVariant[] = variantRows.map((variant) => ({
    id: variant.id,
    machineId: variant.machine_id,
    variantType: variant.variant_type,
    displayName: variant.display_name,
    price: variant.price === null ? null : toNumber(variant.price),
    description: variant.description,
    active: variant.active,
    sortOrder: variant.sort_order,
  }));
  const addons: OfflineAddon[] = addonRows.map((addon) => ({
    id: addon.id,
    name: addon.name,
    description: addon.description,
    unitPrice: toNumber(addon.unit_price),
    calculationType: addon.calculation_type,
    required: addon.required,
    active: addon.active,
  }));
  const machineAddons: OfflineMachineAddon[] = relationRows.map((relation) => ({
    machineId: relation.machine_id,
    addonId: relation.addon_id,
    active: relation.active,
    unitPriceOverride:
      relation.unit_price_override === null
        ? null
        : toNumber(relation.unit_price_override),
    descriptionOverride: relation.description_override,
  }));
  const coupons: OfflineCoupon[] = couponRows.map((coupon) => ({
    id: coupon.id,
    name: coupon.name,
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discount_type,
    discountValue: toNumber(coupon.discount_value),
    active: coupon.active,
    startsAt: coupon.starts_at,
    endsAt: coupon.ends_at,
    eventName: coupon.event_name,
    appliesToAllMachines: coupon.applies_to_all_machines,
  }));
  const couponMachines: OfflineCouponMachine[] = couponMachineRows.map(
    (relation) => ({
      couponId: relation.coupon_id,
      machineId: relation.machine_id,
    })
  );
  const salespeople: OfflineSalesperson[] = salespersonRows.map((salesperson) => ({
    id: salesperson.id,
    fullName: salesperson.full_name,
    active: salesperson.active,
    sortOrder: salesperson.sort_order,
  }));
  const profile: OfflineSellerProfile = {
    id: sellerId,
    fullName: profileResult.data.full_name,
    role: profileResult.data.role,
    active: true,
    salespersonId: profileResult.data.salesperson_id,
    syncedAt,
  };
  const metadata = {
    key: catalogMetadataKey(sellerId),
    value: JSON.stringify({ machineCount: machines.length, sellerId }),
    updatedAt: syncedAt,
  };

  // Only replace the local snapshot after every remote list was read successfully.
  await offlineDb.transaction(
    "rw",
    [
      offlineDb.machines,
      offlineDb.machineVariants,
      offlineDb.addons,
      offlineDb.machineAddons,
      offlineDb.coupons,
      offlineDb.couponMachines,
      offlineDb.sellerProfiles,
      offlineDb.salespeople,
      offlineDb.metadata,
    ],
    async () => {
      await Promise.all([
        offlineDb.machines.clear(),
        offlineDb.machineVariants.clear(),
        offlineDb.addons.clear(),
        offlineDb.machineAddons.clear(),
        offlineDb.coupons.clear(),
        offlineDb.couponMachines.clear(),
        offlineDb.salespeople.clear(),
      ]);
      await Promise.all([
        offlineDb.machines.bulkPut(machines),
        offlineDb.machineVariants.bulkPut(variants),
        offlineDb.addons.bulkPut(addons),
        offlineDb.machineAddons.bulkPut(machineAddons),
        offlineDb.coupons.bulkPut(coupons),
        offlineDb.couponMachines.bulkPut(couponMachines),
        offlineDb.sellerProfiles.put(profile),
        offlineDb.salespeople.bulkPut(salespeople),
        offlineDb.metadata.put(metadata),
        offlineDb.metadata.put({
          key: sellerSessionMetadataKey,
          value: JSON.stringify({ sellerId }),
          updatedAt: syncedAt,
        }),
      ]);
    }
  );

  return { sellerId, syncedAt };
}

export function syncOfflineCatalog() {
  if (offlineCatalogSyncInFlight) return offlineCatalogSyncInFlight;

  const sync = syncOfflineCatalogInternal();
  offlineCatalogSyncInFlight = sync;
  sync.then(
    () => {
      if (offlineCatalogSyncInFlight === sync) offlineCatalogSyncInFlight = null;
    },
    () => {
      if (offlineCatalogSyncInFlight === sync) offlineCatalogSyncInFlight = null;
    }
  );

  return sync;
}

export async function getOfflineCatalog(sellerId: string) {
  const [profile, metadata, machines, variants, addons, relations] =
    await Promise.all([
      offlineDb.sellerProfiles.get(sellerId),
      offlineDb.metadata.get(catalogMetadataKey(sellerId)),
      offlineDb.machines.toArray(),
      offlineDb.machineVariants.toArray(),
      offlineDb.addons.toArray(),
      offlineDb.machineAddons.toArray(),
    ]);

  return {
    profile,
    syncedAt: metadata?.updatedAt ?? null,
    machines: machines
      .filter((machine) => machine.active)
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)
      ),
    variants: variants.sort((left, right) => left.sortOrder - right.sortOrder),
    addons: addons.filter((addon) => addon.active),
    relations: relations.filter((relation) => relation.active),
  };
}

export async function getOfflineSellerProfile(sellerId: string) {
  return offlineDb.sellerProfiles.get(sellerId);
}

export async function getOfflineCatalogTimestamp(sellerId: string) {
  return (await offlineDb.metadata.get(catalogMetadataKey(sellerId)))?.updatedAt ?? null;
}

export async function getOfflineSellerSession() {
  const metadata = await offlineDb.metadata.get(sellerSessionMetadataKey);
  if (!metadata) return null;

  try {
    const value = JSON.parse(metadata.value) as OfflineSellerSession;
    return typeof value.sellerId === "string" && value.sellerId ? value : null;
  } catch {
    return null;
  }
}

export async function getOfflineSelectedSalesperson(accountId: string) {
  const metadata = await offlineDb.metadata.get(
    selectedSalespersonMetadataKey(accountId)
  );
  if (!metadata) return null;

  try {
    const value = JSON.parse(metadata.value) as {
      salespersonId?: unknown;
      salespersonName?: unknown;
    };
    return typeof value.salespersonId === "string" &&
      typeof value.salespersonName === "string"
      ? { salespersonId: value.salespersonId, salespersonName: value.salespersonName }
      : null;
  } catch {
    return null;
  }
}

export async function setOfflineSelectedSalesperson(
  accountId: string,
  salespersonId: string,
  salespersonName: string
) {
  await offlineDb.metadata.put({
    key: selectedSalespersonMetadataKey(accountId),
    value: JSON.stringify({ salespersonId, salespersonName }),
    updatedAt: new Date().toISOString(),
  });
}

export async function clearOfflineSelectedSalesperson(accountId: string) {
  await offlineDb.metadata.delete(selectedSalespersonMetadataKey(accountId));
}

export async function clearOfflineSellerSession() {
  const session = await getOfflineSellerSession();
  await offlineDb.transaction("rw", [offlineDb.metadata, offlineDb.sellerProfiles], async () => {
    await offlineDb.metadata.delete(sellerSessionMetadataKey);
    if (session?.sellerId) {
      await offlineDb.sellerProfiles.delete(session.sellerId);
      await offlineDb.metadata.delete(selectedSalespersonMetadataKey(session.sellerId));
    }
  });

  if (typeof caches !== "undefined") {
    await Promise.all([
      caches.delete("nahuitech-seller-documents-v1"),
      caches.delete("nahuitech-seller-documents-v2"),
      caches.delete("nahuitech-seller-documents-v3"),
      caches.delete("nahuitech-seller-documents-v4"),
    ]);
  }
}
