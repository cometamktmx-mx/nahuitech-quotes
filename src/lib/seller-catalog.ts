export type SellerMachine = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string;
  basePrice: number;
  numberOfBases: number | null;
  supportsAddons: boolean;
  deliveryPolicy: "FLEXIBLE" | "INSTALLATION_REQUIRED" | "SHIPPING_ONLY";
  /** Whether the seller must explicitly confirm a commercial version. */
  variantSelectionRequired: boolean;
  /** Variant types that are commercially applicable to this machine. */
  allowedVariantTypes: Array<"AUTOMATIC" | "SEMI_AUTOMATIC">;
  imageUrl: string | null;
  sortOrder: number;
};

export type SellerMachineVariant = {
  id: string;
  machineId: string;
  variantType: "AUTOMATIC" | "SEMI_AUTOMATIC";
  displayName: string;
  price: number | null;
  description: string | null;
  active: boolean;
  sortOrder: number;
};

export type SellerAddon = {
  id: string;
  name: string;
  description: string | null;
  unitPrice: number;
  calculationType: "FIXED" | "PER_BASE" | "QUANTITY";
  required: boolean;
  displayOrder: number;
};

export function asCatalogNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
