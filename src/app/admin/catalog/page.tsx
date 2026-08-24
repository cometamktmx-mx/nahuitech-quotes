import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/admin-nav";

import {
  CatalogManager,
  type CatalogAddon,
  type CatalogMachine,
} from "./catalog-manager";

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export default async function AdminCatalogPage() {
  const profile = await requireRole("admin");
  const supabase = await createClient();
  const [machinesResult, addonsResult, relationsResult] = await Promise.all([
    supabase
      .from("machines")
      .select(
        "id, name, slug, short_description, base_price, number_of_bases, supports_addons, delivery_policy, image_url, active, sort_order"
      )
      .order("sort_order")
      .order("name"),
    supabase
      .from("addons")
      .select("id, name, description, unit_price, calculation_type, required, active")
      .order("name"),
    supabase.from("machine_addons").select("machine_id, addon_id, unit_price_override, description_override"),
  ]);

  if (machinesResult.error || addonsResult.error || relationsResult.error) {
    throw new Error("No se pudo cargar el catálogo.");
  }

  const machineIdsByAddon = new Map<string, CatalogAddon["compatibilities"]>();

  for (const relation of relationsResult.data ?? []) {
    const relations = machineIdsByAddon.get(relation.addon_id) ?? [];
    relations.push({
      machineId: relation.machine_id,
      unitPriceOverride: relation.unit_price_override === null ? null : asNumber(relation.unit_price_override),
      descriptionOverride: relation.description_override,
    });
    machineIdsByAddon.set(relation.addon_id, relations);
  }

  const machines: CatalogMachine[] = (machinesResult.data ?? []).map((machine) => ({
    id: machine.id,
    name: machine.name,
    slug: machine.slug,
    shortDescription: machine.short_description,
    basePrice: asNumber(machine.base_price),
    numberOfBases: machine.number_of_bases,
    supportsAddons: machine.supports_addons,
    deliveryPolicy: machine.delivery_policy,
    imageUrl: machine.image_url,
    active: machine.active,
    sortOrder: machine.sort_order,
  }));
  const addons: CatalogAddon[] = (addonsResult.data ?? []).map((addon) => ({
    id: addon.id,
    name: addon.name,
    description: addon.description,
    unitPrice: asNumber(addon.unit_price),
    calculationType: addon.calculation_type,
    required: addon.required,
    active: addon.active,
    compatibilities: machineIdsByAddon.get(addon.id) ?? [],
  }));

  return (
    <div className="min-h-screen bg-background">
      <AdminNav active="catalog" userName={profile.full_name} />
      <CatalogManager addons={addons} machines={machines} />
    </div>
  );
}
