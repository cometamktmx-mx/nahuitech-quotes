import { notFound } from "next/navigation";

import { SellerQuoteConfigurator } from "@/components/seller-quote-configurator";
import { SellerOfflineProvider } from "@/components/seller-offline-provider";
import { SellerShellHeader } from "@/components/seller-shell-header";
import { requireSellerFlowRole } from "@/lib/auth/require-role";
import {
  asCatalogNumber,
  type SellerAddon,
  type SellerMachine,
  type SellerMachineVariant,
} from "@/lib/seller-catalog";
import { createClient } from "@/lib/supabase/server";

type SellerQuotePageProps = {
  params: Promise<{ machineSlug: string }>;
};

export default async function SellerQuotePage({ params }: SellerQuotePageProps) {
  const [{ machineSlug }, profile] = await Promise.all([
    params,
    requireSellerFlowRole(),
  ]);
  const supabase = await createClient();
  const { data: machine, error: machineError } = await supabase
    .from("machines")
    .select(
      "id, name, slug, short_description, base_price, number_of_bases, supports_addons, delivery_policy, image_url, sort_order"
    )
    .eq("slug", machineSlug)
    .eq("active", true)
    .maybeSingle();

  if (machineError) {
    throw new Error("No se pudo cargar la máquina seleccionada.");
  }

  if (!machine) {
    notFound();
  }

  const selectedMachine: SellerMachine = {
    id: machine.id,
    name: machine.name,
    slug: machine.slug,
    shortDescription: machine.short_description,
    basePrice: asCatalogNumber(machine.base_price),
    numberOfBases: machine.number_of_bases,
    supportsAddons: machine.supports_addons,
    deliveryPolicy: machine.delivery_policy,
    imageUrl: machine.image_url,
    sortOrder: machine.sort_order,
  };

  let addons: SellerAddon[] = [];

  if (selectedMachine.supportsAddons) {
    const { data: relations, error: relationsError } = await supabase
      .from("machine_addons")
      .select("addon_id, unit_price_override, description_override")
      .eq("machine_id", selectedMachine.id)
      .eq("active", true);

    if (relationsError) {
      throw new Error("No se pudieron cargar los add-ons compatibles.");
    }

    const addonIds = (relations ?? []).map((relation) => relation.addon_id);
    const relationByAddonId = new Map(
      (relations ?? []).map((relation) => [relation.addon_id, relation] as const)
    );

    if (addonIds.length > 0) {
      const { data: addonRows, error: addonsError } = await supabase
        .from("addons")
        .select("id, name, description, unit_price, calculation_type, required")
        .in("id", addonIds)
        .eq("active", true)
        .order("name");

      if (addonsError) {
        throw new Error("No se pudieron cargar los add-ons compatibles.");
      }

      addons = (addonRows ?? []).map((addon) => ({
        id: addon.id,
        name: addon.name,
        description: relationByAddonId.get(addon.id)?.description_override ?? addon.description,
        unitPrice: relationByAddonId.get(addon.id)?.unit_price_override === null || relationByAddonId.get(addon.id)?.unit_price_override === undefined
          ? asCatalogNumber(addon.unit_price)
          : asCatalogNumber(relationByAddonId.get(addon.id)?.unit_price_override),
        calculationType: addon.calculation_type,
        required: addon.required,
      }));
    }
  }

  if (
    addons.some((addon) => addon.calculationType === "PER_BASE") &&
    selectedMachine.numberOfBases === null
  ) {
    throw new Error("La máquina necesita número de bases para sus add-ons PER_BASE.");
  }

  const { data: variantRows, error: variantsError } = await supabase
    .from("machine_variants")
    .select("id, machine_id, variant_type, display_name, price, active, sort_order")
    .eq("machine_id", selectedMachine.id)
    .order("sort_order");

  if (variantsError) {
    throw new Error("No se pudieron cargar las versiones de la máquina.");
  }

  const variants: SellerMachineVariant[] = (variantRows ?? []).map((variant) => ({
    id: variant.id,
    machineId: variant.machine_id,
    variantType: variant.variant_type,
    displayName: variant.display_name,
    price: variant.price === null ? null : asCatalogNumber(variant.price),
    active: variant.active,
    sortOrder: variant.sort_order,
  }));

  return (
    <SellerOfflineProvider initialAccountRole={profile.role}>
      <div className="min-h-screen bg-background">
        <SellerShellHeader accountRole={profile.role} userName={profile.full_name} />
        <SellerQuoteConfigurator addons={addons} isExpoAccount={profile.role === "expo"} machine={selectedMachine} variants={variants} />
      </div>
    </SellerOfflineProvider>
  );
}
